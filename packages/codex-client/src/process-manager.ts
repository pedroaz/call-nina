import {
  spawn as spawnChild,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";

import type { OperationalLogRecord } from "@call-nina/contracts";

import {
  prepareStandaloneRuntime,
  standaloneArguments,
  assertStandaloneConfiguration,
  type StandaloneRuntimeOptions,
} from "./standalone-runtime.js";
import { codexRuntimeVersion } from "./runtime-release.js";
import { scrubCodexEnvironment } from "./environment.js";
import { AppServerTransportError, JsonRpcTransport, type JsonRpcHistoryEntry } from "./json-rpc.js";

export type AppServerLifecycleState =
  "stopped" | "discovering" | "starting" | "initializing" | "ready" | "stopping" | "failed";

export type AppServerLogRecord = OperationalLogRecord;

export type AppServerProcessManagerOptions = Readonly<{
  standalone?: StandaloneRuntimeOptions;
  initializeTimeoutMilliseconds?: number;
  requestTimeoutMilliseconds?: number;
  shutdownGraceMilliseconds?: number;
  maximumProtocolLineBytes?: number;
  maximumHistoryEntries?: number;
  maximumStderrBytes?: number;
  runId?: string;
  sessionId?: string;
  log?: (record: AppServerLogRecord) => void;
  onNotification?: (method: string, params: unknown) => void;
  onServerRequest?: (method: string, params: unknown) => void;
  spawn?: (
    executable: string,
    arguments_: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams;
}>;

export class AppServerUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`APP_SERVER_UNAVAILABLE: ${reason}`);
    this.name = "AppServerUnavailableError";
  }
}

export class AppServerProcessManager {
  readonly #options: AppServerProcessManagerOptions;
  #state: AppServerLifecycleState = "stopped";
  #child: ChildProcessWithoutNullStreams | undefined;
  #transport: JsonRpcTransport | undefined;
  #startPromise: Promise<void> | undefined;
  #shutdownPromise: Promise<void> | undefined;
  #expectedExit = false;
  #codexVersion: string | undefined;
  #stderrBytes = 0;
  #stderrTruncated = false;
  readonly #notificationListeners = new Set<(method: string, params: unknown) => void>();
  readonly #serverRequestListeners = new Set<(method: string, params: unknown) => void>();
  readonly #lifecycleListeners = new Set<(state: AppServerLifecycleState) => void>();

  constructor(options: AppServerProcessManagerOptions = {}) {
    this.#options = options;
  }

  state(): AppServerLifecycleState {
    return this.#state;
  }

  version(): string | undefined {
    return this.#codexVersion;
  }

  history(): readonly JsonRpcHistoryEntry[] {
    return this.#transport?.history() ?? [];
  }

  subscribeNotifications(listener: (method: string, params: unknown) => void): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  subscribeServerRequests(listener: (method: string, params: unknown) => void): () => void {
    this.#serverRequestListeners.add(listener);
    return () => this.#serverRequestListeners.delete(listener);
  }

