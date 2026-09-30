import { randomUUID } from "node:crypto";
import {
  aiConnectionIdSchema,
  dataRootGenerationSchema,
  generationCapabilitiesSchema,
  generationDeadlineMilliseconds,
  generationEventSchema,
  generationOperationStartSchema,
  generationOutputSchemaIds,
  modelRequestIdSchema,
  offlineOperationSchema,
  errorDefinitions,
  callNinaErrorSchema,
  type GenerationService,
  type GenerationKind,
  type GenerationEvent,
  type GenerationOperationFor,
  type GenerationOperationStart,
  type GenerationOutputMap,
  type GenerationResult,
} from "@call-nina/contracts";
import {
  GenerationOutputValidationError,
  runLearningWorkflow,
} from "@call-nina/learning-workflows";
import { offlineSelection } from "./catalog.js";
import { fail, safeCode } from "./files.js";
import type { OfflineRuntime } from "./index.js";

type Result = GenerationResult<GenerationKind, GenerationOutputMap>;
type Operation = {
  request: GenerationOperationStart;
  isActive: () => boolean;
  controller: AbortController;
  status: "running" | "validated" | "failed" | "cancelled";
  completion: Promise<Result>;
};
export class OfflineGenerationService implements GenerationService {
  readonly generationCapabilities = generationCapabilitiesSchema.parse({
    providerId: "local",
    operations: offlineOperationSchema.options,
    structuredOutput: true,
    cancellation: true,
  });
  readonly #connectionId: string;
  readonly #rootGeneration: number;
  readonly #runtime: OfflineRuntime;
  readonly #captureActive: () => () => boolean;
  readonly #assertActive: (request: GenerationOperationStart) => Promise<void>;
  readonly #records = new Map<string, Operation>();
  readonly #listeners = new Set<(event: GenerationEvent) => void>();
  #closed = false;
  constructor(options: {
    connectionId: string;
    rootGeneration: number;
    runtime: OfflineRuntime;
    captureActive: () => () => boolean;
    assertActive: (request: GenerationOperationStart) => Promise<void>;
  }) {
    this.#connectionId = aiConnectionIdSchema.parse(options.connectionId);
    this.#rootGeneration = dataRootGenerationSchema.parse(options.rootGeneration);
    this.#runtime = options.runtime;
    this.#captureActive = options.captureActive;
    this.#assertActive = options.assertActive;
  }
  subscribeGeneration(listener: (event: GenerationEvent) => void) {
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
        /* Observers cannot alter settlement. */
      }
    }
  }
  runOperation<Kind extends GenerationKind>(
    input: GenerationOperationFor<Kind>,
  ): Promise<GenerationResult<Kind, GenerationOutputMap>> {
    const request = generationOperationStartSchema.parse(input);
    // Retained retries get a fresh epoch, while each running operation remains
    // invalidated by any connection/root transition during that operation.
    const isActive = this.#captureActive();
    if (this.#closed || !isActive()) fail("INACTIVE");
    if (request.dataRootGeneration !== this.#rootGeneration) fail("ROOT_STALE");
    offlineOperationSchema.parse(request.input.kind);
    offlineSelection(request.modelSelection);
    const existing =
      this.#records.get(request.operationId) ??
      [...this.#records.values()].find(
        (record) => record.request.submissionId === request.submissionId,
      );
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(request)) fail("SUBMISSION_CONFLICT");
      return existing.completion as Promise<GenerationResult<Kind, GenerationOutputMap>>;
    }
    if (
      this.#records.size >= 256 ||
      [...this.#records.values()].some((record) => record.status === "running")
    )
      fail("BUSY");
    const record: Operation = {
      request,
      isActive,
      controller: new AbortController(),
      status: "running",
      completion: Promise.resolve().then(() => this.#execute(record)),
    };
    this.#records.set(request.operationId, record);
    this.#emit({
      event: "operation-state-changed",
      state: {
        operationId: request.operationId,
        submissionId: request.submissionId,
        kind: request.input.kind,
        status: "accepted",
        submission: "retained",
      },
    });
    return record.completion as Promise<GenerationResult<Kind, GenerationOutputMap>>;
  }
  async #execute(record: Operation): Promise<Result> {
    const { request, controller, isActive } = record;
    const base = {
      operationId: request.operationId,
      submissionId: request.submissionId,
      kind: request.input.kind,
    };
    const deadline = Date.now() + generationDeadlineMilliseconds[request.input.kind];
    const timer = setTimeout(
      () => {
        controller.abort();
      },
      Math.max(1, deadline - Date.now()),
    );
    try {
      const result = await runLearningWorkflow(
        {
          input: request.input,
          signal: controller.signal,
          absoluteDeadlineMilliseconds: Math.max(1, deadline - Date.now()),
          onProgress: (stage, attempt) => {
            this.#emit({ event: "operation-progress", ...base, stage, attempt });
          },
        },
        async (attempt) => {
          controller.signal.throwIfAborted();
          if (!isActive()) fail("INACTIVE");
          await this.#assertActive(request);
          if (this.#closed || !isActive()) fail("INACTIVE");
          this.#emit({
            event: "operation-progress",
            ...base,
            stage: "starting",
            attempt: attempt.attempt,
          });
          return this.#runtime.generate(attempt, () => !this.#closed && isActive());
        },
      );
      controller.signal.throwIfAborted();
      await this.#assertActive(request);
      if (this.#closed || !isActive()) fail("INACTIVE");
      const validated: Result = {
        ...base,
        modelRequestId: modelRequestIdSchema.parse(
          `model-request_${randomUUID().replaceAll("-", "")}`,
        ),
        outputSchemaId: generationOutputSchemaIds[request.input.kind],
        provenance: {
          connectionId: this.#connectionId,
          producer: "local",
          ...offlineSelection(request.modelSelection),
        },
        output: result.output,
      };
      record.status = "validated";
      this.#emit({
        event: "operation-state-changed",
        state: { ...validated, submission: "retained", status: "validated" },
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
      const kind =
        Date.now() >= deadline
          ? "ai-timeout"
          : controller.signal.aborted
            ? "cancellation"
            : error instanceof GenerationOutputValidationError
              ? "model-output"
              : "app-server";
      const definition = errorDefinitions[kind];
      const state =
        kind === "cancellation"
          ? { status: "cancelled" as const }
          : {
              status: "failed" as const,
              error: callNinaErrorSchema.parse({
                schemaVersion: 1,
                kind,
                ...definition,
                reference: {
                  code: definition.code,
                  correlationId: request.operationId,
                  occurredAt: new Date().toISOString(),
                },
              }),
            };
      record.status = kind === "cancellation" ? "cancelled" : "failed";
      this.#emit({
        event: "operation-state-changed",
        state: { ...base, submission: "retained", ...state },
      });
      this.#emit({ event: "operation-finished", ...base, outcome: state });
      throw new Error(safeCode(error));
    } finally {
      clearTimeout(timer);
    }
  }
  retryOperation<Kind extends GenerationKind>(
    options: Parameters<GenerationService["retryOperation"]>[0],
  ): Promise<GenerationResult<Kind, GenerationOutputMap>> {
    const prior = this.#records.get(options.previousOperationId);
    if (!prior || prior.status !== "failed") fail("RETRY_UNAVAILABLE");
    return this.runOperation({
      ...prior.request,
      operationId: options.operationId,
      submissionId: options.submissionId,
    } as GenerationOperationFor<Kind>);
  }
  async cancelOperation(operationId: GenerationOperationStart["operationId"]) {
    const record = this.#records.get(operationId);
    if (!record || record.status !== "running") return;
    record.controller.abort();
    await record.completion.catch(() => undefined);
  }
  releaseOperation(operationId: GenerationOperationStart["operationId"]) {
    if (this.#records.get(operationId)?.status !== "running") this.#records.delete(operationId);
  }
  async shutdown() {
    this.#closed = true;
    for (const record of this.#records.values()) record.controller.abort();
    await Promise.allSettled([...this.#records.values()].map((record) => record.completion));
    this.#records.clear();
    this.#listeners.clear();
  }
}
