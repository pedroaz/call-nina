import {
  activityIdSchema,
  type attemptFeedbackSaveInputSchema,
  attemptIdSchema,
  calendarDateSchema,
  capturedTeachingContextSchema,
  curriculumTopicIdSchema,
  correctionIdSchema,
  exerciseFeedbackCandidateSchema,
  exerciseGenerationCandidateSchema,
  generationProvenanceSchema,
  historyEntryIdSchema,
  learningContextSchema,
  learningGoalSchema,
  maximumExerciseContentBytes,
  maximumExerciseFeedbackBytes,
  maximumExerciseSnapshotBytes,
  modelRequestIdSchema,
  portableExerciseContentSchema,
  preparedActivitySchema,
  sessionIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  vocabularyIdSchema,
  z,
  type AttemptEvidence,
  type Language,
  type LearningScope,
  type ListeningResult,
  type PlacementResult,
} from "@call-nina/contracts";
import {
  aiProvenanceSchema,
  assertSharedExerciseActivity,
  attemptFeedbackSchema,
  type correctionVocabularyCandidateSchema,
  evaluateExerciseAnswer,
  exerciseAnswerSchema,
  learnerProfileSchema,
  mistakeCategorySchema,
  objectiveEvaluationSchema,
  resolveLearningContext,
  startedExerciseSnapshotSchema,
  vocabularyEntrySchema,
  vocabularyExampleSchema,
  type MistakeCategory,
  type VocabularyEntry,
  type VoiceSummary,
} from "@call-nina/domain";
import type { DatabaseSync } from "node:sqlite";
import { contentMaterialInputSchema, readStoredExerciseContent } from "./content.js";
import {
  activityLearningScope,
  assertRegisteredLearningScope as assertLocalLearningScope,
  parseScopedActivityContext,
  requireLocalLearningScope,
} from "./learning-context.js";

// Use the same policy for dashboard/library projections, detail reads and the transactional guard.
// Completion alone is not retained evidence after the learner explicitly deletes its history.
// Course missions keep their explicitly confirmed cascade; confirmed vocabulary always blocks.
export const preparedActivityDeletionStatusSql = `CASE
  WHEN EXISTS (
    SELECT 1 FROM vocabulary_entries v
    WHERE json_extract(v.source_json, '$.kind') = 'activity'
      AND json_extract(v.source_json, '$.activityId') = p.activity_id
      AND v.status <> 'candidate'
  ) THEN 'retained-data'
  WHEN json_extract(p.context_json, '$.courseTeaching.mission.id') IS NULL AND (
    EXISTS (
      SELECT 1 FROM attempts a JOIN exercises e USING(exercise_id)
      WHERE e.activity_id = p.activity_id AND (
        a.status = 'completed' OR EXISTS (
          SELECT 1 FROM history_entries h
          WHERE h.entity_kind = 'attempt' AND h.entity_id = a.attempt_id
        )
      )
    ) OR EXISTS (
      SELECT 1 FROM mcp_attempt_feedback f WHERE f.activity_id = p.activity_id
    ) OR EXISTS (
      SELECT 1 FROM learning_attempts a
      WHERE a.source_kind IN ('external', 'listening')
        AND json_extract(a.ownership_json, '$.source.activityId') = p.activity_id
    ) OR EXISTS (
      SELECT 1 FROM voice_summaries v
      WHERE json_extract(v.summary_json, '$.activity.activityId') = p.activity_id
    ) OR EXISTS (
      SELECT 1 FROM course_results r WHERE r.activity_id = p.activity_id
    )
  ) THEN 'retained-data'
  WHEN EXISTS (SELECT 1 FROM exercises e WHERE e.activity_id = p.activity_id)
    OR EXISTS (SELECT 1 FROM course_results r WHERE r.activity_id = p.activity_id)
    THEN 'cascade'
  ELSE 'available'
END`;

export { preparedActivitySchema } from "@call-nina/contracts";

export const historyActivityTypeSchema = z.enum([
  "writing",
  "grammar",
  "vocabulary-review",
  "reading",
  "codex-listening",
  "voice-speaking",
  "placement",
  "custom-lesson",
]);

