import {
  correlationIdSchema,
  generationDeadlineFor,
  generationOperationStartSchema,
  utcInstantSchema,
  type CorrelationId,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type DesktopPayload,
  type GenerationEvent,
} from "@call-nina/contracts";
import { isDirectApiRoute } from "@call-nina/direct-api";
import { readUpload } from "@call-nina/persistence";
import { diagnosticErrorCode, operationInputFingerprint, selectionId } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";
import { GenerationOperations } from "./generation-operations.js";
import { LearningResultService } from "./learning-results.js";
import { TranslationJobs } from "./translation-jobs.js";

export class LearningOperations {
  get #operationScope() {
    return this.#services().operationScope;
  }
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<
    DesktopServices,
    "operationScope" | "root" | "context" | "learner" | "providers" | "scheduler"
  >;
  readonly #operations: GenerationOperations;
  readonly #translations: TranslationJobs;
  get #root() {
    return this.#services().root;
  }
  get #context() {
    return this.#services().context;
  }
  get #learner() {
    return this.#services().learner;
  }
  get #providers() {
    return this.#services().providers;
  }
  get #scheduler() {
    return this.#services().scheduler;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<
      DesktopServices,
      "operationScope" | "root" | "context" | "learner" | "providers" | "scheduler"
    >,
  ) {
    this.#environment = environment;
    this.#services = services;
    this.#operations = new GenerationOperations({
      repository: () => this.#root.repository,
      closing: () => this.#scheduler.closing,
      enqueue: (work) => this.#scheduler.enqueue(work),
      operationService: (id) => this.#providers.connections.serviceFor(id),
      releaseOperation: (id) => {
        this.#providers.connections.releaseOperation(id);
      },
      emitEvent: this.#environment.emitEvent,
      operationLog: (...args) => {
        this.#environment.operationLog(...args);
      },
      dataRootState: (id) => this.#root.dataRootState(id),
      learningResults: () => this.learningResults(),
    });
    this.#translations = new TranslationJobs({
      database: () => this.#root.database,
      closing: () => this.#scheduler.closing,
      enqueue: (work) => this.#scheduler.enqueue(work),
      finishOperation: (id) => {
        this.#operations.finish(id);
      },
      retainService: (id, service) => {
        this.#providers.connections.retainService(id, service);
      },
      cancelOperation: (id) => this.#providers.connections.cancel(id),
      releaseOperation: (id) => {
        this.#providers.connections.releaseOperation(id);
      },
      emitEvent: this.#environment.emitEvent,
      operationLog: (...args) => {
        this.#environment.operationLog(...args);
      },
      providerAccess: (...args) => this.#providers.providerAccess(...args),
      generationForConnection: (connection) =>
        this.#providers.connections.generationForConnection(connection),
    });
  }
  learningResults(): LearningResultService {
    if (!this.#root.database || !this.#root.repository) throw new Error("OD_DATA_ROOT_STALE");
    return new LearningResultService({
      ...this.#root.capture(),
      curriculumRoot: this.#environment.curriculumRoot,
      emitEvent: this.#environment.emitEvent,
    });
  }

  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          "learning-operation/start" | "learning-operation/retry" | "learning-operation/cancel";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "learning-operation/start":
        return this.start(request.payload, request.requestId);
      case "learning-operation/retry": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (dataRoot.status !== "ready")
          return this.#environment.failure(request, "stale-data-root");
        const prior = this.#operations.findSubmission(
          ({ operationId }) => operationId === request.payload.previousOperationId,
        );
        if (!prior) return this.#environment.failure(request, "not-found");
        if (prior.dataRootGeneration !== dataRoot.generation) {
          return this.#environment.failure(request, "stale-data-root");
        }
        const replay = this.#operations.submission(request.payload.submissionId);
        if (
          replay &&
          (replay.inputFingerprint !== prior.inputFingerprint ||
            replay.dataRootGeneration !== dataRoot.generation)
        )
          return this.#environment.failure(request, "conflict");
        if (prior.exerciseFeedback) {
          const { feedback } = await this.#context.prepareExerciseFeedback(prior.exerciseFeedback);
          if (feedback)
            return this.#environment.success(request, {
              operationId: replay?.operationId ?? selectionId(),
              submissionId: request.payload.submissionId,
              status: "retained-feedback",
              submission: "retained",
              ...feedback,
            });
        }
        if (!this.#operations.canRetry(prior.operationId)) {
          return this.#environment.failure(request, "conflict");
        }
        if (!(await this.#learner.hasAcknowledgedAiDisclosure())) {
          return this.#environment.failure(request, "validation");
        }
        if (replay) {
          return this.#environment.success(request, {
            operationId: replay.operationId,
            submissionId: request.payload.submissionId,
            status: "accepted",
            timeoutMilliseconds: generationDeadlineFor(
              replay.operation.input.kind,
              replay.connection.routeId === "local",
            ),
            submission: "retained",
          });
        }
        if (
          prior.exerciseFeedback &&
          this.#operations.hasActiveExerciseFeedback(prior.exerciseFeedback)
        )
          return this.#environment.failure(request, "conflict");
        if (!this.#operations.makeOperationRoom(prior.operationId)) {
          return this.#environment.failure(request, "conflict");
        }
        const access = await this.#providers.providerAccess(
          prior.operation.input.kind,
          request.requestId,
          prior.operation.modelSelection,
          prior.connection,
          undefined,
          prior.operation.capability === "image",
        );
        if (access.status === "unavailable")
          return this.#environment.providerAccessFailure(request, access);
        if (
          (isDirectApiRoute(access.routeId) || access.routeId === "managed") &&
          this.#operations.activeCount >= 4
        )
          return this.#environment.failure(request, "conflict");
        const generation = this.#providers.connections.serviceFor(prior.operationId);
        if (!generation) return this.#environment.failure(request, "unsupported-operation");
        const operationId = selectionId();
        const operation = generationOperationStartSchema.parse({
          ...prior.operation,
          operationId,
          submissionId: request.payload.submissionId,
          dataRootGeneration: dataRoot.generation,
        });
        this.#operations.retainSubmission(request.payload.submissionId, {
          connection: prior.connection,
          operationId,
          inputFingerprint: prior.inputFingerprint,
          dataRootGeneration: dataRoot.generation,
          operation,
          startedAt: prior.startedAt,
          ...(prior.helperSessionId ? { helperSessionId: prior.helperSessionId } : {}),
          ...(prior.exerciseFeedback ? { exerciseFeedback: prior.exerciseFeedback } : {}),
        });
        this.#providers.connections.retainService(operationId, generation);
        this.#operations.activate(operationId);
        void Promise.resolve()
          .then(() =>
            generation.retryOperation({
              previousOperationId: correlationIdSchema.parse(request.payload.previousOperationId),
              operationId,
              submissionId: request.payload.submissionId,
            }),
          )
          .catch((error: unknown) => this.#operations.rejectUnsettledOperation(operation, error));
        return this.#environment.success(request, {
          operationId,
          submissionId: request.payload.submissionId,
          status: "accepted",
          timeoutMilliseconds: generationDeadlineFor(
            operation.input.kind,
            prior.connection.routeId === "local",
          ),
          submission: "retained",
        });
      }
      case "learning-operation/cancel": {
        const active = this.#operations.isActive(request.payload.operationId);
        if (active) {
          await this.#providers.connections
            .serviceFor(request.payload.operationId)
            ?.cancelOperation(request.payload.operationId);
        }
        const status = active ? "cancelling" : "already-finished";
        return this.#environment.success(request, {
          operationId: request.payload.operationId,
          status,
        });
      }
    }
  }

  projectEvent(event: GenerationEvent) {
    // Saved translations have their own settlement and never enter helper history,
    // course support, skill evidence, or learning-operation output events.
    const translationOperationId =
      event.event === "operation-state-changed" ? event.state.operationId : event.operationId;
    if (translationOperationId && this.#translations.isProviderOperation(translationOperationId))
      return;
    void this.#scheduler
      .enqueue(async () => {
        if (!this.#scheduler.closing) await this.#operations.handleGenerationEvent(event);
      })
      .catch((error: unknown) => {
        this.#environment.operationLog(
          "error",
          "DESKTOP_EVENT_FAILED",
          selectionId(),
          "generation-event",
          diagnosticErrorCode(error),
          "Generation event could not be handled.",
        );
        if (event.event === "operation-state-changed") {
          const accepted = this.#operations.submission(event.state.submissionId);
          if (accepted) void this.#operations.rejectUnsettledOperation(accepted.operation);
        }
      });
  }
  get operations() {
    return this.#operations;
  }
  get translations() {
    return this.#translations;
  }
  reset() {
    this.#translations.reset();
    this.#operations.reset();
  }
  async start(
    payload: DesktopPayload<"learning-operation/start">,
    requestId: CorrelationId,
  ): Promise<DesktopIpcResponse> {
    const request = { channel: "learning-operation/start" as const, requestId, payload };
    const dataRoot = await this.#root.dataRootState(request.requestId);
    if (dataRoot.status !== "ready") {
      return this.#environment.operationRequestFailure(
        request,
        "stale-data-root",
        "OD_DATA_ROOT_STALE",
        "data-root-not-ready",
      );
    }
    const inputFingerprint = operationInputFingerprint(request.payload.input);
    const previous = this.#operations.submission(request.payload.submissionId);
    if (
      previous &&
      (previous.inputFingerprint !== inputFingerprint ||
        previous.dataRootGeneration !== dataRoot.generation)
    )
      return this.#environment.failure(request, "conflict");
    const savedFeedback =
      request.payload.input.kind === "exercise-feedback"
        ? await this.#context.prepareExerciseFeedback(request.payload.input)
        : undefined;
    if (request.payload.input.kind === "exercise-feedback") {
      const feedback = savedFeedback?.feedback;
      if (feedback)
        return this.#environment.success(request, {
          operationId: previous?.operationId ?? selectionId(),
          submissionId: request.payload.submissionId,
          status: "retained-feedback",
          submission: "retained",
          ...feedback,
        });
      if (!previous && this.#operations.hasActiveExerciseFeedback(request.payload.input))
        return this.#environment.failure(request, "conflict");
    }
    if (previous) {
      return this.#environment.success(request, {
        operationId: previous.operationId,
        submissionId: request.payload.submissionId,
        status: "accepted",
        timeoutMilliseconds: generationDeadlineFor(
          previous.operation.input.kind,
          previous.connection.routeId === "local",
        ),
        submission: "retained",
      });
    }
    if (!(await this.#learner.hasAcknowledgedAiDisclosure())) {
      return this.#environment.operationRequestFailure(
        request,
        "validation",
        "OD_AI_DISCLOSURE_REQUIRED",
        "ai-disclosure",
      );
    }
    if (!this.#operations.makeOperationRoom()) {
      return this.#environment.failure(request, "conflict");
    }
    const activeSettings = await this.#learner.readActiveLearnerSettings();
    if (!activeSettings) {
      return this.#environment.operationRequestFailure(
        request,
        "not-found",
        "OD_LEARNER_SETTINGS_NOT_FOUND",
        "learner-settings-missing",
      );
    }
    const learnerSettings = await this.#operationScope.operationLearnerSettings(
      request.payload.input,
      activeSettings,
    );
    const uploadForAnalysis =
      request.payload.input.kind === "vocabulary-analysis" &&
      request.payload.input.source.kind === "upload"
        ? await readUpload(
            this.#root.capture().database,
            request.payload.input.source.reference,
            learnerSettings.learningContext.targetLanguage,
          )
        : undefined;
    const hasImage =
      request.payload.input.kind === "vocabulary-analysis" &&
      (request.payload.input.source.kind === "import" ||
      request.payload.input.source.kind === "preview"
        ? Boolean(request.payload.input.source.image)
        : Boolean(uploadForAnalysis?.image && !uploadForAnalysis.hasText));
    const action =
      request.payload.input.kind === "contextual-help" &&
      request.payload.input.intent === "translate"
        ? "translation"
        : request.payload.input.kind;
    const access = await this.#providers.providerAccess(
      action,
      request.requestId,
      undefined,
      undefined,
      undefined,
      hasImage,
    );
    if (access.status === "unavailable")
      return this.#environment.providerAccessFailure(request, access);
    if (
      (isDirectApiRoute(access.routeId) || access.routeId === "managed") &&
      this.#operations.activeCount >= 4
    )
      return this.#environment.failure(request, "conflict");
    if (!access.modelSelection) return this.#environment.failure(request, "unsupported-operation");
    const connection = await this.#providers.requireRoutedConnection(action, hasImage);
    const operationId = selectionId();
    const enriched = await this.#context.enrichedOperationInput(
      request.payload.input,
      learnerSettings,
      savedFeedback?.snapshot,
    );
    if (
      enriched.kind === "exercise-generation" &&
      "uploadSource" in enriched &&
      enriched.uploadSource
    ) {
      const source = enriched.uploadSource.material;
      const sourceDraft = {
        kind: source.kind,
        title: source.title,
        language: source.language,
        text: source.text,
        ...(source.source ? { source: source.source } : {}),
      };
      Object.assign(enriched, {
        material: sourceDraft,
        materialReference: { materialId: source.materialId, revisionId: source.revisionId },
        ...("reading" in enriched ? { reading: { passage: source.text } } : {}),
      });
    }
    const operation = generationOperationStartSchema.parse({
      operationId,
      submissionId: request.payload.submissionId,
      dataRootGeneration: dataRoot.generation,
      capability: hasImage ? "image" : "text",
      modelSelection: {
        model: { selection: "exact", modelId: access.modelSelection.modelId },
        effort:
          access.routeId === "managed"
            ? { selection: "runtime-default" }
            : { selection: "exact", effortId: access.modelSelection.effortId },
      },
      input: {
        learningContext: learnerSettings.learningContext,
        ...enriched,
      },
    });
    const generation = await this.#providers.connections.generationForConnection(connection);
    if (!generation) return this.#environment.failure(request, "unsupported-operation");
    this.#operations.retainSubmission(request.payload.submissionId, {
      connection,
      operationId,
      inputFingerprint,
      dataRootGeneration: dataRoot.generation,
      operation,
      startedAt: utcInstantSchema.parse(new Date().toISOString()),
      ...(request.payload.input.kind === "contextual-help"
        ? {
            helperSessionId: `${request.payload.input.sessionId}:${learnerSettings.learningContext.targetLanguage}`,
          }
        : {}),
      ...(request.payload.input.kind === "exercise-feedback"
        ? {
            exerciseFeedback: request.payload.input,
          }
        : {}),
    });
    this.#providers.connections.retainService(operationId, generation);
    this.#operations.activate(operationId);
    void Promise.resolve()
      .then(() => generation.runOperation(operation))
      .catch((error: unknown) => this.#operations.rejectUnsettledOperation(operation, error));
    return this.#environment.success(request, {
      operationId,
      submissionId: request.payload.submissionId,
      status: "accepted",
      timeoutMilliseconds: generationDeadlineFor(
        operation.input.kind,
        connection.routeId === "local",
      ),
      submission: "retained",
    });
  }
}
