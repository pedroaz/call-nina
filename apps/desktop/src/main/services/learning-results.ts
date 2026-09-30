import {
  type GenerationProvenance,
  activityIdSchema,
  attemptIdSchema,
  correctionIdSchema,
  exerciseIdSchema,
  historyEntryIdSchema,
  mistakeIdSchema,
  modelRequestIdSchema,
  utcInstantSchema,
  vocabularyIdSchema,
  flashcardGenerationCandidateSchema,
  type exerciseGenerationCandidateSchema,
  type DesktopIpcEvent,
} from "@call-nina/contracts";
import { alignCorrectionTexts, resolveCourseReference } from "@call-nina/domain";
import {
  assertCallNinaDatabaseLease,
  readLearningCourse,
  saveGeneratedFlashcards,
  writingAttemptPersistenceSchema,
  type CallNinaDatabase,
  type CallNinaRepository,
} from "@call-nina/persistence";
import {
  opaqueId,
  type AcceptedOperation,
  type ValidatedWritingState,
} from "../backend-support.js";

/** Applies validated learning results to a single leased data-root generation.
 * Operation scheduling, cancellation and provider process ownership stay with the caller.
 */
export class LearningResultService {
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
  ): Promise<void> {
    await this.#assertGeneration(accepted);
    const repository = this.#repository;
    const operation = accepted.operation;
    if (operation.input.kind !== "writing-correction") {
      throw new Error("OD_WRITING_ATTEMPT_KIND_INVALID");
    }
    const completedAt = utcInstantSchema.parse(new Date().toISOString());
    const activityId = activityIdSchema.parse(opaqueId("activity"));
    const exerciseId = exerciseIdSchema.parse(opaqueId("exercise"));
    const attemptId = attemptIdSchema.parse(opaqueId("attempt"));
    const correctionId = correctionIdSchema.parse(opaqueId("correction"));
    const historyEntryId = historyEntryIdSchema.parse(opaqueId("history-entry"));
    const provenance = {
      source: "ai" as const,
      producer: "desktop-app-server" as const,
      connectionId: accepted.connection.id,
      modelRequestId: state.modelRequestId,
      generatedAt: completedAt,
      modelSelection: {
        availability: "reported" as const,
        modelId: state.provenance.modelId,
        effortId: state.provenance.effortId,
      },
    };
    const objective = {
      key: "writing-correction",
      description: operation.input.activityGoal.slice(0, 500),
    };
    const exercise = {
      exerciseId,
      aiProvenance: provenance,
      cefrBand: operation.input.calibration.approximateLevel.toLowerCase(),
      objectives: [objective],
      instructions: operation.input.activityGoal,
      hints: [],
      feedbackMode: "immediate" as const,
      curriculumTopicIds: [],
      vocabularySetLinks: [],
      kind: "free-writing" as const,
      content: { prompt: operation.input.activityGoal },
      answerContract: {
        kind: "free-text" as const,
        maximumCharacters: 10_000,
        evaluation: "ai" as const,
      },
    };
    const aligned = alignCorrectionTexts(
      operation.input.learnerText,
      state.output.correctedText,
      state.output.changes,
    );
    const alignment = aligned.map((segment) => {
      if (segment.kind === "unchanged") return segment;
      const candidate =
        segment.candidateIndex === null ? undefined : state.output.changes[segment.candidateIndex];
      return {
        kind: segment.kind,
        originalText: segment.originalText,
        correctedText: segment.correctedText,
        category: candidate?.category ?? "clarity",
        severity: candidate?.severity ?? "minor",
        priority: candidate?.severity === "meaning-affecting" ? "high" : "medium",
        explanation: candidate?.explanation ?? state.output.summary.slice(0, 800),
        grammarTopicIds: [],
        uncertainty: candidate?.uncertainty ?? state.output.overallUncertainty,
      };
    });
    const mistakes = alignment.flatMap((segment, alignmentSegmentPosition) => {
      if (segment.kind === "unchanged") return [];
      const category = ["word-choice", "register", "idiom"].includes(segment.category)
        ? {
            kind: "vocabulary" as const,
            categoryKey: segment.category,
            lemma:
              (segment.correctedText || segment.originalText).trim().slice(0, 160) ||
              segment.category,
          }
        : {
            kind: "grammar" as const,
            categoryKey: segment.category,
            curriculumTopicIds: segment.grammarTopicIds,
          };
      return [
        {
          proposedMistakeId: mistakeIdSchema.parse(opaqueId("mistake")),
          alignmentSegmentPosition,
          category,
        },
      ];
    });
    const improvements = [
      ...state.output.changes.map(({ explanation }) => explanation),
      ...state.output.caveats,
    ].slice(0, 20);
    const completedAfterPreviousEventMilliseconds = Math.max(
      0,
      Date.parse(completedAt) - Date.parse(accepted.startedAt),
    );
    const vocabularyEntries = state.output.vocabularyCandidates.map((candidate) => ({
      schemaVersion: 1 as const,
      targetLanguage: operation.input.learningContext.targetLanguage,
      vocabularyId: vocabularyIdSchema.parse(opaqueId("vocabulary")),
      lemma: candidate.lemma,
      meaning: candidate.meaning,
      lexeme: { partOfSpeech: "other" as const },
      examples: [{ text: candidate.sourceExcerpt, meaning: candidate.meaning }],
      source: {
        kind: "correction" as const,
        correctionId,
        attemptId,
        context: candidate.sourceExcerpt,
      },
      state: { status: "candidate" as const, confirmation: "required" as const },
    }));
    const record = writingAttemptPersistenceSchema.parse({
      learningScope: {
        learnerId: operation.input.learningContext.learnerId,
        courseId: operation.input.learningContext.courseId,
        targetLanguage: operation.input.learningContext.targetLanguage,
      },
      activityId,
      historyEntryId,
      title: operation.input.activityGoal.slice(0, 160),
      workload: "correction",
      startedExercise: {
        schemaVersion: 1,
        lifecycle: "started",
        startedAt: accepted.startedAt,
        exercise,
      },
      attemptId,
      answer: {
        submittedAfterPreviousEventMilliseconds: 0,
        answer: { kind: "free-writing", text: operation.input.learnerText },
      },
      completedAfterPreviousEventMilliseconds,
      objectiveEvaluations: [
        {
          outcome:
            state.output.changes.length === 0
              ? "demonstrated"
              : state.output.changes.some(({ severity }) => severity === "meaning-affecting")
                ? "not-demonstrated"
                : "developing",
          evidence: state.output.summary.slice(0, 1_000),
          uncertainty: state.output.overallUncertainty,
        },
      ],
      feedback: {
        source: { kind: "ai", modelRequestId: state.modelRequestId },
        summary: state.output.summary,
        strengths: state.output.changes.length === 0 ? ["No textual changes were needed."] : [],
        improvements,
        ...(state.output.nextPracticeSuggestion
          ? { nextStep: state.output.nextPracticeSuggestion }
          : {}),
        overallUncertainty: state.output.overallUncertainty,
        mistakeIds: mistakes.map(({ proposedMistakeId }) => proposedMistakeId),
        vocabularyCandidateIds: vocabularyEntries.map(({ vocabularyId }) => vocabularyId),
      },
      correction: {
        schemaVersion: 1,
        correctionId,
        attemptId,
        createdAt: completedAt,
        aiProvenance: provenance,
        alignment,
        naturalAlternative: state.output.naturalAlternative
          ? { status: "provided", text: state.output.naturalAlternative }
          : { status: "not-needed" },
        vocabularyCandidates: state.output.vocabularyCandidates,
        followUp: state.output.nextPracticeSuggestion
          ? {
              status: "suggested",
              title: state.output.nextPracticeSuggestion.slice(0, 160),
              reason: state.output.nextPracticeSuggestion,
              naturalRequest: state.output.nextPracticeSuggestion,
              grammarTopicIds: [],
            }
          : { status: "not-suggested" },
        overallUncertainty: state.output.overallUncertainty,
      },
      mistakes,
      vocabularyEntries,
      completedAt,
    });
    await repository.saveWritingAttempt(record);
    this.#emitEvent?.({ event: "state-invalidated", scope: "dashboard" });
    this.#emitEvent?.({ event: "state-invalidated", scope: "history" });
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
      const course = await readLearningCourse(this.#curriculumRoot);
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
        (operation.input.targetedMistakePattern ? "Targeted practice" : "Quiz"),
      originSurface: "desktop" as const,
      context: {
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
    const vocabularyEntries = (state.output.lesson?.vocabularyFoundations ?? []).map((item) => ({
      schemaVersion: 1 as const,
      targetLanguage: operation.input.learningContext.targetLanguage,
      vocabularyId: vocabularyIdSchema.parse(opaqueId("vocabulary")),
      lemma: item.term,
      meaning: item.explanation,
      lexeme: { partOfSpeech: "other" as const },
      examples: [{ text: item.example, meaning: item.explanation }],
      source: {
        kind: "activity" as const,
        activityId,
        context: item.example.slice(0, 500),
      },
      state: { status: "candidate" as const, confirmation: "required" as const },
    }));
    const material = operation.input.materialReference ??
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
