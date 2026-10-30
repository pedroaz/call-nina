import { validateSpeechAudio } from "./audio.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { SpeechPack } from "./catalog.js";
import type { SpeechPacks } from "./packs.js";

const initializationMs = 120_000;
const inactivityMs = 120_000;
const maximumSynthesisMs = 20 * 60_000;

export class SpeechWorker {
  #child: ChildProcessWithoutNullStreams | null = null;
  #packKey: string | null = null;
  #ready = false;
  #idle: ReturnType<typeof setTimeout> | null = null;
  #active: AbortController | null = null;
  #discard(child = this.#child) {
    if (this.#child === child) {
      this.#child = null;
      this.#packKey = null;
      this.#ready = false;
    }
    child?.kill("SIGKILL");
  }
  stop() {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
    const active = this.#active;
    this.#active = null;
    active?.abort();
    this.#discard();
  }
  async synthesize(
    packs: SpeechPacks,
    pack: SpeechPack,
    text: string,
    signal: AbortSignal,
    onChunk: (audio: Buffer) => void,
  ): Promise<Buffer> {
    // Reserve admission before the first asynchronous filesystem operation.
    if (this.#active) throw new Error("OD_SPEECH_BUSY");
    const active = new AbortController();
    this.#active = active;
    const bounded = AbortSignal.any([signal, active.signal]);
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
    try {
      bounded.throwIfAborted();
      if (!(await packs.installed(pack))) throw new Error("OD_SPEECH_NOT_INSTALLED");
      bounded.throwIfAborted();
      const key = `${pack.id}:${pack.runtime?.sha256 ?? ""}`;
      if (this.#packKey !== key) this.#discard();
      if (!this.#child) {
        await packs.verify(pack, bounded);
        bounded.throwIfAborted();
        const runtime = path.join(packs.runtimeLocation(pack), "runtime");
        const root = packs.location(pack);
        const child = spawn(
          path.join(runtime, "bin/python3"),
          ["-I", "-B", path.join(runtime, "worker.py"), root, pack.engine, pack.language],
          {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              PATH: path.join(runtime, "bin"),
              HOME: root,
              HF_HUB_OFFLINE: "1",
              TRANSFORMERS_OFFLINE: "1",
              OMP_NUM_THREADS: "2",
              OPENBLAS_NUM_THREADS: "2",
              PYTHONNOUSERSITE: "1",
            },
          },
        );
        this.#child = child;
        this.#packKey = key;
        child.once("exit", () => {
          if (this.#child === child) this.#discard(child);
        });
        // Keep errors handled even during the warm idle interval.
        child.on("error", () => {
          if (this.#child === child) this.#discard(child);
        });
        child.stdin.on("error", () => {
          if (this.#child === child) this.#discard(child);
        });
        child.stderr.resume();
      }
      const child = this.#child;
      return await new Promise<Buffer>((resolve, reject) => {
        let data = "",
          total = 0,
          settled = false,
          sent = false;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        let activity: ReturnType<typeof setTimeout>;
        const finish = (error?: Error, audio?: Buffer) => {
          if (settled) return;
          settled = true;
          clearTimeout(activity);
          clearTimeout(deadline);
          bounded.removeEventListener("abort", abort);
          child.stdout.off("data", receive);
          child.off("error", fail);
          child.off("exit", fail);
          child.stdin.off("error", fail);
          if (error) {
            this.#discard(child);
            reject(error);
          } else if (audio) {
            if (this.#child === child)
              this.#idle = setTimeout(() => {
                this.stop();
              }, 300_000);
            resolve(audio);
          } else reject(new Error("OD_SPEECH_AUDIO_INVALID"));
        };
        const fail = () => {
          finish(new Error("OD_SPEECH_ENGINE_FAILED"));
        };
        const abort = () => {
          finish(new Error("OD_SPEECH_CANCELLED"));
        };
        const resetActivity = (initializing: boolean) => {
          clearTimeout(activity);
          activity = setTimeout(
            () => {
              finish(
                new Error(
                  initializing ? "OD_SPEECH_INITIALIZATION_TIMEOUT" : "OD_SPEECH_SYNTHESIS_TIMEOUT",
                ),
              );
            },
            initializing ? initializationMs : inactivityMs,
          );
        };
        const send = () => {
          if (sent || settled) return;
          sent = true;
          resetActivity(false);
          deadline = setTimeout(() => {
            finish(new Error("OD_SPEECH_SYNTHESIS_TIMEOUT"));
          }, maximumSynthesisMs);
          child.stdin.write(JSON.stringify({ text }) + "\n");
        };
        const receive = (chunk: Buffer) => {
          total += chunk.length;
          data += chunk.toString();
          if (data.length > 28_000_000 || total > 56_000_000) {
            finish(new Error("OD_SPEECH_TOO_LARGE"));
            return;
          }
          while (data.includes("\n") && !settled) {
            const newline = data.indexOf("\n");
            const line = data.slice(0, newline);
            data = data.slice(newline + 1);
            try {
              bounded.throwIfAborted();
              const result: unknown = JSON.parse(line);
              if (
                !result ||
                typeof result !== "object" ||
                Array.isArray(result) ||
                Object.keys(result).length !== 1
              )
                throw new Error("OD_SPEECH_AUDIO_INVALID");
              if ("ready" in result && result.ready === true && !this.#ready && !sent) {
                this.#ready = true;
                send();
                continue;
              }
              if ("error" in result) throw new Error("OD_SPEECH_ENGINE_FAILED");
              if (!sent) throw new Error("OD_SPEECH_AUDIO_INVALID");
              const encoded =
                "chunk" in result ? result.chunk : "audio" in result ? result.audio : null;
              if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded))
                throw new Error("OD_SPEECH_AUDIO_INVALID");
              const audio = Buffer.from(encoded, "base64");
              validateSpeechAudio(audio);
              if ("chunk" in result) {
                if (encoded.length > 8_000_000) throw new Error("OD_SPEECH_TOO_LARGE");
                resetActivity(false);
                onChunk(audio);
              } else finish(undefined, audio);
            } catch (error) {
              finish(
                error instanceof Error && /^OD_SPEECH_[A-Z_]+$/u.test(error.message)
                  ? error
                  : new Error("OD_SPEECH_AUDIO_INVALID"),
              );
            }
          }
        };
        child.stdout.on("data", receive);
        child.once("error", fail);
        child.once("exit", fail);
        child.stdin.once("error", fail);
        bounded.addEventListener("abort", abort, { once: true });
        resetActivity(!this.#ready);
        if (bounded.aborted) abort();
        else if (this.#ready) send();
      });
    } finally {
      if (this.#active === active) this.#active = null;
    }
  }
}
