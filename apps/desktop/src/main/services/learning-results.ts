import { learningTitles } from "../localization.js";
import {
  activityIdSchema,
  flashcardGenerationCandidateSchema,
  modelRequestIdSchema,
  utcInstantSchema,
  vocabularyAnalysisOutputSchema,
  type DesktopIpcEvent,
  type exerciseGenerationCandidateSchema,
  type GenerationProvenance,
} from "@call-nina/contracts";
import { resolveCourseReference } from "@call-nina/domain";
import {
  assertCallNinaDatabaseLease,
  ingestVocabulary,
  readLearningCourse,
  readVocabularyAnalysis,
  saveGeneratedFlashcards,
  stageUploadAnalysis,
  type CallNinaDatabase,
  type CallNinaRepository,
} from "@call-nina/persistence";
import {
  opaqueId,
  type AcceptedOperation,
  type ValidatedWritingState,
} from "../backend-support.js";
import { WritingResultPersistence } from "./writing-results.js";

/** Applies validated learning results to a single leased data-root generation.
 * Operation scheduling, cancellation and provider process ownership stay with the caller.
 */
export class LearningResultService {
  readonly #writing: WritingResultPersistence;
  readonly #database: CallNinaDatabase;
  readonly #repository: CallNinaRepository;
  readonly #curriculumRoot: string;
  readonly #emitEvent: ((event: DesktopIpcEvent) => void) | undefined;

  constructor(options: {
    database: CallNinaDatabase;
    repository: CallNinaRepository;
    curriculumRoot: string;
    emitEvent?: (event: DesktopIpcEvent) => void;
  }) {
    this.#writing = new WritingResultPersistence(options);
    this.#database = options.database;
    this.#repository = options.repository;
    this.#curriculumRoot = options.curriculumRoot;
    this.#emitEvent = options.emitEvent;
  }

