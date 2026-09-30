import { randomUUID } from "node:crypto";
import {
  aiConnectionIdSchema,
  callNinaErrorSchema,
  dataRootGenerationSchema,
  directApiRouteSchema,
  errorDefinitions,
  generationCapabilitiesSchema,
  generationDeadlineMilliseconds,
  generationEventSchema,
  generationOperationStartSchema,
  generationOutputSchemaIds,
  modelRequestIdSchema,
  type DirectApiRoute,
  type GenerationEvent,
  type GenerationKind,
  type GenerationOperationFor,
  type GenerationOperationStart,
  type GenerationOutputMap,
  type GenerationResult,
  type GenerationService,
} from "@call-nina/contracts";
import {
  GenerationOutputValidationError,
  runLearningWorkflow,
} from "@call-nina/learning-workflows";
import { directApiCatalog, directApiSelection } from "./catalog.js";
import { DirectApiError, directApiFailure, generateDirectAttempt } from "./transport.js";

type Result = GenerationResult<GenerationKind, GenerationOutputMap>;
type RecordState = {
  operation: GenerationOperationStart;
  controller: AbortController;
  status: "running" | "validated" | "failed" | "cancelled";
  completion: Promise<Result>;
};

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      reject(new DirectApiError("cancellation", "OD_GENERATION_CANCELLED"));
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

/** A captured connection/root owns each service; secrets exist only during a call. */
export class DirectApiGenerationService implements GenerationService {
  readonly generationCapabilities;
  readonly #route: DirectApiRoute;
  readonly #connectionId: string;
  readonly #rootGeneration: number;
  readonly #readActiveCredential: () => Promise<string>;
  readonly #listeners = new Set<(event: GenerationEvent) => void>();
  readonly #records = new Map<string, RecordState>();
  #closed = false;