export const historyFilterSchema = z.strictObject({
  correctionId: correctionIdSchema.optional(),
  search: z.string().trim().max(160).optional(),
  activityId: activityIdSchema.optional(),
  cursor: z
    .strictObject({ occurredAt: utcInstantSchema, historyEntryId: historyEntryIdSchema })
    .optional(),
  historyEntryIds: z.array(historyEntryIdSchema).min(1).max(100).optional(),
  skill: z.enum(["writing", "reading", "listening", "speaking"]).optional(),
  activityType: historyActivityTypeSchema.optional(),
  fromDate: calendarDateSchema.optional(),
  toDate: calendarDateSchema.optional(),
  curriculumTopicId: curriculumTopicIdSchema.optional(),
  mistakeCategory: z.string().min(1).max(120).optional(),
  maximum: z.int().min(1).max(200).default(50),
});

export const mistakePatternFilterSchema = z.strictObject({
  fromDate: calendarDateSchema.optional(),
  toDate: calendarDateSchema.optional(),
  curriculumTopicId: curriculumTopicIdSchema.optional(),
  mistakeCategory: z.string().min(1).max(120).optional(),
  maximum: z.int().min(1).max(50).default(50),
});

export type PreparedActivityRecord = z.infer<typeof preparedActivitySchema>;

export type HistoryFilter = z.input<typeof historyFilterSchema>;

export type HistoryPageRecord = Readonly<{
  entries: readonly HistoryEntryRecord[];
  nextCursor: NonNullable<HistoryFilter["cursor"]> | null;
}>;

export type HistoryEntryRecord = Readonly<{
  activityAvailable: boolean;
  targetLanguage: Language;
  historyEntryId: string;
  evidence: AttemptEvidence | null;
  entityKind: "attempt" | "correction" | "vocabulary-review" | "voice-summary" | "placement";
  entityId: string;
  skill: "writing" | "reading" | "listening" | "speaking";
  activityType: PreparedActivityRecord["activityType"];
  title: string;
  occurredAt: string;
  curriculumTopicIds: readonly string[];
  mistakeCategories: readonly string[];
  detail:
    | Readonly<{
        kind: "writing-correction";
        learnerText: string;
        correctedText: string;
        feedback: ReturnType<typeof attemptFeedbackSchema.parse>;
        aiProvenance: ReturnType<typeof aiProvenanceSchema.parse>;
        vocabularyCandidates: readonly ReturnType<
          typeof correctionVocabularyCandidateSchema.parse
        >[];
        changes: readonly Readonly<{
          category: string;
          explanation: string;
        }>[];
      }>
    | Readonly<{
        kind: "exercise-attempt";
        activityId: string;
        snapshot: ReturnType<typeof startedExerciseSnapshotSchema.parse>;
        answer: ReturnType<typeof exerciseAnswerSchema.parse>;
        objectiveEvaluations: readonly ReturnType<typeof objectiveEvaluationSchema.parse>[];
        feedback: ReturnType<typeof attemptFeedbackSchema.parse>;
        feedbackProvenance: z.infer<typeof generationProvenanceSchema> | null;
        suggestedAnswer: string | null;
        readingMaterial: ReturnType<
          typeof exerciseGenerationCandidateSchema.parse
        >["readingMaterial"];
        translation?: Readonly<{
          content: Readonly<{ contentId: string; revisionId: string }>;
          position: number;
          attemptId: string;
          fields: Readonly<{
            summary: boolean;
            strengths: readonly number[];
            improvements: readonly number[];
          }>;
        }>;
      }>
    | Readonly<{
        kind: "voice-summary";
        scenario: VoiceSummary["scenario"];
        duration: VoiceSummary["duration"];
        observedIssues: VoiceSummary["observedIssues"];
        vocabulary: VoiceSummary["vocabulary"];
        feedback: VoiceSummary["feedback"];
        nextSteps: VoiceSummary["nextSteps"];
      }>
    | Readonly<PlacementResult & { kind: "placement" }>
    | Readonly<ListeningResult & { kind: "listening" }>
    | Readonly<{
        kind: "attempt-feedback";
        feedback: z.infer<typeof attemptFeedbackSaveInputSchema>["feedback"];
        later: boolean;
      }>
    | Readonly<{ kind: "reference" }>;
  rootGeneration: number;
}>;

