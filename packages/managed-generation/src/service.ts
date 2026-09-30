import { randomUUID } from "node:crypto";
import {
  aiConnectionIdSchema,
  callNinaErrorSchema,
  dataRootGenerationSchema,
  errorDefinitions,
  generationCapabilitiesSchema,
  generationDeadlineMilliseconds,
  generationEventSchema,
  generationOperationStartSchema,
  generationOutputSchemaIds,
  modelRequestIdSchema,
  modelCatalogSchema,
  generationKinds,
  type ErrorKind,
  type GenerationEvent,
  type GenerationKind,
  type GenerationOperationFor,
  type GenerationOperationStart,
  type GenerationOutputMap,
  type GenerationResult,
  type GenerationService,
} from "@call-nina/contracts";
import {
  ManagedFailure,
  runManagedOperation,
  shippedManagedConfiguration,
  type ManagedClientConfiguration,
} from "./client.js";

class ManagedGenerationError extends Error {
  constructor(
    readonly kind: ErrorKind,
    code: string,
    readonly retryAt: number | null = null,
  ) {
    super(code);
  }
}
function managedFailure(error: unknown): ManagedGenerationError {
  if (error instanceof ManagedGenerationError) return error;
  if (error instanceof ManagedFailure) {
    const kind: ErrorKind =
      error.code === "cancelled"
        ? "cancellation"
        : error.code === "deadline"
          ? "ai-timeout"
          : error.code === "throttled" || error.code === "exhausted"
            ? "rate-limit"
            : error.code === "invalid-output"
              ? "model-output"
              : "app-server";
    return new ManagedGenerationError(kind, error.message);
  }
  return new ManagedGenerationError("app-server", "OD_MANAGED_UNAVAILABLE");
}

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
      reject(new ManagedGenerationError("cancellation", "OD_GENERATION_CANCELLED"));
    };
    if (signal.aborted) aborted();
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

/** Static application policy only: reading it never contacts the service. */
export function managedCatalog() {
  const configuration: ManagedClientConfiguration | null = shippedManagedConfiguration;
  if (!configuration) return null;
  return {
    models: modelCatalogSchema.parse({
      models: [
        {
          id: configuration.modelId,
          displayName: configuration.modelId,
          isDefault: true,
          defaultReasoningEffort: "runtime-default",
          supportedReasoningEfforts: ["runtime-default"],
          inputModalities: ["text"],
          upgrade: null,
        },
      ],
      runtimeDefaultModelId: configuration.modelId,
      missingReasoningMetadata: [],
    }),
    operations: [...generationKinds],
    languages: ["en-US", "pt-BR", "es", "de"] as const,
  };
}

/** A captured connection/root owns the retained desktop lifecycle. */
export class ManagedGenerationService implements GenerationService {
  readonly generationCapabilities;
  readonly #configuration: ManagedClientConfiguration | null;
  readonly #connectionId: string;
  readonly #rootGeneration: number;
  readonly #assertActive: () => void;
  readonly #listeners = new Set<(event: GenerationEvent) => void>();
  readonly #records = new Map<string, RecordState>();
  #closed = false;

  constructor(options: {
    configuration?: ManagedClientConfiguration | null;
    connectionId: string;
    rootGeneration: number;
    // Main checks its captured active connection and data-root lease before a
    // dispatch and before committing a result. No credential reader is accepted.
    assertActive: () => void;
  }) {
    this.#configuration = options.configuration
      ? Object.freeze({ ...options.configuration })
      : shippedManagedConfiguration;
    this.#connectionId = aiConnectionIdSchema.parse(options.connectionId);
    this.#rootGeneration = dataRootGenerationSchema.parse(options.rootGeneration);
    this.#assertActive = options.assertActive;
    this.generationCapabilities = generationCapabilitiesSchema.parse({
      providerId: "managed",
      operations: this.#configuration ? generationKinds : [],
      structuredOutput: true,
      cancellation: true,
    });
  }

  #selection(operation: GenerationOperationStart) {
    if (!this.#configuration)
      throw new ManagedGenerationError("app-server", "OD_MANAGED_UNAVAILABLE");
    if (
      operation.modelSelection.model.selection !== "exact" ||
      operation.modelSelection.model.modelId !== this.#configuration.modelId ||
      operation.modelSelection.effort.selection !== "runtime-default"
    )
      throw new ManagedGenerationError("model-unavailable", "OD_MANAGED_SELECTION_UNAVAILABLE");
    this.#assertActive();
    return { modelId: this.#configuration.modelId, effortId: "runtime-default" };
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
    if (this.#closed) throw new Error("OD_MANAGED_CLOSED");
    if (parsed.dataRootGeneration !== this.#rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
    this.#selection(parsed);
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
    const timeoutFailure = new ManagedGenerationError("ai-timeout", "OD_GENERATION_TIMEOUT");
    const timer = setTimeout(
      () => {
        controller.abort(timeoutFailure);
      },
      Math.max(1, deadline - Date.now()),
    );
    try {
      const selection = this.#selection(operation);
      this.#emit({ event: "operation-progress", ...base, stage: "running", attempt: 1 });
      const result = await abortable(
        runManagedOperation({
          configuration: this.#configuration,
          input: operation.input,
          signal: controller.signal,
        }),
        controller.signal,
      );
      this.#assertActive();
      if (controller.signal.aborted)
        throw new ManagedGenerationError("cancellation", "OD_GENERATION_CANCELLED");
      if (Date.now() >= deadline)
        throw new ManagedGenerationError("ai-timeout", "OD_GENERATION_TIMEOUT");
      const validated: Result = {
        ...base,
        outputSchemaId: generationOutputSchemaIds[operation.input.kind],
        modelRequestId: modelRequestIdSchema.parse(
          `model-request_${randomUUID().replaceAll("-", "")}`,
        ),
        provenance: { connectionId: this.#connectionId, producer: "managed", ...selection },
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
          ? new ManagedGenerationError("ai-timeout", "OD_GENERATION_TIMEOUT")
          : controller.signal.aborted
            ? new ManagedGenerationError("cancellation", "OD_GENERATION_CANCELLED")
            : managedFailure(error);
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
