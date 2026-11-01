import { activityIdSchema, type DesktopIpcEvent } from "@call-nina/contracts";
import {
  claimVocabularyEvidence,
  hasBlockedVocabulary,
  ingestVocabulary,
  resumeVocabularyEvidence,
  retryBlockedVocabulary,
  settleVocabularyFailure,
  type CallNinaDatabase,
} from "@call-nina/persistence";
import { selectionId } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class VocabularyWorker {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<
    DesktopServices,
    "scheduler" | "root" | "generation" | "providers"
  >;
  #vocabularyTimer: ReturnType<typeof setTimeout> | undefined;
  #vocabularyRoot: CallNinaDatabase | undefined;
  #vocabularyOperation:
    | { database: CallNinaDatabase; sourceKey: string; operationId: string; blocked?: boolean }
    | undefined;
  get #scheduler() {
    return this.#services().scheduler;
  }
  get #root() {
    return this.#services().root;
  }
  get #generation() {
    return this.#services().generation;
  }
  get #providers() {
    return this.#services().providers;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "scheduler" | "root" | "generation" | "providers">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  scheduleVocabulary() {
    if (this.#scheduler.closing || this.#vocabularyTimer) return;
    this.#vocabularyTimer = setTimeout(() => {
      this.#vocabularyTimer = undefined;
      void this.#scheduler
        .enqueue(() => this.processVocabulary())
        .catch(() => {
          this.#environment.operationLog(
            "warn",
            "VOCABULARY_QUEUE_FAILED",
            selectionId(),
            "vocabulary-analysis",
            undefined,
            "Vocabulary processing remains pending.",
          );
        })
        .finally(() => {
          this.scheduleVocabulary();
        });
    }, 1000);
    this.#vocabularyTimer.unref();
  }

  async processVocabulary() {
    const database = this.#root.database;
    if (this.#scheduler.closing || !database || database.closed || this.#root.rootSwitching) return;
    if (this.#vocabularyRoot !== database) {
      await resumeVocabularyEvidence(database);
      this.#vocabularyRoot = database;
      this.#vocabularyOperation = undefined;
    }
    const previous = this.#vocabularyOperation;
    if (previous) {
      if (this.#generation.operations.isActive(previous.operationId)) return;
      // Successful ingestion has already marked this job done atomically.
      await settleVocabularyFailure(database, previous.sourceKey, previous.blocked);
      this.#vocabularyOperation = undefined;
      this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
    }
    if (this.#generation.operations.activeCount >= 3) return;
    const job = await claimVocabularyEvidence(database);
    if (!job) return;
    this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
    try {
      if (job.output) {
        await ingestVocabulary(database, {
          language: job.language,
          sourceKey: job.sourceKey,
          activityId: activityIdSchema.parse(job.activityId),
          output: job.output,
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        return;
      }
      const result = await this.#generation.start(
        {
          submissionId: selectionId(),
          input: {
            kind: "vocabulary-analysis",
            rootGeneration: database.rootGeneration,
            source: {
              kind: "activity",
              activityId: activityIdSchema.parse(job.activityId),
              sourceKey: job.sourceKey,
            },
          },
        },
        selectionId(),
      );
      if (result.status === "ok" && result.channel === "learning-operation/start") {
        this.#vocabularyOperation = {
          database,
          sourceKey: job.sourceKey,
          operationId: result.result.operationId,
        };
      } else {
        await settleVocabularyFailure(
          database,
          job.sourceKey,
          result.status === "error" &&
            ["authentication", "model-unavailable", "unsupported-operation", "ai-policy"].includes(
              result.error.kind,
            ),
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
      }
    } catch {
      await settleVocabularyFailure(database, job.sourceKey);
      this.#environment.operationLog(
        "warn",
        "VOCABULARY_ANALYSIS_PENDING",
        selectionId(),
        "vocabulary-analysis",
        undefined,
        "Vocabulary analysis remains available for retry.",
      );
      this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
    }
  }
  stop() {
    if (this.#vocabularyTimer) clearTimeout(this.#vocabularyTimer);
    this.#vocabularyTimer = undefined;
  }
  observe(event: DesktopIpcEvent) {
    if (
      event.event === "learning-operation-finished" &&
      this.#vocabularyOperation?.operationId === event.operationId &&
      event.outcome.status === "failed"
    )
      this.#vocabularyOperation.blocked = [
        "authentication",
        "model-unavailable",
        "unsupported-operation",
        "ai-policy",
      ].includes(event.outcome.error.kind);
    if (
      event.event === "state-invalidated" &&
      event.scope === "ai-connections" &&
      this.#root.database
    ) {
      const database = this.#root.database;
      void this.#scheduler
        .enqueue(async () => {
          if (database !== this.#root.database || database.closed || this.#scheduler.closing)
            return;
          if (!(await hasBlockedVocabulary(database))) return;
          const access = await this.#providers.providerAccess("vocabulary-analysis", selectionId());
          if (access.status === "available" && this.#root.isCurrent(database))
            await retryBlockedVocabulary(database);
        })
        .catch(() => undefined);
    }
  }
}
