import { type CapturedTeachingContext, type DesktopIpcRequest } from "@call-nina/contracts";
import { assertExerciseGenerationContext, resolveCourseReference } from "@call-nina/domain";
import {
  readLearningCourse,
  readMaterialRevision,
  readUpload,
  readVocabularyAnalysis,
  type LearnerSettingsRecord,
} from "@call-nina/persistence";
import { selectionId } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class OperationScope {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "activities">;
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "activities">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  get #root() {
    return this.#services().root;
  }
  get #activities() {
    return this.#services().activities;
  }
  async operationLearnerSettings(
    input: Extract<DesktopIpcRequest, { channel: "learning-operation/start" }>["payload"]["input"],
    settings: LearnerSettingsRecord,
  ): Promise<LearnerSettingsRecord & { capturedContext?: CapturedTeachingContext }> {
    const repository = this.#root.repository;
    if (!repository || !this.#root.database) throw new Error("OD_DATA_ROOT_STALE");
    if ("practiceSource" in input && input.practiceSource?.kind === "upload") {
      if (input.practiceSource.rootGeneration !== this.#root.database.rootGeneration)
        throw new Error("OD_DATA_ROOT_STALE");
      const upload = await readUpload(
        this.#root.database,
        input.practiceSource.reference,
        settings.learningContext.targetLanguage,
      );
      if (upload.archived) throw new Error("OD_UPLOAD_NOT_FOUND");
      if (!upload.material) throw new Error("OD_UPLOAD_TEXT_REQUIRED");
    }
    if (
      input.kind === "website-study-pack" &&
      input.rootGeneration !== this.#root.database.rootGeneration
    )
      throw new Error("OD_DATA_ROOT_STALE");
    if (input.kind === "vocabulary-analysis") {
      if (input.rootGeneration !== this.#root.database.rootGeneration)
        throw new Error("OD_DATA_ROOT_STALE");
      if (input.source.kind === "activity") {
        const source = await readVocabularyAnalysis(
          this.#root.database,
          input.source.activityId,
          input.source.sourceKey,
        );
        return repository.readLearnerSettingsForScope(source.scope);
      }
    }
    if (input.kind === "exercise-feedback") {
      const activity = await repository.readPreparedActivity(input.activityId);
      if (!activity) throw new Error("OD_ACTIVITY_NOT_FOUND");
      const owned = await repository.readLearnerSettingsForScope(activity.context.learningScope);
      const capturedContext = await repository.readGeneratedExerciseContext(
        activity.activityId,
        input.attemptId,
      );
      return { ...owned, learningContext: capturedContext.learningContext, capturedContext };
    }
    if (input.kind !== "exercise-generation") return settings;
    assertExerciseGenerationContext(input);
    const request = input.request;
    if (request.source === "nina") {
      if (input.context.origin !== "nina") throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
      if (request.expectedGeneration !== this.#root.database.rootGeneration)
        throw new Error("OD_DATA_ROOT_STALE");
      // The repository resolves a fresh context from a strict ownership scope.
      // Do not pass the card's goal/explanation fields across that boundary.
      const owned = await repository.readLearnerSettingsForScope({
        learnerId: request.learningContext.learnerId,
        courseId: request.learningContext.courseId,
        targetLanguage: request.learningContext.targetLanguage,
      });
      // The explicit card captures the original explanation/goal as well as language ownership.
      return { ...owned, learningContext: request.learningContext };
    }
    if (request.source === "prepared-activity") {
      const activity = await (
        await this.#activities.activities(selectionId())
      ).readGenerationSource(request.activityId);
      const owned = await repository.readLearnerSettingsForScope(activity.context.learningScope);
      const capturedContext = (await repository.readGeneratedActivity(activity.activityId))
        ? await repository.readGeneratedExerciseContext(activity.activityId)
        : await repository.readPreparedActivityContext(activity.activityId);
      return { ...owned, learningContext: capturedContext.learningContext, capturedContext };
    }
    if (request.source === "saved-material") {
      if (request.expectedGeneration !== this.#root.database.rootGeneration)
        throw new Error("OD_DATA_ROOT_STALE");
      const material = await readMaterialRevision(this.#root.database, request.material);
      return repository.readLearnerSettingsForScope({
        learnerId: settings.learningContext.learnerId,
        targetLanguage: material.language,
        // A material revision has no course owner.
        courseId: null,
      });
    }
    if (request.source === "suggestion") {
      if (request.suggestion.rootGeneration !== this.#root.database.rootGeneration)
        throw new Error("OD_DATA_ROOT_STALE");
      const declaredScope = await repository.requireLearningScope(
        request.suggestion.targetLanguage,
      );
      const evidenceScope = await repository.readSuggestionLearningScope(
        request.suggestion.context,
      );
      if (
        evidenceScope &&
        (evidenceScope.learnerId !== declaredScope.learnerId ||
          evidenceScope.targetLanguage !== declaredScope.targetLanguage)
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      // Evidence can have no course owner. Capture the declared language even
      // without evidence, so later active-language changes cannot redirect it.
      return repository.readLearnerSettingsForScope(evidenceScope ?? declaredScope);
    }
    if (request.source === "learning-path") {
      if (request.expectedGeneration !== this.#root.database.rootGeneration)
        throw new Error("OD_DATA_ROOT_STALE");
      const course = await readLearningCourse(
        this.#environment.curriculumRoot,
        settings.learningContext.targetLanguage,
      );
      resolveCourseReference(course, request.reference);
      if (!course) throw new Error("OD_COURSE_UNAVAILABLE");
      const scope = await repository.requireLearningScope(course.targetLanguage);
      if (scope.courseId !== course.courseId) throw new Error("OD_COURSE_UNAVAILABLE");
      return repository.readLearnerSettingsForScope(scope);
    }
    return settings;
  }
}
