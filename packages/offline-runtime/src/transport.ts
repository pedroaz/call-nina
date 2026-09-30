import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { type LearningAttempt } from "@call-nina/learning-workflows";
import { offlineCandidate } from "./candidate.js";
import {
  assertNotAborted,
  acquire,
  directory,
  exists,
  fail,
  onlyNames,
  removeFile,
  writeNew,
} from "./files.js";
import { type ArtifactStore } from "./store.js";

function localRequest(
  socketPath: string,
  key: string,
  endpoint: "/v1/models" | "/v1/chat/completions",
  body: string | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: endpoint,
        method: body ? "POST" : "GET",
        agent: false,
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 128 * 1024) {
            req.destroy(new Error("OD_OFFLINE_OUTPUT_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () => {
          reject(new Error("OD_OFFLINE_TRANSPORT_FAILED"));
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error("OD_OFFLINE_RUNTIME_RESPONSE_INVALID"));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as unknown);
          } catch {
            reject(new Error("OD_OFFLINE_RUNTIME_RESPONSE_INVALID"));
          }
        });
      },
    );
    req.on("error", () => {
      reject(new Error(signal.aborted ? "OD_OFFLINE_CANCELLED" : "OD_OFFLINE_TRANSPORT_FAILED"));
    });
    req.end(body);
  });
}
const modelsSchema = z.object({
  data: z
    .array(z.object({ id: z.string() }))
    .min(1)
    .max(4),
});
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.literal("stop"),
        message: z.object({
          content: z
            .string()
            .min(1)
            .max(64 * 1024),
          tool_calls: z.array(z.never()).optional(),
        }),
      }),
    )
    .length(1),
});