  subscribeLifecycle(listener: (state: AppServerLifecycleState) => void): () => void {
    this.#lifecycleListeners.add(listener);
    return () => this.#lifecycleListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#state === "ready") return Promise.resolve();
    if (this.#startPromise) return this.#startPromise;
    if (this.#state === "stopping" || this.#shutdownPromise) {
      return Promise.reject(new AppServerUnavailableError("stopping"));
    }
    this.#startPromise = this.#startOwnedProcess().finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  async request(
    method: string,
    params?: unknown,
    options?: Readonly<{ timeoutMilliseconds?: number; signal?: AbortSignal }>,
  ): Promise<unknown> {
    if (this.#state !== "ready" || !this.#transport) {
      return Promise.reject(new AppServerUnavailableError("not-ready"));
    }
    try {
      return await this.#transport.request(method, params, options);
    } catch (error) {
      if (
        error instanceof AppServerTransportError &&
        error.code === "APP_SERVER_STDOUT_ENDED" &&
        this.#child
      ) {
        await this.#waitForClose(this.#child, this.#options.shutdownGraceMilliseconds ?? 2_000);
        throw new AppServerTransportError("APP_SERVER_PROCESS_EXITED");
      }
      throw error;
    }
  }

  notify(method: string, params: unknown = {}): void {
    if (this.#state !== "ready" || !this.#transport) {
      throw new AppServerUnavailableError("not-ready");
    }
    this.#transport.notify(method, params);
  }

  shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    const pendingStart = this.#startPromise;
    this.#shutdownPromise = (async () => {
      if (pendingStart) {
        try {
          await pendingStart;
        } catch {
          // Start retains ownership and performs its own cleanup before rejecting.
        }
      }
      await this.#shutdownOwnedProcess();
    })().finally(() => {
      this.#shutdownPromise = undefined;
    });
    return this.#shutdownPromise;
  }

  async #startOwnedProcess(): Promise<void> {
    if (this.#child) await this.#shutdownOwnedProcess();
    this.#setState("discovering");
    let runtime: Awaited<ReturnType<typeof prepareStandaloneRuntime>>;
    try {
      if (!this.#options.standalone) throw new Error("CODEX_RUNTIME_MISSING");
      runtime = await prepareStandaloneRuntime(this.#options.standalone);
    } catch {
      this.#setState("failed");
      this.#log(
        "error",
        "CODEX_STANDALONE_UNAVAILABLE",
        "The app-owned Codex runtime could not be prepared.",
      );
      throw new AppServerUnavailableError("standalone-unavailable");
    }
    const environment = scrubCodexEnvironment(runtime.environment);
    this.#setState("starting");
    this.#expectedExit = false;
    this.#stderrBytes = 0;
    this.#stderrTruncated = false;
    const spawn =
      this.#options.spawn ??
      ((command, arguments_, options) =>
        spawnChild(command, arguments_, { ...options, stdio: ["pipe", "pipe", "pipe"] }));
    const child = spawn(runtime.executable, standaloneArguments, {
      cwd: runtime.cwd,
      env: environment,
      windowsHide: true,
    });
    this.#child = child;
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.#collectStderr(chunk);
    });
    child.once("error", () => {
      if (this.#child === child) this.#ownedProcessFailed("APP_SERVER_PROCESS_ERROR");
    });
    child.once("close", (code, signal) => {
      if (this.#child === child) this.#ownedProcessClosed(code, signal);
    });
    const transport = new JsonRpcTransport({
      input: child.stdin,
      output: child.stdout,
      defaultTimeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 10_000,
      maximumLineBytes: this.#options.maximumProtocolLineBytes ?? 1024 * 1024,
      maximumHistoryEntries: this.#options.maximumHistoryEntries ?? 256,
      onNotification: (method, params) => {
        if (this.#child !== child) return;
        this.#options.onNotification?.(method, params);
        for (const listener of this.#notificationListeners) listener(method, params);
      },
      onServerRequest: (method, params) => {
        if (this.#child !== child) return;
        this.#options.onServerRequest?.(method, params);
        for (const listener of this.#serverRequestListeners) listener(method, params);
      },
      onFatalError: (error) => {
        if (this.#child === child) this.#transportFailed(error);
      },
    });
    this.#transport = transport;
    this.#setState("initializing");
    let startupStage = "initialize";
    try {
      const initializeResult = await transport.request(
        "initialize",
        { clientInfo: { name: "open_deutsch", title: "Call Nina", version: "0.1.0" } },
        { timeoutMilliseconds: this.#options.initializeTimeoutMilliseconds ?? 10_000 },
      );
      if (
        typeof initializeResult !== "object" ||
        initializeResult === null ||
        Array.isArray(initializeResult) ||
        !("userAgent" in initializeResult) ||
        typeof initializeResult.userAgent !== "string" ||
        initializeResult.userAgent.trim().length === 0
      ) {
        throw new AppServerUnavailableError("initialize-invalid");
      }
      transport.notify("initialized");
      startupStage = "configuration-read";
      const configuration = await transport.request(
        "config/read",
        {
          includeLayers: false,
          cwd: runtime.cwd,
        },
        { timeoutMilliseconds: this.#options.initializeTimeoutMilliseconds ?? 10_000 },
      );
      startupStage = "configuration-validate";
      assertStandaloneConfiguration(configuration);
      this.#codexVersion = codexRuntimeVersion;
      this.#setState("ready");
      this.#log("info", "APP_SERVER_READY", "Codex App Server initialized.", {
        version: codexRuntimeVersion,
      });
    } catch (error) {
      this.#log("error", "APP_SERVER_STARTUP_FAILED", "Codex App Server startup failed.", {
        stage: startupStage,
      });
      await this.#shutdownOwnedProcess();
      this.#setState("failed");
      throw error;
    }
  }

  async #shutdownOwnedProcess(): Promise<void> {
    const child = this.#child;
    if (!child) {
      this.#setState("stopped");
      return;
    }
    this.#setState("stopping");
    this.#expectedExit = true;
    this.#transport?.close(new AppServerTransportError("APP_SERVER_SHUTTING_DOWN"));
    if (child.exitCode === null && child.signalCode === null && !child.stdin.destroyed) {
      child.stdin.end();
    }
    if (!(await this.#waitForClose(child, this.#options.shutdownGraceMilliseconds ?? 2_000))) {
      child.kill("SIGTERM");
      if (!(await this.#waitForClose(child, this.#options.shutdownGraceMilliseconds ?? 2_000))) {
        child.kill("SIGKILL");
        if (!(await this.#waitForClose(child, this.#options.shutdownGraceMilliseconds ?? 2_000))) {
          this.#setState("failed");
          this.#log(
            "error",
            "APP_SERVER_SHUTDOWN_FAILED",
            "Codex App Server did not report termination.",
          );
          throw new AppServerUnavailableError("shutdown-failed");
        }
      }
    }
    this.#child = undefined;
    this.#transport = undefined;
    this.#setState("stopped");
    this.#log("info", "APP_SERVER_STOPPED", "Codex App Server stopped.", {
      stderrBytes: this.#stderrBytes,
      stderrTruncated: this.#stderrTruncated,
    });
  }

  #waitForClose(child: ChildProcessWithoutNullStreams, timeout: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.removeListener("close", closed);
        resolve(false);
      }, timeout);
      const closed = () => {
        clearTimeout(timer);
        resolve(true);
      };
      child.once("close", closed);
    });
  }

  #collectStderr(chunk: Buffer | string): void {
    const bytes = Buffer.byteLength(chunk);
    const maximum = this.#options.maximumStderrBytes ?? 8_192;
    if (this.#stderrBytes + bytes > maximum) this.#stderrTruncated = true;
    this.#stderrBytes = Math.min(maximum, this.#stderrBytes + bytes);
  }

  #transportFailed(error: AppServerTransportError): void {
    if (this.#expectedExit || this.#state === "stopping" || this.#state === "stopped") return;
    this.#setState("failed");
    this.#log("error", "APP_SERVER_PROTOCOL_FAILED", "Codex App Server protocol failed.", {
      reason: error.code,
    });
    if (this.#child?.exitCode === null && this.#child.signalCode === null)
      this.#child.kill("SIGTERM");
  }

  #ownedProcessFailed(code: string): void {
    if (this.#expectedExit) return;
    this.#setState("failed");
    this.#transport?.close(new AppServerTransportError(code));
    this.#log("error", code, "Codex App Server process failed.");
  }

  #ownedProcessClosed(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#expectedExit) return;
    this.#setState("failed");
    this.#transport?.close(new AppServerTransportError("APP_SERVER_PROCESS_EXITED"));
    this.#log("error", "APP_SERVER_PROCESS_EXITED", "Codex App Server exited unexpectedly.", {
      exitCode: code,
      signal: signal ?? "none",
    });
  }

  #setState(state: AppServerLifecycleState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of this.#lifecycleListeners) {
      try {
        listener(state);
      } catch {
        // Observers cannot take ownership of or disrupt the managed process.
      }
    }
  }

  #log(
    severity: AppServerLogRecord["severity"],
    code: string,
    message: string,
    metadata?: AppServerLogRecord["metadata"],
  ): void {
    try {
      this.#options.log?.(
        Object.freeze({
          timestamp: new Date().toISOString(),
          severity,
          component: "app-server",
          code,
          message,
          action: "lifecycle/app-server",
          phase: severity === "error" ? "failed" : "completed",
          outcome: severity === "error" ? "error" : "ok",
          ...(this.#options.runId === undefined ? {} : { runId: this.#options.runId }),
          ...(this.#options.sessionId === undefined ? {} : { sessionId: this.#options.sessionId }),
          ...(metadata === undefined ? {} : { metadata: Object.freeze({ ...metadata }) }),
        }),
      );
    } catch {
      // Log sinks cannot disrupt owned process lifecycle or cleanup.
    }
  }
}
