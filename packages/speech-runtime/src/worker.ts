import { validateSpeechAudio } from "./audio.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { type SpeechPack } from "./catalog.js";
import { type SpeechPacks } from "./packs.js";

export class SpeechWorker {
  #child: ChildProcessWithoutNullStreams | null = null;
  #packId: string | null = null;
  #idle: ReturnType<typeof setTimeout> | null = null;
  #pending: ((error: Error) => void) | null = null;
  stop() {
    if (this.#idle) clearTimeout(this.#idle);
    this.#pending?.(new Error("OD_SPEECH_CANCELLED"));
    this.#pending = null;
    this.#child?.kill("SIGKILL");
    this.#child = null;
    this.#packId = null;
  }
  async synthesize(
    packs: SpeechPacks,
    pack: SpeechPack,
    text: string,
    signal: AbortSignal,
    onChunk: (audio: Buffer) => void,
  ): Promise<Buffer> {
    if (this.#pending) throw new Error("OD_SPEECH_BUSY");
    if (!(await packs.installed(pack))) throw new Error("OD_SPEECH_NOT_INSTALLED");
    if (this.#idle) clearTimeout(this.#idle);
    if (this.#packId !== pack.id) this.stop();
    if (!this.#child) {
      await packs.verify(pack, signal);
      signal.throwIfAborted();
      const root = packs.location(pack);
      const runtime = packs.runtimeLocation(pack);
      this.#child = spawn(
        path.join(runtime, "runtime/bin/python3"),
        ["-I", "-B", path.join(runtime, "runtime/worker.py"), root, pack.engine, pack.language],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            PATH: path.join(runtime, "runtime/bin"),
            HOME: root,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
            OMP_NUM_THREADS: "2",
            OPENBLAS_NUM_THREADS: "2",
            PYTHONNOUSERSITE: "1",
          },
        },
      );
      this.#packId = pack.id;
      const spawned = this.#child;
      spawned.once("exit", () => {
        if (this.#child === spawned) {
          this.#child = null;
          this.#packId = null;
        }
      });
      spawned.on("error", () => {
        if (this.#child === spawned) {
          this.#child = null;
          this.#packId = null;
        }
      });
      spawned.stdin.on("error", () => this.#pending?.(new Error("OD_SPEECH_ENGINE_FAILED")));
      this.#child.stderr.resume();
    }
    const child = this.#child;
    return await new Promise<Buffer>((resolve, reject) => {
      let data = "";
      let settled = false;
      const timer = setTimeout(() => {
        this.stop();
      }, 120000);
      const finish = (error?: Error, audio?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        child.stdout.off("data", receive);
        child.off("error", fail);
        child.off("exit", fail);
        this.#pending = null;
        if (error) {
          if (this.#child === child) {
            this.#child = null;
            this.#packId = null;
          }
          child.kill("SIGKILL");
          reject(error);
        } else if (audio) resolve(audio);
        else reject(new Error("OD_SPEECH_AUDIO_INVALID"));
        this.#idle = setTimeout(() => {
          this.stop();
        }, 300000);
      };
      const fail = () => {
        finish(new Error("OD_SPEECH_ENGINE_FAILED"));
      };
      const abort = () => {
        this.stop();
      };
      const receive = (chunk: Buffer) => {
        data += chunk.toString();
        if (data.length > 28_000_000) {
          this.stop();
          return;
        }
        while (data.includes("\n") && !settled) {
          const newline = data.indexOf("\n");
          const line = data.slice(0, newline);
          data = data.slice(newline + 1);
          try {
            const result = JSON.parse(line) as { audio?: string; chunk?: string };
            const encoded = result.chunk ?? result.audio;
            if (typeof encoded !== "string") throw new Error();
            const audio = Buffer.from(encoded, "base64");
            validateSpeechAudio(audio);
            if (result.chunk) {
              if (encoded.length > 8_000_000) throw new Error();
              signal.throwIfAborted();
              onChunk(audio);
            } else finish(undefined, audio);
          } catch {
            fail();
          }
        }
      };
      this.#pending = (error) => {
        finish(error);
      };
      child.stdout.on("data", receive);
      child.once("error", fail);
      child.once("exit", fail);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      child.stdin.write(JSON.stringify({ text }) + "\n");
    });
  }
}
