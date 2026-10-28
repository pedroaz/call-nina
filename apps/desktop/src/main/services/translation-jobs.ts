import {
  contextualHelpCandidateSchema,
  translationRequestSchema,
  utcInstantSchema,
  type AiConnection,
  type CorrelationId,
  type DesktopIpcEvent,
  type GenerationOperationStart,
  type GenerationProvenance,
  type GenerationService,
  type LearningContext,
  type ProviderAccess,
  type ProviderOperation,
  type TranslationRequest,
  type TranslationReveal,
  type TranslationStart,
} from "@call-nina/contracts";
import { savedTranslationInput, translationParts } from "@call-nina/learning-workflows";
import {
  readSavedTranslations,
  saveSupportingTranslation,
  type CallNinaDatabase,
} from "@call-nina/persistence";
import {
  type OperationLog,
  diagnosticErrorCode,
  selectionId,
  type AcceptedOperation,
} from "../backend-support.js";

export type TranslationJob = {
  request: TranslationStart;
  cancelled: boolean;
  providerOperationId: CorrelationId | undefined;
};
interface Dependencies {
  database: () => CallNinaDatabase | undefined;
  closing: () => boolean;
  enqueue: <T>(work: () => T | Promise<T>) => Promise<T>;
  activeOperations: Set<string>;
  operationServices: Map<string, GenerationService>;
  releaseOperation: (id: CorrelationId) => void;
  emitEvent: ((event: DesktopIpcEvent) => void) | undefined;
  operationLog: OperationLog;
  providerAccess: (
    operation: ProviderOperation,
    correlationId: string,
    retainedSelection?: AcceptedOperation["operation"]["modelSelection"],
    retainedConnection?: AiConnection,
  ) => Promise<ProviderAccess>;
  generationForConnection: (connection: AiConnection) => Promise<GenerationService | undefined>;
}
export class TranslationJobs {
  readonly #dependencies: Dependencies;
  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }
  get #database() {
    return this.#dependencies.database();
  }
  get #closing() {
    return this.#dependencies.closing();
  }

  readonly translationJobs = new Map<string, TranslationJob>();

  readonly translationReveals = new Map<string, TranslationReveal>();

  readonly translationProviderOperations = new Set<string>();

  translationReveal(request: TranslationRequest) {
    return "revealId" in request.field
      ? this.translationReveals.get(request.field.revealId)
      : undefined;
  }

  finishTranslation(job: TranslationJob, outcome: "saved" | "cancelled" | "failed") {
    this.translationJobs.delete(job.request.operationId);
    this.#dependencies.activeOperations.delete(job.request.operationId);
    if (!this.#closing)
      this.#dependencies.emitEvent?.({
        event: "translation-finished",
        operationId: job.request.operationId,
        rootGeneration: job.request.rootGeneration,
        outcome,
      });
  }

  async runTranslation(
    job: TranslationJob,
    database: CallNinaDatabase,
    source: Awaited<ReturnType<typeof readSavedTranslations>>,
    context: LearningContext,
    modelSelection: GenerationOperationStart["modelSelection"],
    connection: AiConnection,
  ) {
    const request = translationRequestSchema.parse({
      rootGeneration: job.request.rootGeneration,
      activityId: job.request.activityId,
      content: job.request.content,
      field: job.request.field,
    });
    const assertActive = () => {
      if (job.cancelled || this.#closing) throw new Error("OD_TRANSLATION_CANCELLED");
    };
    try {
      const translated: string[] = [];
      let provenance: GenerationProvenance | undefined;
      for (const part of translationParts(source.original)) {
        assertActive();
        // Recheck lease/visibility between bounded provider calls, without ever
        // holding a database transaction or the IPC queue during generation.
        await this.#dependencies.enqueue(async () => {
          if (database !== this.#database) throw new Error("OD_DATA_ROOT_STALE");
          const access = await this.#dependencies.providerAccess(
            "contextual-help",
            job.request.operationId,
            modelSelection,
            connection,
          );
          if (access.status === "unavailable")
            throw new Error("OD_TRANSLATION_PROVIDER_UNAVAILABLE");
          await readSavedTranslations(database, request, this.translationReveal(job.request));
        });
        assertActive();
        const generation = await this.#dependencies.generationForConnection(connection);
        if (!generation) throw new Error("OD_OPERATION_UNSUPPORTED");
        const operationId = selectionId();
        this.#dependencies.operationServices.set(operationId, generation);
        job.providerOperationId = operationId;
        this.translationProviderOperations.add(operationId);
        try {
          const result = await generation.runOperation({
            operationId,
            submissionId: operationId,
            dataRootGeneration: job.request.rootGeneration,
            modelSelection,
            input: savedTranslationInput(job.request, part, context),
          });
          translated.push(contextualHelpCandidateSchema.parse(result.output).answer);
          provenance = { ...result.provenance, connectionId: connection.id, capability: "text" };
        } finally {
          this.translationProviderOperations.delete(operationId);
          this.#dependencies.releaseOperation(operationId);
          job.providerOperationId = undefined;
        }
      }
      await this.#dependencies.enqueue(async () => {
        assertActive();
        if (database !== this.#database || !provenance) throw new Error("OD_DATA_ROOT_STALE");
        await saveSupportingTranslation(
          database,
          request,
          {
            schemaVersion: 1,
            activityId: job.request.activityId,
            content: job.request.content,
            fieldKey: source.fieldKey,
            original: source.original,
            learningScope: source.learningScope,
            language: job.request.language,
            text: translated.join("\n\n"),
            createdAt: utcInstantSchema.parse(new Date().toISOString()),
            provenance,
          },
          this.translationReveal(job.request),
        );
        this.finishTranslation(job, "saved");
      });
    } catch (error) {
      await this.#dependencies.enqueue(() => {
        this.#dependencies.operationLog(
          "warn",
          "DESKTOP_TRANSLATION_FAILED",
          job.request.operationId,
          "translation/start",
          diagnosticErrorCode(error),
          "Saved translation did not complete.",
          { action: "translation/start", phase: "failed", outcome: "error" },
        );
        this.finishTranslation(job, job.cancelled || this.#closing ? "cancelled" : "failed");
      });
    }
  }
}
