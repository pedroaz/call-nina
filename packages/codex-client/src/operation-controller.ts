import { createHash } from "node:crypto";

import { AppServerOutputValidationError } from "./output-validation.js";

export type OperationStage =
  | "queued"
  | "running"
  | "validating"
  | "cancelling"
  | "succeeded"
  | "cancelled"
  | "rate-limited"
  | "failed";

export type OperationEvent = Readonly<{
  operationId: string;
  stage: OperationStage;
}>;

export type OperationOutcome<Output> =
  | Readonly<{ status: "succeeded"; output: Output }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "rate-limited" }>
  | Readonly<{ status: "failed"; errorCode: string; errorKind?: "model-output" }>;

export type ExecuteContext = Readonly<{
  signal: AbortSignal;
  validating(): void;
}>;

type RecordState<Input, Output> = {
  readonly operationId: string;
  readonly submissionId: string;
  input: Input | undefined;
  readonly inputHash: string;
  readonly controller: AbortController;
  stage: OperationStage;
  completion: Promise<OperationOutcome<Output>>;
};

const terminalStages = new Set<OperationStage>([
  "succeeded",
  "cancelled",
  "rate-limited",
  "failed",
]);
const maximumRetainedSubmissions = 256;

export class OperationRateLimitedError extends Error {
  constructor() {
    super("OD_RATE_LIMITED");
    this.name = "OperationRateLimitedError";
  }
}

function inputHash(value: unknown): string {
  const serialized: unknown = JSON.stringify(value);
  return createHash("sha256")
    .update(typeof serialized === "string" ? serialized : "undefined")
    .digest("hex");
}

function safeFailureCode(error: unknown): string {
  if (error instanceof Error && /^(?:OD|APP_SERVER)_[A-Z0-9_]{3,100}$/u.test(error.message)) {
    return error.message;
  }
  return "OD_APP_SERVER_OPERATION_FAILED";
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export class OperationController<Input, Output> {
  readonly #bySubmission = new Map<string, RecordState<Input, Output>>();
  readonly #byOperation = new Map<string, RecordState<Input, Output>>();
  readonly #listeners = new Set<(event: OperationEvent) => void>();

  constructor(readonly options: { onForgot?: (operationId: string) => void } = {}) {}

  start(options: {
    submissionId: string;
    operationId: string;
    input: Input;
    execute(input: Input, context: ExecuteContext): Promise<Output>;
  }): Readonly<{
    accepted: "started" | "replayed";
    operationId: string;
    completion: Promise<OperationOutcome<Output>>;
  }> {
    const hash = inputHash(options.input);
    const previous = this.#bySubmission.get(options.submissionId);
    if (previous) {
      if (previous.inputHash !== hash) throw new Error("OD_OPERATION_SUBMISSION_CONFLICT");
      return Object.freeze({
        accepted: "replayed" as const,
        operationId: previous.operationId,
        completion: previous.completion,
      });
    }
    for (const retained of this.#bySubmission.values()) {
      if (this.#bySubmission.size < maximumRetainedSubmissions) break;
      this.forget(retained.operationId);
    }
    if (this.#bySubmission.size >= maximumRetainedSubmissions) {
      throw new Error("OD_OPERATION_SUBMISSION_LIMIT");
    }
    if (this.#byOperation.has(options.operationId)) {
      throw new Error("OD_OPERATION_ID_CONFLICT");
    }

    const state: RecordState<Input, Output> = {
      operationId: options.operationId,
      submissionId: options.submissionId,
      input: structuredClone(options.input),
      inputHash: hash,
      controller: new AbortController(),
      stage: "queued",
      completion: Promise.resolve({ status: "cancelled" }),
    };
    state.completion = Promise.resolve().then(async () => {
      if (isAborted(state.controller.signal)) return this.#finish(state, { status: "cancelled" });
      this.#transition(state, "running");
      try {
        const retainedInput = state.input;
        if (retainedInput === undefined) throw new Error("OD_OPERATION_INPUT_UNAVAILABLE");
        const output = await options.execute(retainedInput, {
          signal: state.controller.signal,
          validating: () => {
            if (!isAborted(state.controller.signal)) this.#transition(state, "validating");
          },
        });
        if (isAborted(state.controller.signal)) {
          return this.#finish(state, { status: "cancelled" });
        }
        return this.#finish(state, { status: "succeeded", output });
      } catch (error) {
        if (isAborted(state.controller.signal)) {
          return this.#finish(state, { status: "cancelled" });
        }
        if (error instanceof OperationRateLimitedError) {
          return this.#finish(state, { status: "rate-limited" });
        }
        return this.#finish(state, {
          status: "failed",
          errorCode: safeFailureCode(error),
          ...(error instanceof AppServerOutputValidationError
            ? { errorKind: "model-output" as const }
            : {}),
        });
      }
    });
    this.#bySubmission.set(options.submissionId, state);
    this.#byOperation.set(options.operationId, state);
    this.#emit(state);
    return Object.freeze({
      accepted: "started" as const,
      operationId: state.operationId,
      completion: state.completion,
    });
  }

  cancel(operationId: string): boolean {
    const state = this.#byOperation.get(operationId);
    if (!state || terminalStages.has(state.stage)) return false;
    if (state.stage !== "cancelling") this.#transition(state, "cancelling");
    state.controller.abort();
    return true;
  }

  forget(operationId: string): boolean {
    const state = this.#byOperation.get(operationId);
    if (!state || !terminalStages.has(state.stage)) return false;
    state.input = undefined;
    this.#byOperation.delete(operationId);
    this.#bySubmission.delete(state.submissionId);
    this.options.onForgot?.(operationId);
    return true;
  }

  retry(options: {
    previousOperationId: string;
    submissionId: string;
    operationId: string;
    execute(input: Input, context: ExecuteContext): Promise<Output>;
    retain?: (previousInput: Input) => Input;
  }) {
    const previous = this.#byOperation.get(options.previousOperationId);
    if (
      !previous ||
      previous.input === undefined ||
      !["failed", "rate-limited"].includes(previous.stage)
    ) {
      throw new Error("OD_OPERATION_RETRY_UNAVAILABLE");
    }
    return this.start({
      submissionId: options.submissionId,
      operationId: options.operationId,
      input: options.retain ? options.retain(previous.input) : previous.input,
      execute: (input, context) => options.execute(input, context),
    });
  }

  subscribe(listener: (event: OperationEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #transition(state: RecordState<Input, Output>, stage: OperationStage): void {
    if (terminalStages.has(state.stage)) return;
    state.stage = stage;
    this.#emit(state);
  }

  #finish<Result extends OperationOutcome<Output>>(
    state: RecordState<Input, Output>,
    result: Result,
  ): Result {
    const stage = result.status;
    if (!terminalStages.has(state.stage)) {
      state.stage = stage;
      if (stage === "succeeded" || stage === "cancelled") state.input = undefined;
      this.#emit(state);
    }
    return Object.freeze(result);
  }

  #emit(state: RecordState<Input, Output>): void {
    const event = Object.freeze({ operationId: state.operationId, stage: state.stage });
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Renderer/event observers cannot change operation settlement.
      }
    }
  }
}
