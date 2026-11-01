import {
  activityIdSchema,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import {
  createVocabularyFlashcards,
  readFlashcards,
  readVocabularyLearning,
  saveFlashcardVocabulary,
  updateFlashcardProgress,
  updateVocabularyLearning,
} from "@call-nina/persistence";
import {
  opaqueId,
  vocabularyCandidateFromRecord,
  vocabularyProjection,
} from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class VocabularyService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "learner">;

  get #root() {
    return this.#services().root;
  }
  get #learner() {
    return this.#services().learner;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "learner">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "vocabulary/learning-read"
          | "vocabulary/learning-update"
          | "flashcards/create"
          | "flashcards/read"
          | "flashcards/progress"
          | "flashcards/save-vocabulary"
          | "vocabulary/read"
          | "vocabulary/detail"
          | "vocabulary/review-queue"
          | "vocabulary/bulk"
          | "vocabulary-set/list"
          | "vocabulary-set/create"
          | "vocabulary/confirm"
          | "vocabulary/review"
          | "vocabulary/edit"
          | "vocabulary/suspend"
          | "vocabulary/resume"
          | "vocabulary/delete";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "vocabulary/learning-read":
      case "vocabulary/learning-update": {
        await this.#root.dataRootState(request.requestId);
        if (!this.#root.database) return this.#environment.failure(request, "stale-data-root");
        const result =
          request.channel === "vocabulary/learning-read"
            ? await readVocabularyLearning(this.#root.database, request.payload.activityId)
            : await updateVocabularyLearning(this.#root.database, request.payload);
        if (request.channel === "vocabulary/learning-update")
          this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        return this.#environment.success(request, result);
      }
      case "flashcards/create":
      case "flashcards/read":
      case "flashcards/progress":
      case "flashcards/save-vocabulary": {
        if (!this.#root.database) return this.#environment.failure(request, "stale-data-root");
        const result =
          request.channel === "flashcards/create"
            ? await createVocabularyFlashcards(
                this.#root.database,
                request.payload,
                request.requestId,
              )
            : request.channel === "flashcards/read"
              ? await readFlashcards(this.#root.database, request.payload)
              : request.channel === "flashcards/progress"
                ? await updateFlashcardProgress(this.#root.database, request.payload)
                : await saveFlashcardVocabulary(
                    this.#root.database,
                    request.payload,
                    request.requestId,
                  );
        if (request.channel === "flashcards/save-vocabulary")
          this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        if (request.channel === "flashcards/create")
          this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, result);
      }
      case "vocabulary/read": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready" || !this.#root.repository)
          return this.#environment.failure(request, "stale-data-root");
        const result = await this.#root.repository.readVocabularyLibrary(
          request.payload,
          new Date().toISOString().slice(0, 10),
        );
        return this.#environment.success(request, { rootGeneration: root.generation, ...result });
      }
      case "vocabulary/detail": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        const record = await this.#root.repository.readVocabularyRecord(
          request.payload.vocabularyId,
        );
        if (!record) return this.#environment.failure(request, "not-found");
        return this.#environment.success(request, {
          rootGeneration: request.payload.rootGeneration,
          entry: vocabularyProjection(record),
        });
      }
      case "vocabulary/review-queue": {
        const repository = this.#root.repository;
        if (!repository) return this.#environment.failure(request, "stale-data-root");
        const records = await repository.readVocabularyReviewQueue(
          new Date().toISOString().slice(0, 10),
          request.payload.uploadId,
        );
        return this.#environment.success(request, {
          rootGeneration: request.payload.rootGeneration,
          entries: await Promise.all(
            records.map(async (record) => ({
              ...vocabularyProjection(record),
              retrievalSchedules: (
                await repository.readVocabularyRetrievalSchedules(record.entry.vocabularyId)
              ).map(({ retrieval, dueOn }) => ({ retrieval, dueOn })),
            })),
          ),
        });
      }
      case "vocabulary/bulk": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.mutateVocabularyBulk(request.payload, new Date().toISOString());
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, { status: "updated" });
      }
      case "vocabulary-set/list": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        const sets = await this.#root.repository.listVocabularyLessonSets();
        return this.#environment.success(request, {
          entries: sets.map((set) => ({
            setId: set.setId,
            title: set.title,
            candidateCount: set.items.length,
          })),
        });
      }
      case "vocabulary-set/create": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (dataRoot.status !== "ready" || !this.#root.repository) {
          return this.#environment.failure(request, "stale-data-root");
        }
        const records = (await this.#root.repository.listVocabularyRecords("candidate")).filter(
          ({ entry }) => entry.state.status === "candidate",
        );
        if (records.length === 0) return this.#environment.failure(request, "not-found");
        const settings = await this.#learner.readActiveLearnerSettings();
        const mistakeCategories = (await this.#root.repository.readCorrectionMistakeSample(6)).map(
          ({ categoryKey }) => categoryKey,
        );
        const candidates = records.slice(0, 50).map(vocabularyCandidateFromRecord);
        const requestValue = {
          learningScope: await this.#root.repository.requireLearningScope(),
          requestedFrom: "desktop" as const,
          title: request.payload.title,
          naturalRequest: request.payload.naturalRequest,
          ...(settings?.learningContext.goal.description
            ? { goal: settings.learningContext.goal.description }
            : {}),
          ...(request.payload.topic ? { topic: request.payload.topic } : {}),
          curriculumTopicIds: [],
          mistakeCategories,
          candidates,
        };
        const setId = activityIdSchema.parse(opaqueId("activity"));
        await this.#root.repository.saveVocabularyLessonSet(
          requestValue,
          records.slice(0, 50).map(({ entry }) => entry),
          setId,
          new Date().toISOString(),
          `vocabulary-set:${request.requestId}`,
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          setId,
          status: "created",
          candidateCount: candidates.length,
        });
      }
      case "vocabulary/confirm": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.confirmVocabulary(
          request.payload.vocabularyId,
          new Date().toISOString(),
          request.payload.dueOn,
          `vocabulary-confirm:${request.requestId}`,
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          vocabularyId: request.payload.vocabularyId,
          status: "updated",
        });
      }
      case "vocabulary/review": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        const reviewed = await this.#root.repository.reviewVocabularyCard({
          vocabularyId: request.payload.vocabularyId,
          grade: request.payload.grade,
          retrieval: request.payload.retrieval,
          expectedRevision: request.payload.expectedRevision,
          expectedUpdatedAt: request.payload.expectedUpdatedAt,
          reviewedAt: new Date().toISOString(),
          idempotencyKey: `vocabulary-review:${request.requestId}`,
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "history" });
        return this.#environment.success(request, {
          vocabularyId: request.payload.vocabularyId,
          status: "updated",
          dueOn: reviewed.dueOn,
        });
      }
      case "vocabulary/edit": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.editVocabulary({
          vocabularyId: request.payload.vocabularyId,
          expectedRevision: request.payload.expectedRevision,
          expectedUpdatedAt: request.payload.expectedUpdatedAt,
          lemma: request.payload.lemma,
          meaning: request.payload.meaning,
          example: { text: request.payload.example, meaning: request.payload.exampleMeaning },
          updatedAt: new Date().toISOString(),
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        return this.#environment.success(request, {
          vocabularyId: request.payload.vocabularyId,
          status: "updated",
        });
      }
      case "vocabulary/suspend": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.suspendVocabulary({
          ...request.payload,
          suspendedAt: new Date().toISOString(),
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          vocabularyId: request.payload.vocabularyId,
          status: "updated",
        });
      }
      case "vocabulary/resume": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.resumeVocabulary({
          ...request.payload,
          resumedAt: new Date().toISOString(),
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        return this.#environment.success(request, {
          vocabularyId: request.payload.vocabularyId,
          status: "updated",
        });
      }
      case "vocabulary/delete": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.deleteVocabulary(
          request.payload.vocabularyId,
          new Date().toISOString(),
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          vocabularyId: request.payload.vocabularyId,
          status: "updated",
        });
      }
    }
  }
}
