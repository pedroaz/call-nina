import {
  activityIdSchema,
  attemptIdSchema,
  correctionIdSchema,
  exerciseIdSchema,
  historyEntryIdSchema,
  mistakeIdSchema,
  utcInstantSchema,
  type DesktopIpcEvent,
} from "@call-nina/contracts";
import { alignCorrectionTexts } from "@call-nina/domain";
import {
  assertCallNinaDatabaseLease,
  writingAttemptPersistenceSchema,
  type CallNinaDatabase,
  type CallNinaRepository,
} from "@call-nina/persistence";
import {
  opaqueId,
  type AcceptedOperation,
  type ValidatedWritingState,
} from "../backend-support.js";

export class WritingResultPersistence {
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
  ): Promise<ReturnType<typeof activityIdSchema.parse>> {
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
    const vocabularyEntries: never[] = [];
    const lexicalChanges = state.output.changes.filter(
      (c) =>
        ["word-choice", "idiom", "register"].includes(c.category) && c.uncertainty.level === "none",
    );
    const words = state.output.vocabularyCandidates
      .filter(
        (c) =>
          c.uncertainty.level === "none" &&
          lexicalChanges.some(
            (change) =>
              change.correctedText.includes(c.lemma) ||
              (change.correctedText.length > 0 &&
                (c.sourceExcerpt.includes(change.correctedText) ||
                  c.lemma.includes(change.correctedText))) ||
              (c.sourceExcerpt.includes(change.originalText) && change.originalText.length > 0),
          ),
      )
      .slice(0, 20);
    const parsedRecord = writingAttemptPersistenceSchema.safeParse({
      vocabularyAnalysis: {
        title: operation.input.activityGoal.slice(0, 160),
        readable: true,
        extractedText: "",
        words: words.map((w) => ({
          lemma: w.lemma,
          meaning: w.meaning,
          lexeme: { partOfSpeech: "other" },
          examples: [{ text: w.sourceExcerpt, meaning: w.meaning }],
          reason: w.rationale,
          excerpt: w.sourceExcerpt,
          outcome: "difficulty",
          attemptId,
        })),
      },
      ...(operation.input.uploadSource ? { uploadSource: operation.input.uploadSource } : {}),
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
    if (!parsedRecord.success) {
      const field =
        parsedRecord.error.issues[0]?.path
          .map((part) =>
            typeof part === "string" ? part.replace(/[^a-z]/giu, "").toUpperCase() : "ENTRY",
          )
          .join("_")
          .slice(0, 65) || "UNKNOWN";
      throw new Error(`OD_WRITING_RESULT_INVALID_${field}`);
    }
    const record = parsedRecord.data;
    try {
      await repository.saveWritingAttempt(record);
    } catch (error) {
      if (error instanceof Error && /^OD_[A-Z0-9_]+$/u.test(error.message)) throw error;
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
              .replace(/[^A-Z0-9_]/gu, "")
              .slice(0, 45)
          : "UNKNOWN";
      throw new Error(`OD_WRITING_STORE_FAILED_${code}`);
    }
    this.#emitEvent?.({ event: "state-invalidated", scope: "dashboard" });
    this.#emitEvent?.({ event: "state-invalidated", scope: "history" });
    this.#emitEvent?.({ event: "state-invalidated", scope: "vocabulary" });
    return activityId;
  }
}