export const learnerSettingsInputSchema = strictBoundaryObject({
  profile: learnerProfileSchema,
});

export const learnerSettingsRecordSchema = learnerSettingsInputSchema.extend({
  learningContext: learningContextSchema,
});

export const learnerSettingsUpdateSchema = strictBoundaryObject({
  expectedUpdatedAt: utcInstantSchema,
  settings: learnerSettingsRecordSchema,
});

export type LearnerSettingsRecord = z.infer<typeof learnerSettingsRecordSchema>;

export type LearnerSettingsUpdate = z.infer<typeof learnerSettingsUpdateSchema>;

export type DashboardSnapshot = Readonly<{
  rootGeneration: number;
  preparedActivities: readonly Readonly<{
    activityId: string;
    activityType: PreparedActivityRecord["activityType"];
    title: string;
    originSurface: PreparedActivityRecord["originSurface"];
    preparedAt: string;
    deletionStatus: "available" | "cascade" | "retained-data";
  }>[];
  dueVocabulary: readonly Readonly<{
    vocabularyId: string;
    lemma: string;
    meaning: string;
    dueOn: string;
    stage: number;
  }>[];
  recentCorrections: readonly Readonly<{
    correctionId: string;
    createdAt: string;
    changedSegmentCount: number;
  }>[];
  recurringMistakes: readonly Readonly<{
    mistakeId: string;
    category: MistakeCategory;
    occurrenceCount: number;
    lastObservedOn: string;
  }>[];
}>;

export type CorrectionMistakeSample = Readonly<
  | {
      kind: "grammar";
      categoryKey: string;
      occurrenceCount: number;
      lastObservedOn: string;
    }
  | {
      kind: "vocabulary";
      categoryKey: string;
      lemma: string;
      occurrenceCount: number;
      lastObservedOn: string;
    }
>;

export type MistakePatternRecord = Readonly<{
  category: MistakeCategory;
  status: "single-occurrence" | "recurring";
  occurrenceCount: number;
  classificationSource: "inferred" | "learner-amended" | "mixed";
  occurrences: readonly Readonly<{
    mistakeId: string;
    observedOn: string;
    evidence: Readonly<{
      beforeContext: string;
      evidenceText: string;
      afterContext: string;
    }>;
    explanation: string;
    classificationSource: "inferred" | "learner-amended";
  }>[];
  targetedPractice:
    | Readonly<{ status: "not-created" }>
    | Readonly<{ status: "created"; activityId: string; createdAt: string }>;
}>;

export const targetedPracticeActivitySchema = strictBoundaryObject({
  capturedContext: capturedTeachingContextSchema,
  material: contentMaterialInputSchema,
  learnerGoal: learningGoalSchema,
  activity: preparedActivitySchema,
  category: mistakeCategorySchema,
  aiProvenance: aiProvenanceSchema,
  generationProvenance: generationProvenanceSchema,
  output: exerciseGenerationCandidateSchema,
  vocabularyEntries: z.array(vocabularyEntrySchema).max(50).default([]),
});

export type TargetedPracticeActivity = z.infer<typeof targetedPracticeActivitySchema>;

export const generatedPracticeActivitySchema = strictBoundaryObject({
  capturedContext: capturedTeachingContextSchema,
  material: contentMaterialInputSchema,
  learnerGoal: learningGoalSchema,
  activity: preparedActivitySchema,
  aiProvenance: aiProvenanceSchema,
  generationProvenance: generationProvenanceSchema,
  output: exerciseGenerationCandidateSchema,
  vocabularyEntries: z.array(vocabularyEntrySchema).max(50).default([]),
});

export type GeneratedPracticeActivity = z.infer<typeof generatedPracticeActivitySchema>;

export const generatedActivityReadSchema = strictBoundaryObject({
  activityId: activityIdSchema,
  title: z.string().min(1).max(160),
  context: preparedActivitySchema.shape.context,
  aiProvenance: aiProvenanceSchema,
  content: portableExerciseContentSchema,
});