async function clearSession(session: string) {
  await onlyNames(session, ["api-key", "server.sock"]);
  const socket = path.join(session, "server.sock");
  if (await exists(socket)) {
    const stat = await lstat(socket);
    if (!stat.isSocket() || stat.uid !== process.getuid?.()) fail("SESSION_UNSAFE");
    await unlink(socket);
  }
  await removeFile(path.join(session, "api-key"));
}
// One child per attempt: cancellation/settlement also releases model memory.
// No recovered PID is ever signalled. A live orphan's ownership record blocks reuse.
export class OfflineTransport {
  private child: ChildProcess | null = null;
  private closed: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  constructor(private readonly store: ArtifactStore) {}
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    const closed = this.closed;
    if (!child || !closed) return Promise.resolve();
    this.stopping = (async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 3000);
      timer.unref();
      try {
        await closed;
      } finally {
        clearTimeout(timer);
        this.child = null;
        this.closed = null;
        this.stopping = null;
      }
    })();
    return this.stopping;
  }
  async generate(attempt: LearningAttempt, active: () => boolean): Promise<string> {
    if (!active()) fail("INACTIVE");
    if (this.child) fail("BUSY");
    const budget = attempt.deadline - Date.now();
    if (budget <= 0 || budget > 120_000) fail("DEADLINE_INVALID");
    const signal = AbortSignal.any([
      AbortSignal.timeout(budget),
      ...(attempt.signal ? [attempt.signal] : []),
    ]);
    const flight = await this.store.preflight();
    if (!flight.platformSupported) fail("PLATFORM_UNSUPPORTED");
    if (!flight.memorySufficient) fail("MEMORY_INSUFFICIENT");
    const lock = await acquire(this.store.root);
    const session = path.join(this.store.root, "session");
    let spawned = false;
    let childSettled = true;
    try {
      const files = await this.store.verified(signal);
      await directory(session);
      await clearSession(session);
      const socket = path.join(session, "server.sock");
      // Linux sockaddr_un.sun_path includes the terminating NUL.
      if (Buffer.byteLength(socket) > 107) fail("SOCKET_PATH_TOO_LONG");
      const key = randomBytes(32).toString("hex");
      await writeNew(path.join(session, "api-key"), key);
      if (!active()) fail("INACTIVE");
      assertNotAborted(signal);
      // Commit uncertainty before native launch. An interrupted identity write
      // must never be recovered as evidence that no child was spawned.
      await lock.spawning();
      if (!active()) fail("INACTIVE");
      assertNotAborted(signal);
      childSettled = false;
      const child = spawn(
        files.executable,
        [
          "--model",
          files.model,
          "--alias",
          offlineCandidate.modelId,
          "--host",
          socket,
          "--api-key-file",
          path.join(session, "api-key"),
          "--offline",
          "--no-webui",
          "--no-webui-mcp-proxy",
          "--no-context-shift",
          "--no-cache-prompt",
          "--parallel",
          "1",
          "--ctx-size",
          String(offlineCandidate.contextTokens),
          "--n-predict",
          String(offlineCandidate.outputTokens),
          "--n-gpu-layers",
          "0",
          "--threads",
          "4",
          "--reasoning-budget",
          "0",
          "--chat-template-kwargs",
          '{"enable_thinking":false}',
          "--log-disable",
        ],
        {
          cwd: session,
          stdio: "ignore",
          shell: false,
          detached: false,
          env: {
            HOME: session,
            TMPDIR: session,
            LANG: "C.UTF-8",
          },
        },
      );
      // Normal main-process exit still stops only this exact child. Recovery
      // never signals persisted PIDs; a live recorded orphan blocks acquisition.
      const onExit = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      };
      process.once("exit", onExit);
      child.once("close", () => {
        process.removeListener("exit", onExit);
      });
      this.child = child;
      spawned = true;
      let exited = false;
      const hasExited = () => exited;
      this.closed = new Promise((resolve) => {
        child.once("close", () => {
          exited = true;
          resolve();
        });
      });
      // Always consume spawn errors; no raw runtime output/path is exposed.
      child.on("error", () => {
        exited = true;
      });
      if (!child.pid) fail("RUNTIME_START_FAILED");
      await lock.child(child.pid);
      const onAbort = () => {
        void this.stop();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      try {
        for (;;) {
          assertNotAborted(signal);
          if (hasExited()) fail("RUNTIME_EXITED");
          if (!active()) fail("INACTIVE");
          try {
            const models = modelsSchema.parse(
              await localRequest(
                socket,
                key,
                "/v1/models",
                undefined,
                AbortSignal.any([signal, AbortSignal.timeout(1000)]),
              ),
            );
            if (!models.data.some((model) => model.id === offlineCandidate.modelId))
              fail("MODEL_INVALID");
            break;
          } catch {
            if (hasExited()) fail("RUNTIME_EXITED");
          }
          await delay(200, undefined, { signal });
        }
        if (!active()) fail("INACTIVE");
        const body = JSON.stringify({
          model: offlineCandidate.modelId,
          messages: [
            { role: "system", content: `${attempt.instructions}\n${attempt.teachingInstructions}` },
            { role: "user", content: attempt.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "nina_learning_result",
              strict: true,
              schema: attempt.outputSchema,
            },
          },
          max_tokens: offlineCandidate.outputTokens,
          temperature: 0.2,
          stream: false,
          cache_prompt: false,
        });
        if (Buffer.byteLength(body) > 32 * 1024) fail("INPUT_TOO_LARGE");
        const result = completionSchema.parse(
          await localRequest(socket, key, "/v1/chat/completions", body, signal),
        );
        assertNotAborted(signal);
        if (!active()) fail("INACTIVE");
        const output = result.choices[0]?.message.content;
        if (!output) fail("OUTPUT_INVALID");
        return output;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } finally {
      try {
        if (spawned) {
          await this.stop();
          childSettled = true;
        }
      } finally {
        try {
          if (childSettled && (await exists(session))) await clearSession(session);
        } finally {
          await lock.release({ childSettled });
        }
      }
    }
  }
}