  constructor(options: {
    route: DirectApiRoute;
    connectionId: string;
    rootGeneration: number;
    // Main must validate the active connection, secret reference and root lease
    // before AND after its asynchronous privileged read. Never reads Settings.
    readActiveCredential: () => Promise<string>;
  }) {
    this.#route = directApiRouteSchema.parse(options.route);
    this.#connectionId = aiConnectionIdSchema.parse(options.connectionId);
    this.#rootGeneration = dataRootGenerationSchema.parse(options.rootGeneration);
    this.#readActiveCredential = options.readActiveCredential;
    this.generationCapabilities = generationCapabilitiesSchema.parse({
      providerId: this.#route,
      operations: directApiCatalog(this.#route).operations,
      structuredOutput: true,
      cancellation: true,
    });
  }

  subscribeGeneration(listener: (event: GenerationEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(value: unknown) {
    const event = generationEventSchema.parse(value);
    for (const listener of this.#listeners) {
      try {
        listener(structuredClone(event));
      } catch {
        /* Observers cannot change settlement. */
      }
    }
  }

  runOperation<Kind extends GenerationKind>(
    operation: GenerationOperationFor<Kind>,
  ): Promise<GenerationResult<Kind, GenerationOutputMap>> {
    const parsed = generationOperationStartSchema.parse(operation);
    if (this.#closed) throw new Error("OD_DIRECT_API_CLOSED");
    if (parsed.dataRootGeneration !== this.#rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
    directApiSelection(this.#route, parsed.modelSelection);
    const prior = this.#records.get(parsed.operationId);
    const submitted = [...this.#records.values()].find(
      (entry) => entry.operation.submissionId === parsed.submissionId,
    );
    if (prior || submitted) {
      const existing = prior ?? submitted;
      if (!existing || JSON.stringify(existing.operation) !== JSON.stringify(parsed))
        throw new Error("OD_OPERATION_SUBMISSION_CONFLICT");
      return existing.completion as Promise<GenerationResult<Kind, GenerationOutputMap>>;
    }
    // Main releases retained records with its submission cache. Do not evict
    // independently and accidentally make an accepted submission dispatch again.
    if (
      this.#records.size >= 256 ||
      [...this.#records.values()].filter((entry) => entry.status === "running").length >= 4
    )
      throw new Error("OD_OPERATION_SUBMISSION_LIMIT");
    const record: RecordState = {
      operation: parsed,
      controller: new AbortController(),
      status: "running",
      completion: Promise.resolve().then(() => this.#execute(record)),
    };
    this.#records.set(parsed.operationId, record);
    this.#emit({
      event: "operation-state-changed",
      state: {
        operationId: parsed.operationId,
        submissionId: parsed.submissionId,
        kind: parsed.input.kind,
        submission: "retained",
        status: "accepted",
      },
    });
    return record.completion as Promise<GenerationResult<Kind, GenerationOutputMap>>;
  }

  async #execute(record: RecordState): Promise<Result> {
    const { operation, controller } = record;
    const base = {
      operationId: operation.operationId,
      submissionId: operation.submissionId,
      kind: operation.input.kind,
    };
    const deadline = Date.now() + generationDeadlineMilliseconds[operation.input.kind];
    const timeoutFailure = new DirectApiError("ai-timeout", "OD_GENERATION_TIMEOUT");
    const timer = setTimeout(
      () => {
        controller.abort(timeoutFailure);
      },
      Math.max(1, deadline - Date.now()),
    );
    try {
      const selection = directApiSelection(this.#route, operation.modelSelection);
      const result = await abortable(
        runLearningWorkflow(
          {
            input: operation.input,
            signal: controller.signal,
            absoluteDeadlineMilliseconds: Math.max(1, deadline - Date.now()),
            onProgress: (stage, attempt) => {
              this.#emit({ event: "operation-progress", ...base, stage, attempt });
            },
          },
          async (attempt) => {
            controller.signal.throwIfAborted();
            if (Date.now() >= deadline)
              throw new DirectApiError("ai-timeout", "OD_GENERATION_TIMEOUT");
            this.#emit({
              event: "operation-progress",
              ...base,
              stage: "starting",
              attempt: attempt.attempt,
            });
            let secret: string;
            try {
              secret = await this.#readActiveCredential();
            } catch {
              throw new DirectApiError("authentication", "OD_CONNECTION_CREDENTIAL_UNAVAILABLE");
            }
            try {
              controller.signal.throwIfAborted();
              if (Date.now() >= deadline)
                throw new DirectApiError("ai-timeout", "OD_GENERATION_TIMEOUT");
              this.#emit({
                event: "operation-progress",
                ...base,
                stage: "running",
                attempt: attempt.attempt,
              });
              return await generateDirectAttempt({
                route: this.#route,
                ...selection,
                secret,
                attempt,
                signal: controller.signal,
              });
            } finally {
              secret = "";
            }
          },
        ),
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new DirectApiError("cancellation", "OD_GENERATION_CANCELLED");
      if (Date.now() >= deadline) throw new DirectApiError("ai-timeout", "OD_GENERATION_TIMEOUT");
      const validated: Result = {
        ...base,
        outputSchemaId: generationOutputSchemaIds[operation.input.kind],
        modelRequestId: modelRequestIdSchema.parse(
          `model-request_${randomUUID().replaceAll("-", "")}`,
        ),
        provenance: { connectionId: this.#connectionId, producer: this.#route, ...selection },
        output: result.output,
      };
      record.status = "validated";
      this.#emit({
        event: "operation-state-changed",
        state: { ...validated, status: "validated", submission: "retained" },
      });
      this.#emit({
        event: "operation-finished",
        ...base,
        outcome: {
          status: "validated",
          modelRequestId: validated.modelRequestId,
          outputSchemaId: validated.outputSchemaId,
        },
      });
      return validated;
    } catch (error) {
      const failure =
        controller.signal.reason === timeoutFailure || Date.now() >= deadline
          ? new DirectApiError("ai-timeout", "OD_GENERATION_TIMEOUT")
          : controller.signal.aborted
            ? new DirectApiError("cancellation", "OD_GENERATION_CANCELLED")
            : error instanceof GenerationOutputValidationError
              ? new DirectApiError("model-output", "OD_GENERATION_OUTPUT_INVALID")
              : directApiFailure(error);
      record.status = failure.kind === "cancellation" ? "cancelled" : "failed";
      const definition = errorDefinitions[failure.kind];
      const state =
        failure.kind === "cancellation"
          ? { status: "cancelled" }
          : failure.kind === "rate-limit"
            ? { status: "rate-limited", reached: "unknown", retryAt: failure.retryAt }
            : {
                status: "failed",
                error: callNinaErrorSchema.parse({
                  schemaVersion: 1,
                  kind: failure.kind,
                  ...definition,
                  reference: {
                    code: definition.code,
                    correlationId: operation.operationId,
                    occurredAt: new Date().toISOString(),
                  },
                }),
              };
      this.#emit({
        event: "operation-state-changed",
        state: { ...base, submission: "retained", ...state },
      });
      this.#emit({ event: "operation-finished", ...base, outcome: state });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }

  retryOperation<Kind extends GenerationKind>(
    options: Parameters<GenerationService["retryOperation"]>[0],
  ): Promise<GenerationResult<Kind, GenerationOutputMap>> {
    const prior = this.#records.get(options.previousOperationId);
    if (!prior || prior.status !== "failed") throw new Error("OD_OPERATION_RETRY_UNAVAILABLE");
    return this.runOperation({
      ...prior.operation,
      operationId: options.operationId,
      submissionId: options.submissionId,
    } as GenerationOperationFor<Kind>);
  }

  async cancelOperation(operationId: GenerationOperationStart["operationId"]): Promise<void> {
    const record = this.#records.get(operationId);
    if (!record || record.status !== "running") return;
    record.controller.abort();
    await record.completion.catch(() => undefined);
  }

  releaseOperation(operationId: GenerationOperationStart["operationId"]): void {
    if (this.#records.get(operationId)?.status !== "running") this.#records.delete(operationId);
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    for (const record of this.#records.values()) record.controller.abort();
    await Promise.allSettled([...this.#records.values()].map((entry) => entry.completion));
    this.#records.clear();
    this.#listeners.clear();
  }
}