export const storedExerciseFeedbackSchema = z.strictObject({
  modelRequestId: modelRequestIdSchema,
  output: exerciseFeedbackCandidateSchema,
});

export const generatedExerciseFeedbackSaveSchema = storedExerciseFeedbackSchema.extend({
  provenance: generationProvenanceSchema.required({ connectionId: true }),
});

export function readStoredExerciseFeedback(row: Record<string, unknown>) {
  if (row["feedback_json"] === null || row["feedback_json"] === undefined) return null;
  return {
    ...storedExerciseFeedbackSchema.parse(
      parseJson(row["feedback_json"], maximumExerciseFeedbackBytes),
    ),
    // NULL is an honest historical unknown, never the activity's or active connection's model.
    provenance:
      row["provenance_json"] === null
        ? null
        : generationProvenanceSchema.parse(parseJson(row["provenance_json"])),
  };
}

export function readGeneratedExerciseAttempt(
  connection: DatabaseSync,
  activityId: string,
  attemptId: string,
) {
  const row = connection
    .prepare(
      `SELECT a.exercise_snapshot_json, p.activity_type, p.title,
        p.origin_surface, p.prepared_at, p.context_json, g.output_json,
        r.content_revision_id, ans.answer_json, f.feedback_json, f.provenance_json
       FROM attempts a JOIN exercises e USING(exercise_id)
       JOIN prepared_activities p ON p.activity_id = e.activity_id
       JOIN generated_activity_payloads g ON g.activity_id = p.activity_id
       JOIN attempt_content_revisions r ON r.attempt_id = a.attempt_id AND r.activity_id = p.activity_id
       LEFT JOIN answers ans ON ans.attempt_id = a.attempt_id AND ans.position = 0
       LEFT JOIN exercise_attempt_feedback f ON f.attempt_id = a.attempt_id
       WHERE a.attempt_id = ? AND p.activity_id = ? AND a.status = 'in-progress' AND p.status = 'prepared'`,
    )
    .get(attemptId, activityId);
  if (!row) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
  assertSharedExerciseActivity({
    activityId,
    activityType: row["activity_type"],
    title: row["title"],
    originSurface: row["origin_surface"],
    preparedAt: row["prepared_at"],
    context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
  });
  const content = readStoredExerciseContent(
    connection,
    activityId,
    parseJson(row["output_json"], maximumExerciseContentBytes),
  );
  if (content.revisionId !== row["content_revision_id"])
    throw new Error("OD_ATTEMPT_REVISION_MISMATCH");
  const snapshot = startedExerciseSnapshotSchema.parse(
    parseJson(row["exercise_snapshot_json"], maximumExerciseSnapshotBytes),
  );
  const answer = row["answer_json"]
    ? exerciseAnswerSchema.parse(parseJson(row["answer_json"]))
    : null;
  const feedback = readStoredExerciseFeedback(row);
  if (
    feedback &&
    (!answer ||
      evaluateExerciseAnswer(
        snapshot.exercise,
        answer,
        activityLearningScope(connection, activityId).targetLanguage,
      ).status !== "requires-ai" ||
      feedback.output.objectiveEvaluations.length !== snapshot.exercise.objectives.length)
  )
    throw new Error("OD_EXERCISE_AI_FEEDBACK_INVALID");
  return { snapshot, answer, feedback, content };
}

export const generatedExerciseSetStartSchema = strictBoundaryObject({
  activityId: activityIdSchema,
  startedAt: utcInstantSchema,
  replaces: z.array(attemptIdSchema).max(30),
  exercises: z
    .array(
      z.strictObject({
        attemptId: attemptIdSchema,
        snapshot: startedExerciseSnapshotSchema,
      }),
    )
    .min(1)
    .max(30),
});

export type GeneratedActivityRead = z.infer<typeof generatedActivityReadSchema>;

export const activeGeneratedExerciseSetSchema = strictBoundaryObject({
  startedAt: utcInstantSchema,
  attemptIds: z.array(attemptIdSchema).min(1).max(30),
  progress: z
    .array(
      z.strictObject({
        answer: exerciseAnswerSchema.nullable(),
        feedback: exerciseFeedbackCandidateSchema.nullable(),
        feedbackProvenance: generationProvenanceSchema.nullable(),
        hintsUsed: z.int().nonnegative(),
      }),
    )
    .min(1)
    .max(30),
});