  async #assertGeneration(accepted: AcceptedOperation): Promise<void> {
    if (accepted.dataRootGeneration !== this.#database.rootGeneration)
      throw new Error("OD_DATA_ROOT_STALE");
    await assertCallNinaDatabaseLease(this.#database);
  }

  async persistWritingCorrection(
    accepted: AcceptedOperation,
    state: ValidatedWritingState,
  ): Promise<ReturnType<typeof activityIdSchema.parse>> {
    return this.#writing.persistWritingCorrection(accepted, state);
  }

  async persistVocabulary(accepted: AcceptedOperation, value: unknown) {
    await this.#assertGeneration(accepted);
    const input = accepted.operation.input;
    if (input.kind !== "vocabulary-analysis") throw new Error("OD_VOCABULARY_INPUT_INVALID");
    const output = vocabularyAnalysisOutputSchema.parse(value);
    if (input.mode === "preview") return;
    if (input.mode === "upload" && input.upload) {
      await stageUploadAnalysis(this.#database, {
        analysisId: accepted.operationId,
        reference: input.upload,
        language: input.learningContext.targetLanguage,
        output,
      });
      this.#emitEvent?.({ event: "state-invalidated", scope: "vocabulary" });
      return;
    }
    if (!output.readable) throw new Error("OD_VOCABULARY_SOURCE_UNREADABLE");
    if (input.mode === "activity") {
      const activityId = input.sourceKey.split(":")[1];
      if (!activityId) throw new Error("OD_VOCABULARY_SOURCE_INVALID");
      const source = await readVocabularyAnalysis(this.#database, activityId, input.sourceKey);
      if (source.sourceKey !== input.sourceKey) throw new Error("OD_VOCABULARY_SOURCE_STALE");
      const attempts = JSON.parse(source.sourceText) as Array<{
        attemptId: string;
        exercise: { exercise: { kind: string; targetedVocabularyIds?: string[] } };
        answer: unknown;
        assisted: boolean;
      }>;
      output.words = output.words.filter((word) => {
        const attempt = attempts.find((a) => a.attemptId === word.attemptId);
        if (!attempt || word.outcome === "requested") return false;
        const containsExcerpt = (value: unknown): boolean => {
          if (typeof value === "string") return value.includes(word.excerpt);
          if (Array.isArray(value)) return value.some(containsExcerpt);
          if (value && typeof value === "object") return Object.values(value).some(containsExcerpt);
          return false;
        };
        if (!containsExcerpt({ exercise: attempt.exercise, answer: attempt.answer })) return false;
        return (
          word.outcome !== "success" ||
          (!attempt.assisted &&
            attempt.exercise.exercise.kind !== "multiple-choice" &&
            input.knownWords.some(
              (w) =>
                w.lemma === word.lemma &&
                w.meaning === word.meaning &&
                attempt.exercise.exercise.targetedVocabularyIds?.includes(w.vocabularyId),
            ))
        );
      });
      await ingestVocabulary(this.#database, {
        language: input.learningContext.targetLanguage,
        sourceKey: input.sourceKey,
        output,
        activityId,
      });
    } else {
      output.words = output.words.filter((w) => w.outcome === "requested");
      await ingestVocabulary(this.#database, {
        language: input.learningContext.targetLanguage,
        sourceKey: input.sourceKey,
        output,
      });
    }
    this.#emitEvent?.({ event: "state-invalidated", scope: "vocabulary" });
  }

  async persistFlashcards(
    accepted: AcceptedOperation,
    outputValue: unknown,
    provenance: GenerationProvenance,
  ) {
    await this.#assertGeneration(accepted);
    const input = accepted.operation.input;
    if (input.kind !== "flashcard-generation") throw new Error("OD_FLASHCARD_INPUT_INVALID");
    const output = flashcardGenerationCandidateSchema.parse(outputValue);
    const activityId = activityIdSchema.parse(
      `activity_${accepted.operationId.replaceAll(/[^a-z0-9]/gu, "")}`,
    );
    const preparedAt = accepted.startedAt;
    await saveGeneratedFlashcards(
      this.#database,
      {
        activityId,
        activityType: "flashcards",
        title: output.title,
        originSurface: "desktop",
        preparedAt,
        context: {
          ...(input.uploadSource ? { uploadSource: input.uploadSource } : {}),
          learningScope: {
            learnerId: input.learningContext.learnerId,
            courseId: input.learningContext.courseId,
            targetLanguage: input.learningContext.targetLanguage,
          },
          naturalRequest: input.topic.slice(0, 1_000),
          curriculumTopicIds: [],
          mistakeIds: [],
          vocabularyIds: [],
        },
      },
      output.cards,
      provenance,
      { learnerGoal: input.learningContext.goal, topic: input.topic },
      accepted.operationId,
    );
    this.#emitEvent?.({ event: "state-invalidated", scope: "dashboard" });
    return activityId;
  }

  async persistTargetedPractice(
    accepted: AcceptedOperation,
    state: Readonly<{
      modelRequestId: string;
      provenance: GenerationProvenance;
      output: ReturnType<typeof exerciseGenerationCandidateSchema.parse>;
    }>,
  ): Promise<ReturnType<typeof activityIdSchema.parse>> {
    await this.#assertGeneration(accepted);
    const repository = this.#repository;
    const operation = accepted.operation;
    if (operation.input.kind !== "exercise-generation")
      throw new Error("OD_GENERATED_ACTIVITY_INPUT_INVALID");
    if (operation.input.learningPath) {
      const course = await readLearningCourse(
        this.#curriculumRoot,
        operation.input.learningContext.targetLanguage,
      );
      if (!course) throw new Error("OD_COURSE_UNAVAILABLE");
      resolveCourseReference(course, operation.input.learningPath);
    }
    const preparedAt = utcInstantSchema.parse(new Date().toISOString());
    const activityId = activityIdSchema.parse(opaqueId("activity"));
    const activity = {
      activityId,
      activityType:
        operation.input.practiceType === "vocabulary-review"
          ? ("vocabulary-review" as const)
          : operation.input.courseTeaching?.delivery === "writing"
            ? ("writing" as const)
            : operation.input.reading
              ? ("reading" as const)
              : operation.input.practiceType === "grammar" || operation.input.targetedMistakePattern
                ? ("grammar" as const)
                : ("custom-lesson" as const),
      title:
        state.output.lesson?.title ??
        state.output.exercises[0]?.title ??
        learningTitles[operation.input.learningContext.explanationLanguage][
          operation.input.targetedMistakePattern ? "targetedPractice" : "quiz"
        ],
      originSurface: "desktop" as const,
      context: {
        ...(operation.input.uploadSource ? { uploadSource: operation.input.uploadSource } : {}),
        learningScope: {
          learnerId: operation.input.learningContext.learnerId,
          courseId: operation.input.learningContext.courseId,
          targetLanguage: operation.input.learningContext.targetLanguage,
        },
        entry: operation.input.entry,
        ...(operation.input.learningPath ? { learningPath: operation.input.learningPath } : {}),
        ...(operation.input.courseTeaching
          ? { courseTeaching: operation.input.courseTeaching }
          : {}),
        naturalRequest: operation.input.naturalRequest.slice(0, 1_000),
        curriculumTopicIds: operation.input.curriculumTopicIds,
        mistakeIds: operation.input.relevantMistakeIds,
        vocabularyIds: operation.input.relevantVocabularyIds,
      },
      preparedAt,
    };
    const aiProvenance = {
      source: "ai",
      producer: "desktop-app-server",
      connectionId: accepted.connection.id,
      modelRequestId: modelRequestIdSchema.parse(state.modelRequestId),
      generatedAt: preparedAt,
      modelSelection: {
        availability: "reported",
        modelId: state.provenance.modelId,
        effortId: state.provenance.effortId,
      },
    } as const;
    const vocabularyEntries: never[] = [];
    const material = (operation.input.uploadSource
      ? {
          materialId: operation.input.uploadSource.material.materialId,
          revisionId: operation.input.uploadSource.material.revisionId,
        }
      : undefined) ??
      operation.input.materialReference ??
      operation.input.material ?? {
        kind: operation.input.reading?.passage ? ("pasted-text" as const) : ("topic" as const),
        title: activity.title,
        language: operation.input.learningContext.targetLanguage,
        text: operation.input.reading?.passage ?? operation.input.naturalRequest,
      };
    if (operation.input.targetedMistakePattern) {
      await repository.saveTargetedPracticeActivity(
        {
          activity,
          category: operation.input.targetedMistakePattern.category,
          material,
          learnerGoal: operation.input.learningContext.goal,
          capturedContext: {
            learningContext: operation.input.learningContext,
            calibration: operation.input.calibration,
          },
          aiProvenance,
          generationProvenance: state.provenance,
          output: state.output,
          vocabularyEntries,
        },
        accepted.operationId,
      );
    } else {
      await repository.saveGeneratedPracticeActivity(
        {
          activity,
          material,
          learnerGoal: operation.input.learningContext.goal,
          capturedContext: {
            learningContext: operation.input.learningContext,
            calibration: operation.input.calibration,
          },
          aiProvenance,
          generationProvenance: state.provenance,
          output: state.output,
          vocabularyEntries,
        },
        accepted.operationId,
      );
    }
    this.#emitEvent?.({ event: "state-invalidated", scope: "dashboard" });
    this.#emitEvent?.({ event: "state-invalidated", scope: "history" });
    return activityId;
  }
}
