import type { Readable, Writable } from "node:stream";

export type JsonRpcHistoryEntry = Readonly<{
  direction: "in" | "out";
  kind: "request" | "response" | "notification" | "server-request" | "protocol-error";
  method?: string;
  requestId?: number;
  outcome?: "ok" | "error" | "timeout" | "cancelled" | "late" | "denied";
  occurredAt: string;
}>;

export class AppServerTransportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AppServerTransportError";
  }
}

type PendingRequest = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  abort: (() => void) | undefined;
  signal: AbortSignal | undefined;
};

type JsonObject = Record<string, unknown>;

export type JsonRpcTransportOptions = Readonly<{
  input: Writable;
  output: Readable;
  maximumLineBytes?: number;
  maximumHistoryEntries?: number;
  defaultTimeoutMilliseconds?: number;
  onNotification?: (method: string, params: unknown) => void;
  onServerRequest?: (method: string, params: unknown) => void;
  onFatalError?: (error: AppServerTransportError) => void;
}>;

const credentialFieldPattern =
  /^(?:accessToken|apiKey|idToken|refreshToken|authorization|cookie)$/iu;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialField);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => credentialFieldPattern.test(key) || containsCredentialField(nested),
  );
}

function requestFailureCode(error: JsonObject): string {
  let serialized = "";
  try {
    serialized = JSON.stringify(error).slice(0, 16 * 1024);
  } catch {
    return "APP_SERVER_REQUEST_FAILED";
  }
  return /(?:UsageLimitExceeded|rate.?limit)/iu.test(serialized)
    ? "APP_SERVER_RATE_LIMITED"
    : "APP_SERVER_REQUEST_FAILED";
}

function deniedServerRequest(id: number | string, method: string): JsonObject {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    return { id, result: { decision: "cancel" } };
  }
  if (method === "item/tool/requestUserInput") {
    return { id, result: { answers: {} } };
  }
  if (method === "mcpServer/elicitation/request") {
    return { id, result: { action: "cancel" } };
  }
  if (method === "item/permissions/requestApproval") {
    return {
      id,
      result: {
        permissions: { fileSystem: null, network: null },
        scope: "turn",
        strictAutoReview: true,
      },
    };
  }
  return { id, error: { code: -32601, message: "Client capability denied" } };
}

export class JsonRpcTransport {
  readonly #input: Writable;
  readonly #maximumLineBytes: number;
  readonly #maximumHistoryEntries: number;
  readonly #defaultTimeoutMilliseconds: number;
  readonly #onNotification: ((method: string, params: unknown) => void) | undefined;
  readonly #onServerRequest: ((method: string, params: unknown) => void) | undefined;
  readonly #onFatalError: ((error: AppServerTransportError) => void) | undefined;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #quarantinedIds = new Set<number>();
  readonly #completedIds = new Set<number>();
  readonly #history: JsonRpcHistoryEntry[] = [];
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #closedError: AppServerTransportError | undefined;

  constructor(options: JsonRpcTransportOptions) {
    this.#input = options.input;
    this.#maximumLineBytes = options.maximumLineBytes ?? 1024 * 1024;
    this.#maximumHistoryEntries = options.maximumHistoryEntries ?? 256;
    this.#defaultTimeoutMilliseconds = options.defaultTimeoutMilliseconds ?? 10_000;
    this.#onNotification = options.onNotification;
    this.#onServerRequest = options.onServerRequest;
    this.#onFatalError = options.onFatalError;
    options.output.on("data", (chunk: Buffer | string) => {
      this.#receiveChunk(chunk);
    });
    options.output.once("end", () => {
      if (this.#buffer.length > 0) {
        this.#protocolError("APP_SERVER_TRUNCATED_MESSAGE");
      } else {
        this.close(new AppServerTransportError("APP_SERVER_STDOUT_ENDED"));
      }
    });
    options.output.once("error", () => {
      this.close(new AppServerTransportError("APP_SERVER_STDOUT_FAILED"));
    });
    options.input.once("error", () => {
      this.close(new AppServerTransportError("APP_SERVER_STDIN_FAILED"));
    });
  }

  history(): readonly JsonRpcHistoryEntry[] {
    return this.#history.map((entry) => Object.freeze({ ...entry }));
  }