export type ActiveGeneratedExerciseSet = z.infer<typeof activeGeneratedExerciseSetSchema>;

export type GeneratedExerciseSetStart = z.infer<typeof generatedExerciseSetStartSchema>;

export const generatedExerciseSetCompleteSchema = strictBoundaryObject({
  activityId: activityIdSchema,
  completedAt: utcInstantSchema,
  answers: z
    .array(
      z.strictObject({
        attemptId: attemptIdSchema,
        historyEntryId: historyEntryIdSchema,
        answer: exerciseAnswerSchema,
      }),
    )
    .min(1)
    .max(30),
});

export type GeneratedExerciseSetComplete = z.infer<typeof generatedExerciseSetCompleteSchema>;

export const generatedExerciseSetAbandonSchema = strictBoundaryObject({
  activityId: activityIdSchema,
  abandonedAt: utcInstantSchema,
});

export type GeneratedExerciseSetAbandon = z.infer<typeof generatedExerciseSetAbandonSchema>;

export type VocabularyRecord = Readonly<{
  entry: VocabularyEntry;
  revision: number;
  updatedAt: string;
}>;

export const vocabularyReviewSessionCardSchema = strictBoundaryObject({
  vocabularyId: vocabularyIdSchema,
  direction: z.enum(["recognition", "production"]),
  cue: z.string().min(1).max(500).regex(/\S/u),
  example: vocabularyExampleSchema,
  sourceContext: z.string().min(1).max(500).regex(/\S/u),
  expectedAnswer: z.string().min(1).max(500).regex(/\S/u),
  dueOn: calendarDateSchema,
});

export type VocabularyReviewSessionCard = z.infer<typeof vocabularyReviewSessionCardSchema>;

export const vocabularyReviewSessionSchema = strictBoundaryObject({
  sessionId: sessionIdSchema,
  onDate: calendarDateSchema,
  items: z.array(vocabularyReviewSessionCardSchema).max(50),
});

export type VocabularyReviewSession = z.infer<typeof vocabularyReviewSessionSchema>;

export const vocabularyLessonSetRecordSchema = strictBoundaryObject({
  setId: activityIdSchema,
  title: z.string().min(1).max(160).regex(/\S/u),
  requestedFrom: z.enum(["desktop", "codex"]),
  naturalRequest: z.string().min(1).max(1_000).regex(/\S/u),
  goal: z.string().min(1).max(500).nullable(),
  topic: z.string().min(1).max(160).nullable(),
  curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
  mistakeCategories: z.array(z.string().min(1).max(120).regex(/\S/u)).max(12),
  createdAt: utcInstantSchema,
  items: z
    .array(
      strictBoundaryObject({
        position: z.int().min(0).max(49),
        vocabularyId: vocabularyIdSchema,
      }),
    )
    .max(50),
});

export type VocabularyLessonSetRecord = z.infer<typeof vocabularyLessonSetRecordSchema>;

export const generatedExerciseHistorySchema = strictBoundaryObject({
  readingMaterial: exerciseGenerationCandidateSchema.shape.readingMaterial,
  kind: z.literal("exercise-attempt"),
  snapshot: startedExerciseSnapshotSchema,
  answer: exerciseAnswerSchema,
  objectiveEvaluations: z.array(objectiveEvaluationSchema).min(1).max(12),
  feedback: attemptFeedbackSchema,
  suggestedAnswer: z.string().min(1).max(12_000).nullable(),
});

export const generatedExerciseAnswerSaveSchema = strictBoundaryObject({
  activityId: activityIdSchema,
  attemptId: attemptIdSchema,
  submittedAt: utcInstantSchema,
  answer: exerciseAnswerSchema,
});

export type GeneratedExerciseAnswerSave = z.infer<typeof generatedExerciseAnswerSaveSchema>;

export function stringifyBounded(value: unknown, maximumBytes = 262_144): string {
  if (value === undefined) throw new Error("OD_REPOSITORY_JSON_INVALID");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error("OD_REPOSITORY_JSON_TOO_LARGE");
  }
  return serialized;
}

