import {
  ninaGenerationRequestSchema,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type NinaPlan,
} from "@call-nina/contracts";
import { buildPracticeSuggestions } from "@call-nina/domain";
import {
  generationLevel,
  interpretNinaRequest,
  matchesNinaRequest,
  ninaExerciseCount,
} from "@call-nina/learning-workflows";
import { readMaterialRevision } from "@call-nina/persistence";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class HomeService {
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
    request: Extract<DesktopIpcRequest, { channel: "nina/read" | "nina/plan" | "dashboard/read" }>,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "nina/read":
      case "nina/plan": {
        const root = await this.#root.dataRootState(request.requestId);
        const repository = this.#root.repository;
        const database = this.#root.database;
        if (root.status !== "ready" || !repository || !database)
          return this.#environment.failure(request, "stale-data-root");
        const settings = await this.#learner.readActiveLearnerSettings();
        if (!settings) return this.#environment.failure(request, "not-found");
        const context = settings.learningContext;
        if (request.channel === "nina/read")
          return this.#environment.success(request, {
            rootGeneration: root.generation,
            learningContext: context,
            resume: await repository.readNinaContinue(context),
          });
        const input = request.payload;
        if (input.expectedGeneration !== root.generation)
          return this.#environment.failure(request, "stale-data-root");
        if (
          input.scope.learnerId !== context.learnerId ||
          input.scope.targetLanguage !== context.targetLanguage ||
          input.scope.courseId !== context.courseId
        )
          return this.#environment.failure(request, "conflict");
        const kind = interpretNinaRequest(input);
        if (!kind || (input.material && !["reading", "vocabulary-review"].includes(kind)))
          return this.#environment.success(request, { status: "clarification" });
        if (input.material) {
          const material = await readMaterialRevision(database, input.material);
          if (material.language !== context.targetLanguage)
            return this.#environment.failure(request, "conflict");
        }
        const generationRequest = ninaGenerationRequestSchema.parse({
          source: "nina",
          expectedGeneration: root.generation,
          learningContext: context,
          naturalRequest: input.naturalRequest,
          kind,
          estimatedMinutes: input.minutes ?? 10,
          ...(input.material ? { material: input.material } : {}),
        });
        let prepared: Extract<NinaPlan, { status: "ready" }>["prepared"] = null;
        let cursor: Awaited<ReturnType<typeof repository.listPreparedActivities>>["nextCursor"] =
          null;
        do {
          const candidates = await repository.listPreparedActivities({
            activityTypes: kind === "writing" ? ["writing", "custom-lesson"] : [kind],
            maximum: 50,
            ...(input.material ? { material: input.material } : {}),
            ...(cursor ? { cursor } : {}),
          });
          cursor = candidates.nextCursor;
          for (const candidate of candidates.entries) {
            if (!candidate.generated) continue;
            const saved = await repository.readGeneratedActivity(candidate.activityId);
            if (
              !saved ||
              saved.context.learningScope.learnerId !== context.learnerId ||
              saved.context.learningScope.targetLanguage !== context.targetLanguage ||
              (saved.context.learningScope.courseId !== null &&
                saved.context.learningScope.courseId !== context.courseId)
            )
              continue;
            const expectedRequest =
              kind === "writing"
                ? `Create short free-writing exercises for this request: ${input.naturalRequest}`
                : input.naturalRequest;
            if (
              expectedRequest.length > 1000 ||
              !matchesNinaRequest(saved.content.goal.request, expectedRequest) ||
              saved.content.payload.exercises.length > 12 ||
              (input.minutes !== undefined &&
                saved.content.payload.exercises.length !== ninaExerciseCount(input.minutes)) ||
              saved.content.payload.exercises.some(
                (exercise) =>
                  exercise.cefrBand !==
                  generationLevel[settings.profile.levelEstimate.currentLevel],
              )
            )
              continue;
            if (
              input.material &&
              !saved.content.materials.some(
                (material) =>
                  material.materialId === input.material?.materialId &&
                  material.revisionId === input.material.revisionId,
              )
            )
              continue;
            if (input.minutes === undefined)
              generationRequest.estimatedMinutes = Math.max(
                5,
                saved.content.payload.exercises.length * 2,
              );
            prepared = {
              activityId: candidate.activityId,
              title: candidate.title,
              content: {
                contentId: saved.content.contentId,
                revisionId: saved.content.revisionId,
              },
            };
            break;
          }
        } while (!prepared && cursor);
        return this.#environment.success(request, {
          status: "ready",
          request: generationRequest,
          prepared,
        });
      }
      case "dashboard/read": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (dataRoot.status !== "ready")
          return this.#environment.failure(request, "stale-data-root");
        const refreshedAt = new Date().toISOString();
        const snapshot = this.#root.repository
          ? await this.#root.repository.readDashboardSnapshot(refreshedAt.slice(0, 10))
          : {
              rootGeneration: dataRoot.generation,
              preparedActivities: [],
              dueVocabulary: [],
              recentCorrections: [],
              recurringMistakes: [],
            };
        const settings = await this.#learner.readActiveLearnerSettings();
        const courseEvidence =
          settings && this.#root.repository
            ? await this.#root.repository.readRecommendationEvidence(settings.learningContext)
            : [];
        const preparedCandidates =
          settings && this.#root.repository
            ? await this.#root.repository.readRecommendationPreparedActivities(
                settings.learningContext,
              )
            : [];
        const suggestions = settings
          ? buildPracticeSuggestions({
              ...snapshot,
              preparedActivities: preparedCandidates,
              today: refreshedAt.slice(0, 10),
              locale: request.payload.locale ?? settings.profile.uiLocale,
              level: settings.profile.levelEstimate.currentLevel,
              learningContext: settings.learningContext,
              courseEvidence,
            })
          : [];
        return this.#environment.success(request, {
          rootGeneration: snapshot.rootGeneration,
          refreshedAt,
          suggestions,
          preparedActivities: snapshot.preparedActivities,
          dueVocabulary: snapshot.dueVocabulary,
          recentCorrections: snapshot.recentCorrections,
          recurringMistakes: snapshot.recurringMistakes.map((mistake) => ({
            mistakeId: mistake.mistakeId,
            category:
              mistake.category.kind === "grammar"
                ? { kind: "grammar" as const, categoryKey: mistake.category.categoryKey }
                : {
                    kind: "vocabulary" as const,
                    categoryKey: mistake.category.categoryKey,
                    lemma: mistake.category.lemma,
                  },
            occurrenceCount: mistake.occurrenceCount,
            lastObservedOn: mistake.lastObservedOn,
          })),
        });
      }
    }
  }
}