  request(
    method: string,
    params?: unknown,
    options: Readonly<{ timeoutMilliseconds?: number; signal?: AbortSignal }> = {},
  ): Promise<unknown> {
    if (!method) return Promise.reject(new AppServerTransportError("APP_SERVER_METHOD_INVALID"));
    if (this.#closedError) return Promise.reject(this.#closedError);
    if (options.signal?.aborted) {
      return Promise.reject(new AppServerTransportError("APP_SERVER_REQUEST_CANCELLED"));
    }
    const id = this.#nextId++;
    const timeout = options.timeoutMilliseconds ?? this.#defaultTimeoutMilliseconds;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        this.#remember(this.#quarantinedIds, id);
        if (pending.abort && options.signal)
          options.signal.removeEventListener("abort", pending.abort);
        this.#record({
          direction: "in",
          kind: "response",
          requestId: id,
          method,
          outcome: "timeout",
        });
        reject(new AppServerTransportError("APP_SERVER_REQUEST_TIMEOUT"));
      }, timeout);
      const pending: PendingRequest = {
        method,
        resolve,
        reject,
        timer,
        abort: undefined,
        signal: options.signal,
      };
      if (options.signal) {
        pending.abort = () => {
          if (!this.#pending.delete(id)) return;
          this.#remember(this.#quarantinedIds, id);
          clearTimeout(timer);
          this.#record({
            direction: "in",
            kind: "response",
            requestId: id,
            method,
            outcome: "cancelled",
          });
          reject(new AppServerTransportError("APP_SERVER_REQUEST_CANCELLED"));
        };
        options.signal.addEventListener("abort", pending.abort, { once: true });
      }
      this.#pending.set(id, pending);
    });
    this.#record({ direction: "out", kind: "request", requestId: id, method });
    this.#write({ id, method, ...(params === undefined ? {} : { params }) });
    return result;
  }

  notify(method: string, params?: unknown): void {
    if (!method) throw new AppServerTransportError("APP_SERVER_METHOD_INVALID");
    if (this.#closedError) throw this.#closedError;
    this.#record({ direction: "out", kind: "notification", method });
    const error = this.#write({ method, ...(params === undefined ? {} : { params }) });
    if (error) throw error;
  }

  close(error = new AppServerTransportError("APP_SERVER_TRANSPORT_CLOSED")): void {
    if (this.#closedError) return;
    this.#closedError = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      if (pending.abort && pending.signal) {
        pending.signal.removeEventListener("abort", pending.abort);
      }
      pending.reject(error);
    }
    this.#pending.clear();
    try {
      this.#onFatalError?.(error);
    } catch {
      // A diagnostic observer cannot change transport failure settlement.
    }
  }

  #write(message: JsonObject): AppServerTransportError | undefined {
    let line: string;
    try {
      line = `${JSON.stringify(message)}\n`;
    } catch {
      const error = new AppServerTransportError("APP_SERVER_OUTBOUND_MESSAGE_INVALID");
      this.close(error);
      return error;
    }
    if (Buffer.byteLength(line) > this.#maximumLineBytes) {
      const error = new AppServerTransportError("APP_SERVER_OUTBOUND_LINE_TOO_LARGE");
      this.close(error);
      return error;
    }
    if (!this.#input.write(line)) {
      const error = new AppServerTransportError("APP_SERVER_BACKPRESSURE");
      this.close(error);
      return error;
    }
    return undefined;
  }

  #receiveChunk(chunk: Buffer | string): void {
    if (this.#closedError) return;
    this.#buffer = Buffer.concat([
      this.#buffer,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    ]);
    if (this.#buffer.length > this.#maximumLineBytes && this.#buffer.indexOf(0x0a) === -1) {
      this.#protocolError("APP_SERVER_INBOUND_LINE_TOO_LARGE");
      return;
    }
    let newline = this.#buffer.indexOf(0x0a);
    while (newline !== -1) {
      const line = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (line.length > this.#maximumLineBytes) {
        this.#protocolError("APP_SERVER_INBOUND_LINE_TOO_LARGE");
        return;
      }
      this.#receiveLine(line);
      if (this.#history.at(-1)?.kind === "protocol-error") return;
      newline = this.#buffer.indexOf(0x0a);
    }
  }

  #receiveLine(line: Buffer): void {
    if (line.length === 0) {
      this.#protocolError("APP_SERVER_EMPTY_MESSAGE");
      return;
    }
    let message: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
      message = JSON.parse(text) as unknown;
    } catch {
      this.#protocolError("APP_SERVER_INVALID_JSON");
      return;
    }
    if (!isObject(message) || containsCredentialField(message)) {
      this.#protocolError(
        containsCredentialField(message)
          ? "APP_SERVER_CREDENTIAL_MATERIAL_REJECTED"
          : "APP_SERVER_MESSAGE_INVALID",
      );
      return;
    }
    const id = message["id"];
    const method = message["method"];
    if (id !== undefined && typeof method === "string") {
      if (
        (!Number.isInteger(id) && typeof id !== "string") ||
        method.length === 0 ||
        Object.hasOwn(message, "result") ||
        Object.hasOwn(message, "error")
      ) {
        this.#protocolError("APP_SERVER_SERVER_REQUEST_INVALID");
        return;
      }
      this.#record({ direction: "in", kind: "server-request", method, outcome: "denied" });
      try {
        this.#onServerRequest?.(method, message["params"]);
      } catch {
        // Observers cannot prevent the pinned denial response.
      }
      this.#write(deniedServerRequest(id as number | string, method));
      return;
    }
    if (id !== undefined) {
      if (!Number.isInteger(id) || (id as number) < 1) {
        this.#protocolError("APP_SERVER_RESPONSE_ID_INVALID");
        return;
      }
      const hasResult = Object.hasOwn(message, "result");
      const hasError = Object.hasOwn(message, "error");
      const error = message["error"];
      if (
        hasResult === hasError ||
        (hasError &&
          (!isObject(error) ||
            typeof error["code"] !== "number" ||
            typeof error["message"] !== "string"))
      ) {
        this.#protocolError("APP_SERVER_RESPONSE_INVALID");
        return;
      }
      const numericId = id as number;
      const pending = this.#pending.get(numericId);
      if (!pending) {
        if (this.#quarantinedIds.has(numericId)) {
          this.#record({
            direction: "in",
            kind: "response",
            requestId: numericId,
            outcome: "late",
          });
          return;
        }
        if (this.#completedIds.has(numericId)) {
          this.#protocolError("APP_SERVER_RESPONSE_DUPLICATE");
          return;
        }
        this.#protocolError("APP_SERVER_RESPONSE_UNCORRELATED");
        return;
      }
      this.#pending.delete(numericId);
      this.#remember(this.#completedIds, numericId);
      clearTimeout(pending.timer);
      if (pending.abort && pending.signal) {
        pending.signal.removeEventListener("abort", pending.abort);
      }
      if (hasError) {
        this.#record({
          direction: "in",
          kind: "response",
          requestId: numericId,
          method: pending.method,
          outcome: "error",
        });
        pending.reject(new AppServerTransportError(requestFailureCode(error as JsonObject)));
      } else {
        this.#record({
          direction: "in",
          kind: "response",
          requestId: numericId,
          method: pending.method,
          outcome: "ok",
        });
        pending.resolve(message["result"]);
      }
      return;
    }
    if (typeof method !== "string" || method.length === 0) {
      this.#protocolError("APP_SERVER_NOTIFICATION_INVALID");
      return;
    }
    this.#record({ direction: "in", kind: "notification", method });
    try {
      this.#onNotification?.(method, message["params"]);
    } catch {
      // Observers cannot disrupt protocol correlation or transport ownership.
    }
  }

  #protocolError(code: string): void {
    this.#record({ direction: "in", kind: "protocol-error", outcome: "error" });
    this.close(new AppServerTransportError(code));
  }

  #record(entry: Omit<JsonRpcHistoryEntry, "occurredAt">): void {
    this.#history.push(Object.freeze({ ...entry, occurredAt: new Date().toISOString() }));
    if (this.#history.length > this.#maximumHistoryEntries) this.#history.shift();
  }

  #remember(set: Set<number>, id: number): void {
    set.add(id);
    if (set.size > this.#maximumHistoryEntries) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
  }
}