export function insertActivityVocabularyCandidates(
  connection: DatabaseSync,
  entries: readonly VocabularyEntry[],
  activityId: string,
  createdAt: string,
): void {
  const insert = connection.prepare(
    `INSERT INTO vocabulary_entries (target_language,
      vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const entryValue of entries) {
    const entry = vocabularyEntrySchema.parse(entryValue);
    if (
      entry.state.status !== "candidate" ||
      entry.source.kind !== "activity" ||
      entry.source.activityId !== activityId ||
      entry.targetLanguage !== activityLearningScope(connection, activityId).targetLanguage
    ) {
      throw new Error("OD_GENERATED_PRACTICE_VOCABULARY_INVALID");
    }
    insert.run(
      entry.targetLanguage,
      entry.vocabularyId,
      entry.lemma,
      entry.meaning,
      stringifyBounded(entry.lexeme),
      stringifyBounded(entry.examples),
      stringifyBounded(entry.source),
      createdAt,
      createdAt,
    );
  }
}

export function parseJson(value: unknown, maximumBytes?: number): unknown {
  const serialized = String(value);
  if (maximumBytes !== undefined && Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error("OD_REPOSITORY_JSON_TOO_LARGE");
  }
  return JSON.parse(serialized) as unknown;
}

export function readLearnerSettingsFromConnection(
  connection: DatabaseSync,
  learnerId: string,
  requestedScope?: LearningScope,
): LearnerSettingsRecord | undefined {
  const row = connection
    .prepare(
      `SELECT p.*, s.ui_locale
       FROM learner_profiles p
       JOIN learner_settings s ON s.learner_id = p.learner_id
       WHERE p.learner_id = ?`,
    )
    .get(learnerId) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const scope = requestedScope ?? requireLocalLearningScope(connection);
  assertLocalLearningScope(connection, scope);
  const languageRow = connection
    .prepare(
      "SELECT profile_json FROM language_profiles WHERE target_language = ? AND learner_id = ?",
    )
    .get(scope.targetLanguage, learnerId);
  if (!languageRow) throw new Error("OD_LEARNING_CONTEXT_INVALID");
  const profile = learnerProfileSchema.parse({
    ...learnerProfileSchema.parse(parseJson(languageRow["profile_json"])),
    uiLocale: row["ui_locale"],
  });

  if (scope.learnerId !== learnerId) throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
  return learnerSettingsRecordSchema.parse({
    profile,
    learningContext: resolveLearningContext(scope, profile),
  });
}

export function vocabularyEntryFromRow(row: Record<string, unknown>): VocabularyEntry {
  const schedule =
    row["last_review_id"] === null
      ? { status: "new" as const, dueOn: row["due_on"], stage: 1 as const }
      : {
          status: "reviewed" as const,
          dueOn: row["due_on"],
          stage: row["stage"],
          lastReview: {
            reviewId: row["last_review_id"],
            reviewedAt: row["last_reviewed_at"],
            grade: row["last_grade"],
          },
        };
  return vocabularyEntrySchema.parse({
    schemaVersion: 1,
    targetLanguage: row["target_language"],
    vocabularyId: row["vocabulary_id"],
    lemma: row["lemma"],
    meaning: row["meaning"],
    lexeme: parseJson(row["lexeme_json"]),
    examples: parseJson(row["examples_json"]),
    source: parseJson(row["source_json"]),
    state:
      row["status"] === "candidate"
        ? { status: "candidate", confirmation: "required" }
        : row["status"] === "suspended"
          ? {
              status: "suspended",
              confirmedAt: row["confirmed_at"],
              schedule,
              suspendedAt: row["suspended_at"],
              reason: row["suspension_reason"],
            }
          : { status: row["status"], confirmedAt: row["confirmed_at"], schedule },
  });
}

export function vocabularyRecordFromRow(row: Record<string, unknown>): VocabularyRecord {
  return {
    entry: vocabularyEntryFromRow(row),
    revision: z.int().nonnegative().parse(row["revision"]),
    updatedAt: utcInstantSchema.parse(row["updated_at"]),
  };
}
