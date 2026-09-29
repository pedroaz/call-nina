import { linkPortableContent } from "./materials.js";
import {
  contentMaterialInputSchema,
  preparePortableContent,
  readStoredExerciseContent,
} from "./content.js";
import {
  vocabularySearchPolicy,
  readLocalLearningScope,
  requireLocalLearningScope,
  parseScopedActivityContext,
  assertLocalLearningScope,
} from "./learning-context.js";
import { resolveLearningContext, supportedCourse, validateCourseEvidence } from "@call-nina/domain";
import { readLearningPathState, updateLearningPath, saveCourseEvidence } from "./learning-path.js";
import { readPersonalDataInventory, clearPersonalData } from "./personal-data.js";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  learningContextSchema,
  learningGoalSchema,
  portableExerciseContentSchema,
  maximumExerciseContentBytes,
  maximumMaterializedExerciseBytes,
  maximumExerciseSnapshotBytes,
  maximumExerciseFeedbackBytes,
  maximumExerciseHistoryBytes,
  type LearningCourse,
  type CourseEvidence,
  vocabularyLibraryFilterSchema,
  vocabularyBulkRequestSchema,
  vocabularySummarySchema,
  vocabularyCountsSchema,
  practiceSuggestionContextSchema,
  activityIdSchema,
  attemptIdSchema,
  type attemptFeedbackSaveInputSchema,
  calendarDateSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  exerciseGenerationCandidateSchema,
  exerciseFeedbackCandidateSchema,
  historyEntryIdSchema,
  listeningResultSchema,
  learnerIdSchema,
  mistakeIdSchema,
  modelRequestIdSchema,
  placementResultSchema,
  preparedActivitySchema,
  activityLibraryFilterSchema,
  activityLibraryItemSchema,
  reviewIdSchema,
  sessionIdSchema,
  strictBoundaryObject,
  type PlacementResult,
  type ListeningResult,
  utcInstantSchema,
  vocabularyIdSchema,
  z,
  type AttemptId,
} from "@call-nina/contracts";
import {
  aiProvenanceSchema,
  attemptFeedbackSchema,
  correctionVocabularyCandidateSchema,
  defaultModelPreferences,
  exerciseAnswerSchema,
  evaluateExerciseAnswer,
  materializeContentExercises,
  learnerProfileSchema,
  mistakeCategorySchema,
  modelPreferencesSchema,
  modelWorkloads,
  objectiveEvaluationSchema,
  scheduleVocabularyReview,
  vocabularyEntrySchema,
  vocabularyExampleSchema,
  vocabularyLessonSetRequestSchema,
  type VocabularyLessonSetRequest,
  vocabularyReviewSchema,
  voiceSummarySchema,
  startedExerciseSnapshotSchema,
  type MistakeCategory,
  type LearnerProfile,
  type ModelPreferences,
  type VocabularyEntry,
  type VocabularyReview,
  type VoiceSummary,
} from "@call-nina/domain";

import { type CallNinaDatabase, withLeasedConnection, withLeasedTransaction } from "./sqlite.js";
import { claimIdempotentWrite, type IdempotentWriteResult } from "./idempotency.js";
import { saveWritingAttempt, type WritingAttemptPersistence } from "./writing-attempt.js";

export { preparedActivitySchema } from "@call-nina/contracts";

const historyActivityTypeSchema = z.enum([
  "writing",
  "grammar",
  "vocabulary-review",
  "reading",
  "codex-listening",
  "voice-speaking",
  "placement",
  "custom-lesson",
]);

const historyFilterSchema = z.strictObject({
  historyEntryIds: z.array(historyEntryIdSchema).min(1).max(100).optional(),
  skill: z.enum(["writing", "reading", "listening", "speaking"]).optional(),
  activityType: historyActivityTypeSchema.optional(),
  fromDate: calendarDateSchema.optional(),
  toDate: calendarDateSchema.optional(),
  curriculumTopicId: curriculumTopicIdSchema.optional(),
  mistakeCategory: z.string().min(1).max(120).optional(),
  maximum: z.int().min(1).max(200).default(50),
});
const mistakePatternFilterSchema = z.strictObject({
  fromDate: calendarDateSchema.optional(),
  toDate: calendarDateSchema.optional(),
  curriculumTopicId: curriculumTopicIdSchema.optional(),
  mistakeCategory: z.string().min(1).max(120).optional(),
  maximum: z.int().min(1).max(50).default(50),
});

export type PreparedActivityRecord = z.infer<typeof preparedActivitySchema>;
export type HistoryFilter = z.input<typeof historyFilterSchema>;
export type HistoryEntryRecord = Readonly<{
  historyEntryId: string;
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
        suggestedAnswer: string | null;
        readingMaterial: ReturnType<
          typeof exerciseGenerationCandidateSchema.parse
        >["readingMaterial"];
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
    | Readonly<{ kind: "reference" }>;
  rootGeneration: number;
}>;

const learnerSettingsInputSchema = strictBoundaryObject({
  profile: learnerProfileSchema,
  modelPreferences: modelPreferencesSchema,
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
  material: contentMaterialInputSchema,
  learnerGoal: learningGoalSchema,
  activity: preparedActivitySchema,
  category: mistakeCategorySchema,
  aiProvenance: aiProvenanceSchema,
  output: exerciseGenerationCandidateSchema,
  vocabularyEntries: z.array(vocabularyEntrySchema).max(50).default([]),
});
export type TargetedPracticeActivity = z.infer<typeof targetedPracticeActivitySchema>;
export const generatedPracticeActivitySchema = strictBoundaryObject({
  material: contentMaterialInputSchema,
  learnerGoal: learningGoalSchema,
  activity: preparedActivitySchema,
  aiProvenance: aiProvenanceSchema,
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
export const generatedExerciseSetStartSchema = strictBoundaryObject({
  activityId: activityIdSchema,
  startedAt: utcInstantSchema,
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
        aiFeedback: z
          .strictObject({
            modelRequestId: modelRequestIdSchema,
            output: exerciseFeedbackCandidateSchema,
          })
          .optional(),
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
const generatedExerciseHistorySchema = strictBoundaryObject({
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

function stringifyBounded(value: unknown, maximumBytes = 262_144): string {
  if (value === undefined) throw new Error("OD_REPOSITORY_JSON_INVALID");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error("OD_REPOSITORY_JSON_TOO_LARGE");
  }
  return serialized;
}

function insertActivityVocabularyCandidates(
  connection: DatabaseSync,
  entries: readonly VocabularyEntry[],
  activityId: string,
  createdAt: string,
): void {
  const insert = connection.prepare(
    `INSERT INTO vocabulary_entries (
      vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const entryValue of entries) {
    const entry = vocabularyEntrySchema.parse(entryValue);
    if (
      entry.state.status !== "candidate" ||
      entry.source.kind !== "activity" ||
      entry.source.activityId !== activityId
    ) {
      throw new Error("OD_GENERATED_PRACTICE_VOCABULARY_INVALID");
    }
    insert.run(
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

function parseJson(value: unknown, maximumBytes?: number): unknown {
  const serialized = String(value);
  if (maximumBytes !== undefined && Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error("OD_REPOSITORY_JSON_TOO_LARGE");
  }
  return JSON.parse(serialized) as unknown;
}

function booleanFromSqlite(value: unknown): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error("OD_LEARNER_SETTINGS_INVALID");
}

function modelPreferenceColumns(preference: ModelPreferences[(typeof modelWorkloads)[number]]) {
  return {
    modelMode: preference.model.mode,
    modelId: preference.model.mode === "exact" ? preference.model.modelId : null,
    effortMode: preference.effort.mode,
    semanticEffort: preference.effort.mode === "semantic" ? preference.effort.effort : null,
    effortId: preference.effort.mode === "exact" ? preference.effort.effortId : null,
  };
}

function writeModelPreferences(
  connection: DatabaseSync,
  learnerId: string,
  preferences: ModelPreferences,
  updatedAt: string,
) {
  connection.prepare(`DELETE FROM model_preference_overrides WHERE learner_id = ?`).run(learnerId);
  const insert = connection.prepare(
    `INSERT INTO model_preference_overrides (
      learner_id, workload, model_mode, model_id, effort_mode,
      semantic_effort, effort_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const workload of modelWorkloads) {
    const preference = preferences[workload];
    if (JSON.stringify(preference) === JSON.stringify(defaultModelPreferences[workload])) continue;
    const columns = modelPreferenceColumns(preference);
    insert.run(
      learnerId,
      workload,
      columns.modelMode,
      columns.modelId,
      columns.effortMode,
      columns.semanticEffort,
      columns.effortId,
      updatedAt,
    );
  }
}

function readLearnerSettingsFromConnection(
  connection: DatabaseSync,
  learnerId: string,
): LearnerSettingsRecord | undefined {
  const row = connection
    .prepare(
      `SELECT p.*, s.ui_locale, s.explanation_language, s.teaching_profile_id,
        s.correction_timing, s.correction_coverage, s.show_concise_explanation,
        s.show_natural_alternative
       FROM learner_profiles p
       JOIN learner_settings s ON s.learner_id = p.learner_id
       WHERE p.learner_id = ?`,
    )
    .get(learnerId) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const strings = (table: "learner_interests" | "learner_preferred_topics") =>
    connection
      .prepare(`SELECT value FROM ${table} WHERE learner_id = ? ORDER BY position`)
      .all(learnerId)
      .map((entry) => String(entry["value"]));
  const insights = (group: "strength" | "weakness") =>
    connection
      .prepare(
        `SELECT curriculum_topic_id, label, note, confidence, source, learner_edited, updated_at
         FROM learner_profile_insights
         WHERE learner_id = ? AND insight_group = ? ORDER BY position`,
      )
      .all(learnerId, group)
      .map((entry) => ({
        ...(entry["curriculum_topic_id"] === null ? {} : { topicId: entry["curriculum_topic_id"] }),
        label: entry["label"],
        ...(entry["note"] === null ? {} : { note: entry["note"] }),
        confidence: entry["confidence"],
        source: entry["source"],
        learnerEdited: booleanFromSqlite(entry["learner_edited"]),
        updatedAt: entry["updated_at"],
      }));

  const levelEstimate = {
    currentLevel: row["current_level"],
    targetLevel: row["target_level"],
    basis: row["level_basis"],
    ...(row["optional_diagnostic_completed_on"] === null
      ? {}
      : { optionalDiagnosticCompletedOn: row["optional_diagnostic_completed_on"] }),
    updatedAt: row["level_updated_at"],
  };
  const profile = learnerProfileSchema.parse({
    schemaVersion: row["schema_version"],
    learnerId: row["learner_id"],
    levelEstimate,
    everydayLifeGoal: row["everyday_life_goal"],
    motivation: row["motivation"],
    interests: strings("learner_interests"),
    preferredTopics: strings("learner_preferred_topics"),
    correctionPreferences: {
      timing: row["correction_timing"],
      coverage: row["correction_coverage"],
      showConciseExplanation: booleanFromSqlite(row["show_concise_explanation"]),
      showNaturalAlternative: booleanFromSqlite(row["show_natural_alternative"]),
    },
    onboardingState: row["onboarding_state"],
    inferredStrengths: insights("strength"),
    inferredWeaknesses: insights("weakness"),
    uiLocale: row["ui_locale"],
    explanationLanguage: row["explanation_language"],
    defaultTeachingProfileId: row["teaching_profile_id"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  });

  const preferenceRows = connection
    .prepare(
      `SELECT d.workload,
        COALESCE(o.model_mode, d.model_mode) AS model_mode,
        COALESCE(o.model_id, d.model_id) AS model_id,
        COALESCE(o.effort_mode, d.effort_mode) AS effort_mode,
        COALESCE(o.semantic_effort, d.semantic_effort) AS semantic_effort,
        COALESCE(o.effort_id, d.effort_id) AS effort_id
       FROM model_preference_defaults d
       LEFT JOIN model_preference_overrides o
         ON o.workload = d.workload AND o.learner_id = ?
       ORDER BY d.workload`,
    )
    .all(learnerId);
  const preferenceEntries = preferenceRows.map((entry) => [
    entry["workload"],
    {
      model:
        entry["model_mode"] === "automatic"
          ? { mode: "automatic" }
          : { mode: "exact", modelId: entry["model_id"] },
      effort:
        entry["effort_mode"] === "semantic"
          ? { mode: "semantic", effort: entry["semantic_effort"] }
          : { mode: "exact", effortId: entry["effort_id"] },
    },
  ]);
  const modelPreferences = modelPreferencesSchema.parse({
    schemaVersion: 1,
    ...Object.fromEntries(preferenceEntries),
  });
  const scope = requireLocalLearningScope(connection);
  if (scope.learnerId !== learnerId) throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
  return learnerSettingsRecordSchema.parse({
    profile,
    modelPreferences,
    learningContext: resolveLearningContext(scope, profile),
  });
}

function insertOrderedStrings(
  connection: DatabaseSync,
  table: "learner_interests" | "learner_preferred_topics",
  learnerId: string,
  values: readonly string[],
) {
  const statement = connection.prepare(
    `INSERT INTO ${table} (learner_id, position, value) VALUES (?, ?, ?)`,
  );
  for (const [position, value] of values.entries()) statement.run(learnerId, position, value);
}

function insertInsights(
  connection: DatabaseSync,
  learnerId: string,
  group: "strength" | "weakness",
  values: LearnerProfile["inferredStrengths"],
) {
  const statement = connection.prepare(
    `INSERT INTO learner_profile_insights (
      learner_id, insight_group, position, curriculum_topic_id, label, note,
      confidence, source, learner_edited, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [position, insight] of values.entries()) {
    statement.run(
      learnerId,
      group,
      position,
      insight.topicId ?? null,
      insight.label,
      insight.note ?? null,
      insight.confidence,
      insight.source,
      insight.learnerEdited ? 1 : 0,
      insight.updatedAt,
    );
  }
}

export class CallNinaRepository {
  readonly #database: CallNinaDatabase;

  constructor(database: CallNinaDatabase) {
    this.#database = database;
  }

  async requireLearningScope() {
    return withLeasedConnection(this.#database, requireLocalLearningScope);
  }

  async requireLearningContext() {
    const settings = await this.readCurrentLearnerSettings();
    if (!settings) throw new Error("OD_LEARNING_CONTEXT_REQUIRED");
    return settings.learningContext;
  }

  async readLearningPathState() {
    return readLearningPathState(this.#database);
  }

  async updateLearningPath(course: LearningCourse, input: unknown, locale: "en" | "de") {
    return updateLearningPath(this.#database, course, input, locale);
  }

  async readPersonalDataInventory() {
    return readPersonalDataInventory(this.#database);
  }

  async clearPersonalData(input: Parameters<typeof clearPersonalData>[1]) {
    return clearPersonalData(this.#database, input);
  }

  async saveWritingAttempt(record: WritingAttemptPersistence): Promise<void> {
    await saveWritingAttempt(this.#database, record);
  }

  async hasAcknowledgedFirstAiDisclosure(): Promise<boolean> {
    return withLeasedConnection(
      this.#database,
      (connection) =>
        connection
          .prepare(`SELECT 1 FROM privacy_acknowledgements WHERE disclosure = 'first-ai-action'`)
          .get() !== undefined,
    );
  }

  async acknowledgeFirstAiDisclosure(acknowledgedAtValue: string): Promise<void> {
    const acknowledgedAt = utcInstantSchema.parse(acknowledgedAtValue);
    await withLeasedTransaction(this.#database, (connection) => {
      connection
        .prepare(
          `INSERT OR IGNORE INTO privacy_acknowledgements (disclosure, acknowledged_at)
           VALUES ('first-ai-action', ?)`,
        )
        .run(acknowledgedAt);
    });
  }

  async readCurrentLearnerSettings(): Promise<LearnerSettingsRecord | undefined> {
    return withLeasedConnection(this.#database, (connection) => {
      const scope = readLocalLearningScope(connection);
      return scope ? readLearnerSettingsFromConnection(connection, scope.learnerId) : undefined;
    });
  }

  async createLearnerSettings(
    settingsValue: z.infer<typeof learnerSettingsInputSchema>,
  ): Promise<LearnerSettingsRecord> {
    const settings = learnerSettingsInputSchema.parse(settingsValue);
    const profile = settings.profile;
    return withLeasedTransaction(this.#database, (connection) => {
      connection
        .prepare(
          `INSERT INTO learner_profiles (
            learner_id, schema_version, current_level, target_level, level_basis,
            optional_diagnostic_completed_on, level_updated_at, everyday_life_goal,
            motivation, onboarding_state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          profile.learnerId,
          profile.schemaVersion,
          profile.levelEstimate.currentLevel,
          profile.levelEstimate.targetLevel,
          profile.levelEstimate.basis,
          profile.levelEstimate.optionalDiagnosticCompletedOn ?? null,
          profile.levelEstimate.updatedAt,
          profile.everydayLifeGoal,
          profile.motivation,
          profile.onboardingState,
          profile.createdAt,
          profile.updatedAt,
        );
      connection
        .prepare(
          `INSERT INTO learner_settings (
            learner_id, ui_locale, explanation_language, teaching_profile_id,
            correction_timing, correction_coverage, show_concise_explanation,
            show_natural_alternative, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          profile.learnerId,
          profile.uiLocale,
          profile.explanationLanguage,
          profile.defaultTeachingProfileId,
          profile.correctionPreferences.timing,
          profile.correctionPreferences.coverage,
          profile.correctionPreferences.showConciseExplanation ? 1 : 0,
          profile.correctionPreferences.showNaturalAlternative ? 1 : 0,
          profile.updatedAt,
        );
      insertOrderedStrings(connection, "learner_interests", profile.learnerId, profile.interests);
      insertOrderedStrings(
        connection,
        "learner_preferred_topics",
        profile.learnerId,
        profile.preferredTopics,
      );
      insertInsights(connection, profile.learnerId, "strength", profile.inferredStrengths);
      insertInsights(connection, profile.learnerId, "weakness", profile.inferredWeaknesses);
      writeModelPreferences(
        connection,
        profile.learnerId,
        settings.modelPreferences,
        profile.updatedAt,
      );
      connection
        .prepare(
          `INSERT INTO local_learning_scope
        (singleton, learner_id, course_id, target_language) VALUES (1, ?, ?, ?)`,
        )
        .run(profile.learnerId, supportedCourse.courseId, supportedCourse.targetLanguage);
      const stored = readLearnerSettingsFromConnection(connection, profile.learnerId);
      if (!stored) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      return stored;
    });
  }

  async updateLearnerSettings(updateValue: LearnerSettingsUpdate): Promise<LearnerSettingsRecord> {
    const update = learnerSettingsUpdateSchema.parse(updateValue);
    const profile = update.settings.profile;
    if (profile.updatedAt <= update.expectedUpdatedAt) {
      throw new Error("OD_LEARNER_SETTINGS_TIMESTAMP_NOT_ADVANCING");
    }
    return withLeasedTransaction(this.#database, (connection) => {
      assertLocalLearningScope(connection, update.settings.learningContext);
      if (profile.learnerId !== update.settings.learningContext.learnerId)
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      const result = connection
        .prepare(
          `UPDATE learner_profiles SET
            current_level = ?, target_level = ?, level_basis = ?,
            optional_diagnostic_completed_on = ?, level_updated_at = ?,
            everyday_life_goal = ?, motivation = ?,
            onboarding_state = ?, updated_at = ?
           WHERE learner_id = ? AND created_at = ? AND updated_at = ?`,
        )
        .run(
          profile.levelEstimate.currentLevel,
          profile.levelEstimate.targetLevel,
          profile.levelEstimate.basis,
          profile.levelEstimate.optionalDiagnosticCompletedOn ?? null,
          profile.levelEstimate.updatedAt,
          profile.everydayLifeGoal,
          profile.motivation,
          profile.onboardingState,
          profile.updatedAt,
          profile.learnerId,
          profile.createdAt,
          update.expectedUpdatedAt,
        );
      if (result.changes !== 1) throw new Error("OD_LEARNER_SETTINGS_CONFLICT");
      const settingsResult = connection
        .prepare(
          `UPDATE learner_settings SET ui_locale = ?, explanation_language = ?,
            teaching_profile_id = ?, correction_timing = ?, correction_coverage = ?,
            show_concise_explanation = ?, show_natural_alternative = ?, updated_at = ?
           WHERE learner_id = ?`,
        )
        .run(
          profile.uiLocale,
          profile.explanationLanguage,
          profile.defaultTeachingProfileId,
          profile.correctionPreferences.timing,
          profile.correctionPreferences.coverage,
          profile.correctionPreferences.showConciseExplanation ? 1 : 0,
          profile.correctionPreferences.showNaturalAlternative ? 1 : 0,
          profile.updatedAt,
          profile.learnerId,
        );
      if (settingsResult.changes !== 1) throw new Error("OD_LEARNER_SETTINGS_CONFLICT");
      for (const table of [
        "learner_interests",
        "learner_preferred_topics",
        "learner_profile_insights",
      ] as const) {
        connection.prepare(`DELETE FROM ${table} WHERE learner_id = ?`).run(profile.learnerId);
      }
      insertOrderedStrings(connection, "learner_interests", profile.learnerId, profile.interests);
      insertOrderedStrings(
        connection,
        "learner_preferred_topics",
        profile.learnerId,
        profile.preferredTopics,
      );
      insertInsights(connection, profile.learnerId, "strength", profile.inferredStrengths);
      insertInsights(connection, profile.learnerId, "weakness", profile.inferredWeaknesses);
      writeModelPreferences(
        connection,
        profile.learnerId,
        update.settings.modelPreferences,
        profile.updatedAt,
      );
      const stored = readLearnerSettingsFromConnection(connection, profile.learnerId);
      if (!stored) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      return stored;
    });
  }

  async addVocabularyCandidate(
    entryValue: VocabularyEntry,
    createdAtValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const entry = vocabularyEntrySchema.parse(entryValue);
    const createdAt = utcInstantSchema.parse(createdAtValue);
    if (entry.state.status !== "candidate") throw new Error("OD_VOCABULARY_CANDIDATE_REQUIRED");
    return withLeasedTransaction(this.#database, (connection) => {
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-candidate",
        idempotencyKey,
        request: entry,
        entityId: entry.vocabularyId,
        recordedAt: createdAt,
      });
      if (claim.replayed) return claim;
      connection
        .prepare(
          `INSERT INTO vocabulary_entries (
            vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.vocabularyId,
          entry.lemma,
          entry.meaning,
          stringifyBounded(entry.lexeme),
          stringifyBounded(entry.examples),
          stringifyBounded(entry.source),
          createdAt,
          createdAt,
        );
      return claim;
    });
  }

  async saveVocabularyLessonSet(
    requestValue: VocabularyLessonSetRequest,
    entriesValue: readonly VocabularyEntry[],
    setIdValue: string,
    createdAtValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const request = vocabularyLessonSetRequestSchema.parse(requestValue);
    const entries = z.array(vocabularyEntrySchema).max(50).parse(entriesValue);
    const setId = activityIdSchema.parse(setIdValue);
    const createdAt = utcInstantSchema.parse(createdAtValue);
    if (entries.length === 0) throw new Error("OD_VOCABULARY_LESSON_SET_EMPTY");
    if (
      new Set(entries.map(({ vocabularyId }) => vocabularyId)).size !== entries.length ||
      entries.some(({ state }) => state.status !== "candidate")
    ) {
      throw new Error("OD_VOCABULARY_LESSON_SET_ENTRIES_INVALID");
    }
    return withLeasedTransaction(this.#database, (connection) => {
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-candidate",
        idempotencyKey,
        request: { request, entries, setId },
        entityId: setId,
        recordedAt: createdAt,
      });
      if (claim.replayed) return claim;
      connection
        .prepare(
          `INSERT INTO vocabulary_lesson_sets (
            set_id, title, requested_from, natural_request, source_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          setId,
          request.title,
          request.requestedFrom,
          request.naturalRequest,
          stringifyBounded({
            goal: request.goal ?? null,
            topic: request.topic ?? null,
            curriculumTopicIds: request.curriculumTopicIds,
            mistakeCategories: request.mistakeCategories,
          }),
          createdAt,
        );
      const insertEntry = connection.prepare(
        `INSERT INTO vocabulary_entries (
          vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertItem = connection.prepare(
        `INSERT INTO vocabulary_lesson_set_items (set_id, position, vocabulary_id)
         VALUES (?, ?, ?)`,
      );
      for (const [position, entry] of entries.entries()) {
        const existing = connection
          .prepare(`SELECT status, lemma, meaning FROM vocabulary_entries WHERE vocabulary_id = ?`)
          .get(entry.vocabularyId) as Record<string, unknown> | undefined;
        if (existing === undefined) {
          insertEntry.run(
            entry.vocabularyId,
            entry.lemma,
            entry.meaning,
            stringifyBounded(entry.lexeme),
            stringifyBounded(entry.examples),
            stringifyBounded(entry.source),
            createdAt,
            createdAt,
          );
        } else if (
          existing["status"] !== "candidate" ||
          existing["lemma"] !== entry.lemma ||
          existing["meaning"] !== entry.meaning
        ) {
          throw new Error("OD_VOCABULARY_LESSON_SET_ENTRY_CONFLICT");
        }
        insertItem.run(setId, position, entry.vocabularyId);
      }
      return claim;
    });
  }

  async listVocabularyLessonSets(): Promise<readonly VocabularyLessonSetRecord[]> {
    return withLeasedConnection(this.#database, (connection) => {
      const sets = connection
        .prepare(
          `SELECT set_id, title, requested_from, natural_request, source_json, created_at
           FROM vocabulary_lesson_sets ORDER BY created_at DESC, set_id LIMIT 50`,
        )
        .all() as Record<string, unknown>[];
      return Object.freeze(
        sets.map((row) => {
          const items = connection
            .prepare(
              `SELECT position, vocabulary_id FROM vocabulary_lesson_set_items
               WHERE set_id = ? ORDER BY position`,
            )
            .all(z.string().parse(row["set_id"]))
            .map((item) => ({
              position: z.int().min(0).max(49).parse(item["position"]),
              vocabularyId: vocabularyIdSchema.parse(item["vocabulary_id"]),
            }));
          const source = strictBoundaryObject({
            goal: z.string().min(1).max(500).nullable(),
            topic: z.string().min(1).max(160).nullable(),
            curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
            mistakeCategories: z.array(z.string().min(1).max(120)).max(12),
          }).parse(parseJson(row["source_json"]));
          return vocabularyLessonSetRecordSchema.parse({
            setId: row["set_id"],
            title: row["title"],
            requestedFrom: row["requested_from"],
            naturalRequest: row["natural_request"],
            ...source,
            createdAt: row["created_at"],
            items,
          });
        }),
      );
    });
  }

  async reviewVocabularyCard(
    input: Readonly<{
      vocabularyId: string;
      grade: VocabularyReview["transition"]["result"]["grade"];
      retrieval: "recognition" | "recall" | "use";
      reviewedAt: string;
      reviewId: string;
      historyEntryId?: string;
      expectedRevision?: number;
      expectedUpdatedAt?: string;
      idempotencyKey: string;
    }>,
  ): Promise<IdempotentWriteResult & { dueOn: string }> {
    const vocabularyId = vocabularyIdSchema.parse(input.vocabularyId);
    const reviewedAt = utcInstantSchema.parse(input.reviewedAt);
    const reviewId = reviewIdSchema.parse(input.reviewId);
    const entry = await withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(`SELECT * FROM vocabulary_entries WHERE vocabulary_id = ? AND status = 'active'`)
        .get(vocabularyId) as Record<string, unknown> | undefined;
      if (!row) throw new Error("OD_VOCABULARY_REVIEW_STATE_CONFLICT");
      if (
        input.expectedRevision !== undefined &&
        (row["revision"] !== z.int().nonnegative().parse(input.expectedRevision) ||
          row["updated_at"] !== utcInstantSchema.parse(input.expectedUpdatedAt) ||
          String(row["due_on"]) > reviewedAt.slice(0, 10))
      )
        throw new Error("OD_VOCABULARY_REVIEW_STATE_CONFLICT");
      return vocabularyEntryFromRow(row);
    });
    if (entry.state.status !== "active") throw new Error("OD_VOCABULARY_NOT_ACTIVE");
    const schedules = await this.readVocabularyRetrievalSchedules(vocabularyId);
    const schedule = schedules.find((s) => s.retrieval === input.retrieval);
    if (!schedule || schedule.dueOn > reviewedAt.slice(0, 10))
      throw new Error("OD_VOCABULARY_REVIEW_STATE_CONFLICT");
    const review = scheduleVocabularyReview({
      vocabularyId,
      expectedActiveState: entry.state,
      reviewId,
      reviewedAt,
      grade: input.grade,
      retrievalStage: schedule.stage,
    });
    const saved = await this.applyVocabularyReview(
      review,
      input.idempotencyKey,
      input.retrieval,
      input.historyEntryId,
      input.expectedRevision,
    );
    return { ...saved, dueOn: review.transition.result.nextSchedule.dueOn };
  }

  async confirmVocabulary(
    vocabularyId: string,
    confirmedAtValue: string,
    dueOnValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    vocabularyId = vocabularyIdSchema.parse(vocabularyId);
    const confirmedAt = utcInstantSchema.parse(confirmedAtValue);
    const dueOn = calendarDateSchema.parse(dueOnValue);
    if (dueOn < confirmedAt.slice(0, 10)) {
      throw new Error("OD_VOCABULARY_CONFIRM_DATE_INVALID");
    }
    return withLeasedTransaction(this.#database, (connection) => {
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-confirmation",
        idempotencyKey,
        request: { vocabularyId, confirmedAt, dueOn },
        entityId: vocabularyId,
        recordedAt: confirmedAt,
      });
      if (claim.replayed) return claim;
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET status = 'active', confirmed_at = ?, due_on = ?, stage = 1,
            updated_at = ? WHERE vocabulary_id = ? AND status = 'candidate'`,
        )
        .run(confirmedAt, dueOn, confirmedAt, vocabularyId);
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_CONFIRM_STATE_CONFLICT");
      return claim;
    });
  }

  async readVocabularyLibrary(
    input: z.input<typeof vocabularyLibraryFilterSchema>,
    todayValue: string,
  ) {
    const filter = vocabularyLibraryFilterSchema.parse(input);
    const today = calendarDateSchema.parse(todayValue);
    return withLeasedConnection(this.#database, (connection) => {
      const { fold, normalize } = vocabularySearchPolicy(connection);
      const search = normalize(filter.search);
      const where = `(? = '' OR instr(${fold("lemma")}, ?) > 0 OR instr(${fold("meaning")}, ?) > 0)
        AND (? = 'all' OR status = ? OR (? = 'due' AND status = 'active' AND due_on <= ?))`;
      const parameters = [
        search,
        search,
        search,
        filter.filter,
        filter.filter,
        filter.filter,
        today,
      ];
      const total = z
        .int()
        .nonnegative()
        .parse(
          connection
            .prepare(`SELECT COUNT(*) AS count FROM vocabulary_entries WHERE ${where}`)
            .get(...parameters)?.["count"],
        );
      const page = Math.min(filter.page, Math.max(0, Math.ceil(total / 30) - 1));
      const order =
        filter.sort === "due"
          ? "due_on IS NULL, due_on, lemma COLLATE NOCASE, vocabulary_id"
          : "lemma COLLATE NOCASE, vocabulary_id";
      const entries = connection
        .prepare(
          `SELECT vocabulary_id, lemma, meaning, status, due_on, revision, updated_at
         FROM vocabulary_entries WHERE ${where} ORDER BY ${order} LIMIT 30 OFFSET ?`,
        )
        .all(...parameters, page * 30)
        .map((row) =>
          vocabularySummarySchema.parse({
            vocabularyId: row["vocabulary_id"],
            lemma: row["lemma"],
            meaning: row["meaning"],
            status: row["status"],
            dueOn: row["due_on"],
            revision: row["revision"],
            updatedAt: row["updated_at"],
          }),
        );
      const counts = vocabularyCountsSchema.parse(
        connection
          .prepare(
            `SELECT COUNT(*) AS "all",
        COUNT(CASE WHEN status = 'candidate' THEN 1 END) AS candidate,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS active,
        COUNT(CASE WHEN status = 'suspended' THEN 1 END) AS suspended,
        COUNT(CASE WHEN status = 'active' AND due_on <= ? THEN 1 END) AS due
        FROM vocabulary_entries`,
          )
          .get(today),
      );
      return { entries, total, page, counts };
    });
  }

  async readVocabularyRecord(id: string): Promise<VocabularyRecord | undefined> {
    const vocabularyId = vocabularyIdSchema.parse(id);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare("SELECT * FROM vocabulary_entries WHERE vocabulary_id = ?")
        .get(vocabularyId);
      return row ? vocabularyRecordFromRow(row) : undefined;
    });
  }

  async readVocabularyRetrievalSchedules(id: string) {
    return withLeasedConnection(this.#database, (connection) => {
      const entry = connection
        .prepare(
          "SELECT confirmed_at FROM vocabulary_entries WHERE vocabulary_id = ? AND status = 'active'",
        )
        .get(id) as { confirmed_at: string } | undefined;
      if (!entry) throw new Error("OD_VOCABULARY_NOT_ACTIVE");
      return (["recognition", "recall", "use"] as const).map((retrieval) => {
        const row = connection
          .prepare(
            "SELECT next_due_on, next_stage FROM vocabulary_reviews WHERE vocabulary_id = ? AND retrieval = ? ORDER BY expected_revision DESC LIMIT 1",
          )
          .get(id, retrieval) as { next_due_on: string; next_stage: number } | undefined;
        return {
          retrieval,
          dueOn: row?.next_due_on ?? entry.confirmed_at.slice(0, 10),
          stage: z
            .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
            .parse(row?.next_stage ?? 1),
        };
      });
    });
  }

  async readVocabularyReviewQueue(todayValue: string): Promise<readonly VocabularyRecord[]> {
    const today = calendarDateSchema.parse(todayValue);
    return withLeasedConnection(this.#database, (connection) =>
      connection
        .prepare(
          "SELECT * FROM vocabulary_entries WHERE status = 'active' AND due_on <= ? ORDER BY due_on, vocabulary_id LIMIT 20",
        )
        .all(today)
        .map(vocabularyRecordFromRow),
    );
  }

  async mutateVocabularyBulk(
    input: z.infer<typeof vocabularyBulkRequestSchema>,
    atValue: string,
  ): Promise<void> {
    const { action, entries, rootGeneration } = vocabularyBulkRequestSchema.parse(input);
    const at = utcInstantSchema.parse(atValue);
    if (rootGeneration !== this.#database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
    await withLeasedTransaction(this.#database, (connection) => {
      const status =
        action === "confirm" ? "candidate" : action === "suspend" ? "active" : "suspended";
      const update =
        action === "confirm"
          ? "status = 'active', confirmed_at = ?, due_on = substr(?, 1, 10), stage = 1, revision = revision + 1"
          : action === "suspend"
            ? "status = 'suspended', suspended_at = ?, suspension_reason = 'learner-paused', revision = revision + 1"
            : "status = 'active', suspended_at = NULL, suspension_reason = NULL, revision = revision + 1";
      const statement = connection.prepare(`UPDATE vocabulary_entries SET ${update}, updated_at = ?
        WHERE vocabulary_id = ? AND status = ? AND revision = ? AND updated_at = ? AND updated_at < ?`);
      for (const entry of entries) {
        const dates = action === "confirm" ? [at, at] : action === "suspend" ? [at] : [];
        const result = statement.run(
          ...dates,
          at,
          entry.vocabularyId,
          status,
          entry.expectedRevision,
          entry.expectedUpdatedAt,
          at,
        );
        if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
      }
    });
  }

  async listVocabularyRecords(
    status?: "candidate" | "active" | "suspended",
  ): Promise<readonly VocabularyRecord[]> {
    return withLeasedConnection(this.#database, (connection) => {
      const rows = status
        ? connection
            .prepare(
              `SELECT * FROM vocabulary_entries WHERE status = ? ORDER BY lemma, vocabulary_id`,
            )
            .all(status)
        : connection
            .prepare(`SELECT * FROM vocabulary_entries ORDER BY lemma, vocabulary_id`)
            .all();
      return rows.map((row) => {
        const record = row as Record<string, unknown>;
        return Object.freeze({
          entry: vocabularyEntryFromRow(record),
          revision: z.int().nonnegative().parse(record["revision"]),
          updatedAt: utcInstantSchema.parse(record["updated_at"]),
        });
      });
    });
  }

  async editVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      expectedUpdatedAt?: string;
      lemma: string;
      meaning: string;
      example: { german: string; meaning: string };
      updatedAt: string;
    }>,
  ): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(input.vocabularyId);
    const updatedAt = utcInstantSchema.parse(input.updatedAt);
    const lemma = z.string().min(1).max(160).regex(/\S/u).parse(input.lemma);
    const meaning = z.string().min(1).max(500).regex(/\S/u).parse(input.meaning);
    const examples = z.array(vocabularyExampleSchema).length(1).parse([input.example]);
    await withLeasedTransaction(this.#database, (connection) => {
      const existing = connection
        .prepare("SELECT examples_json FROM vocabulary_entries WHERE vocabulary_id = ?")
        .get(vocabularyId);
      if (!existing) throw new Error("OD_VOCABULARY_NOT_FOUND");
      const savedExamples = z
        .array(vocabularyExampleSchema)
        .min(1)
        .max(12)
        .parse(parseJson(existing["examples_json"]));
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET lemma = ?, meaning = ?, examples_json = ?,
            revision = CASE WHEN status = 'candidate' THEN 0 ELSE revision + 1 END, updated_at = ?
           WHERE vocabulary_id = ? AND revision = ? AND updated_at < ?
             AND (? IS NULL OR updated_at = ?)`,
        )
        .run(
          lemma,
          meaning,
          stringifyBounded([...examples, ...savedExamples.slice(1)]),
          updatedAt,
          vocabularyId,
          z.int().nonnegative().parse(input.expectedRevision),
          updatedAt,
          input.expectedUpdatedAt ? utcInstantSchema.parse(input.expectedUpdatedAt) : null,
          input.expectedUpdatedAt ?? null,
        );
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
    });
  }

  async suspendVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      suspendedAt: string;
      reason: "learner-paused" | "duplicate" | "not-useful" | "other";
    }>,
  ): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(input.vocabularyId);
    const suspendedAt = utcInstantSchema.parse(input.suspendedAt);
    await withLeasedTransaction(this.#database, (connection) => {
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET status = 'suspended', suspended_at = ?,
            suspension_reason = ?, revision = revision + 1, updated_at = ?
           WHERE vocabulary_id = ? AND status = 'active' AND revision = ?`,
        )
        .run(
          suspendedAt,
          input.reason,
          suspendedAt,
          vocabularyId,
          z.int().nonnegative().parse(input.expectedRevision),
        );
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
    });
  }

  async resumeVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      resumedAt: string;
    }>,
  ): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(input.vocabularyId);
    const resumedAt = utcInstantSchema.parse(input.resumedAt);
    await withLeasedTransaction(this.#database, (connection) => {
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET status = 'active', suspended_at = NULL,
            suspension_reason = NULL, revision = revision + 1, updated_at = ?
           WHERE vocabulary_id = ? AND status = 'suspended' AND revision = ?`,
        )
        .run(resumedAt, vocabularyId, z.int().nonnegative().parse(input.expectedRevision));
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
    });
  }

  async deleteVocabulary(vocabularyIdValue: string, deletedAtValue: string): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(vocabularyIdValue);
    const deletedAt = utcInstantSchema.parse(deletedAtValue);
    await withLeasedTransaction(this.#database, (connection) => {
      connection
        .prepare(`INSERT INTO vocabulary_deletions (vocabulary_id, deleted_at) VALUES (?, ?)`)
        .run(vocabularyId, deletedAt);
      const result = connection
        .prepare(`DELETE FROM vocabulary_entries WHERE vocabulary_id = ?`)
        .run(vocabularyId);
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_NOT_FOUND");
    });
  }

  async deleteAttempt(
    attemptIdValue: string,
    deletedAtValue: string,
  ): Promise<IdempotentWriteResult> {
    const attemptId = attemptIdSchema.parse(attemptIdValue);
    const deletedAt = utcInstantSchema.parse(deletedAtValue);
    return withLeasedTransaction(this.#database, (connection) => {
      const prior = connection
        .prepare(`SELECT deleted_at FROM attempt_deletions WHERE attempt_id = ?`)
        .get(attemptId);
      if (prior !== undefined) return Object.freeze({ replayed: true });
      connection
        .prepare(`INSERT INTO attempt_deletions (attempt_id, deleted_at) VALUES (?, ?) `)
        .run(attemptId, deletedAt);
      const result = connection.prepare(`DELETE FROM attempts WHERE attempt_id = ?`).run(attemptId);
      if (result.changes !== 1) throw new Error("OD_ATTEMPT_NOT_FOUND");
      return Object.freeze({ replayed: false });
    });
  }

  async amendMistakeClassification(
    input: Readonly<{
      amendmentId: string;
      mistakeId: string;
      effectiveCategory: MistakeCategory;
      note?: string;
      amendedAt: string;
    }>,
  ): Promise<void> {
    if (!/^amendment_[0-9a-z]{16,64}$/u.test(input.amendmentId)) {
      throw new Error("OD_MISTAKE_AMENDMENT_ID_INVALID");
    }
    const mistakeId = mistakeIdSchema.parse(input.mistakeId);
    const amendedAt = utcInstantSchema.parse(input.amendedAt);
    const parsedCategory = mistakeCategorySchema.safeParse(input.effectiveCategory);
    if (!parsedCategory.success) throw new Error("OD_MISTAKE_CATEGORY_INVALID");
    const nextCategory = stringifyBounded(parsedCategory.data, 16_384);
    if (input.note !== undefined && (input.note.trim().length === 0 || input.note.length > 500)) {
      throw new Error("OD_MISTAKE_AMENDMENT_NOTE_INVALID");
    }
    await withLeasedTransaction(this.#database, (connection) => {
      const current = connection
        .prepare(`SELECT effective_category_json FROM mistakes WHERE mistake_id = ?`)
        .get(mistakeId) as { effective_category_json: string } | undefined;
      if (current === undefined) throw new Error("OD_MISTAKE_NOT_FOUND");
      const currentCategory = mistakeCategorySchema.safeParse(
        parseJson(current.effective_category_json),
      );
      if (!currentCategory.success) throw new Error("OD_MISTAKE_CATEGORY_INVALID");
      if (stringifyBounded(currentCategory.data, 16_384) === nextCategory) {
        throw new Error("OD_MISTAKE_AMENDMENT_NO_CHANGE");
      }
      connection
        .prepare(
          `INSERT INTO mistake_amendments (
            amendment_id, mistake_id, previous_category_json, amended_category_json, note, amended_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.amendmentId,
          mistakeId,
          current.effective_category_json,
          nextCategory,
          input.note ?? null,
          amendedAt,
        );
      connection
        .prepare(
          `UPDATE mistakes SET effective_category_json = ?, classification_source = 'learner-amended',
            learner_amended_at = ?, learner_amendment_note = ? WHERE mistake_id = ?`,
        )
        .run(nextCategory, amendedAt, input.note ?? null, mistakeId);
    });
  }

  async deleteProfileInsight(
    learnerIdValue: string,
    insightGroup: "strength" | "weakness",
    position: number,
  ): Promise<void> {
    const learnerId = learnerIdSchema.parse(learnerIdValue);
    if (!Number.isInteger(position) || position < 0 || position > 49) {
      throw new Error("OD_PROFILE_INSIGHT_POSITION_INVALID");
    }
    await withLeasedTransaction(this.#database, (connection) => {
      const result = connection
        .prepare(
          `DELETE FROM learner_profile_insights
           WHERE learner_id = ? AND insight_group = ? AND position = ?`,
        )
        .run(learnerId, insightGroup, position);
      if (result.changes !== 1) throw new Error("OD_PROFILE_INSIGHT_NOT_FOUND");
    });
  }

  async applyVocabularyReview(
    reviewValue: VocabularyReview,
    idempotencyKey: string,
    retrieval: "recognition" | "recall" | "use",
    historyEntryIdValue?: string,
    expectedRevision?: number,
  ): Promise<IdempotentWriteResult> {
    const review = vocabularyReviewSchema.parse(reviewValue);
    return withLeasedTransaction(this.#database, (connection) => {
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-review",
        idempotencyKey,
        request: { review, retrieval },
        entityId: review.transition.result.reviewId,
        recordedAt: review.transition.result.reviewedAt,
      });
      if (claim.replayed) return claim;
      const expected = review.transition.expectedActiveState;
      const row = connection
        .prepare(
          `SELECT revision, confirmed_at, due_on, stage, last_review_id
           FROM vocabulary_entries WHERE vocabulary_id = ? AND status = 'active'`,
        )
        .get(review.vocabularyId) as Record<string, unknown> | undefined;
      const expectedLastReviewId =
        expected.schedule.status === "reviewed" ? expected.schedule.lastReview.reviewId : null;
      if (
        row === undefined ||
        (expectedRevision !== undefined && row["revision"] !== expectedRevision) ||
        row["confirmed_at"] !== expected.confirmedAt ||
        row["due_on"] !== expected.schedule.dueOn ||
        row["stage"] !== expected.schedule.stage ||
        row["last_review_id"] !== expectedLastReviewId ||
        !Number.isSafeInteger(row["revision"])
      ) {
        throw new Error("OD_VOCABULARY_REVIEW_STATE_CONFLICT");
      }
      const revision = row["revision"] as number;
      const result = review.transition.result;
      connection
        .prepare(
          `INSERT INTO vocabulary_reviews (
            review_id, vocabulary_id, expected_revision, reviewed_at, grade, next_due_on, next_stage, retrieval
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          result.reviewId,
          review.vocabularyId,
          revision,
          result.reviewedAt,
          result.grade,
          result.nextSchedule.dueOn,
          result.nextSchedule.stage,
          retrieval,
        );
      if (historyEntryIdValue !== undefined) {
        const historyEntryId = historyEntryIdSchema.parse(historyEntryIdValue);
        const entryRow = connection
          .prepare(`SELECT lemma FROM vocabulary_entries WHERE vocabulary_id = ?`)
          .get(review.vocabularyId) as { lemma: string } | undefined;
        if (!entryRow) throw new Error("OD_VOCABULARY_NOT_FOUND");
        connection
          .prepare(
            `INSERT INTO history_entries (
              history_entry_id, entity_kind, entity_id, skill, activity_type, title,
              occurred_at, reconstruction_json, root_generation
            ) VALUES (?, 'vocabulary-review', ?, 'reading', 'vocabulary-review', ?, ?, ?, ?)`,
          )
          .run(
            historyEntryId,
            result.reviewId,
            entryRow.lemma,
            result.reviewedAt,
            stringifyBounded({
              vocabularyId: review.vocabularyId,
              grade: result.grade,
              nextDueOn: result.nextSchedule.dueOn,
              nextStage: result.nextSchedule.stage,
            }),
            this.#database.rootGeneration,
          );
      }
      return claim;
    });
  }

  async listDueVocabulary(onDateValue: string): Promise<readonly VocabularyEntry[]> {
    const onDate = calendarDateSchema.parse(onDateValue);
    return withLeasedConnection(this.#database, (connection) =>
      connection
        .prepare(
          `SELECT * FROM vocabulary_entries
           WHERE status = 'active' AND due_on <= ? ORDER BY due_on, vocabulary_id LIMIT 500`,
        )
        .all(onDate)
        .map((row) => vocabularyEntryFromRow(row as Record<string, unknown>)),
    );
  }

  async createVocabularyReviewSession(
    onDateValue: string,
    sessionIdValue: string,
    maximumItems = 20,
  ): Promise<VocabularyReviewSession> {
    const onDate = calendarDateSchema.parse(onDateValue);
    const sessionId = sessionIdSchema.parse(sessionIdValue);
    if (!Number.isInteger(maximumItems) || maximumItems < 1 || maximumItems > 50) {
      throw new Error("OD_VOCABULARY_SESSION_SIZE_INVALID");
    }
    const entries = await withLeasedConnection(this.#database, (connection) =>
      connection
        .prepare(
          `SELECT * FROM vocabulary_entries
           WHERE status = 'active' AND due_on <= ? ORDER BY due_on, vocabulary_id LIMIT ?`,
        )
        .all(onDate, maximumItems)
        .map((row) => vocabularyEntryFromRow(row as Record<string, unknown>)),
    );
    return vocabularyReviewSessionSchema.parse({
      sessionId,
      onDate,
      items: entries.map((entry, index) => {
        if (entry.state.status !== "active") throw new Error("OD_VOCABULARY_SESSION_STATE_INVALID");
        const example = entry.examples[0];
        const recognition = index % 2 === 0;
        return {
          vocabularyId: entry.vocabularyId,
          direction: recognition ? "recognition" : "production",
          cue: recognition ? entry.lemma : entry.meaning,
          example,
          sourceContext: entry.source.context,
          expectedAnswer: recognition ? entry.meaning : entry.lemma,
          dueOn: entry.state.schedule.dueOn,
        };
      }),
    });
  }

  async readDevelopmentNotice(): Promise<boolean> {
    return withLeasedConnection(this.#database, (connection) =>
      Boolean(connection.prepare("SELECT 1 FROM development_notices WHERE dismissed = 0").get()),
    );
  }

  async dismissDevelopmentNotice(): Promise<void> {
    await withLeasedTransaction(this.#database, (connection) => {
      connection.prepare("UPDATE development_notices SET dismissed = 1 WHERE dismissed = 0").run();
    });
  }

  async readDashboardSnapshot(onDateValue: string): Promise<DashboardSnapshot> {
    const onDate = calendarDateSchema.parse(onDateValue);
    return withLeasedConnection(this.#database, (connection) => {
      const preparedActivities = connection
        .prepare(
          `SELECT p.activity_id, p.activity_type, p.title, p.origin_surface, p.prepared_at,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM vocabulary_entries v
                 WHERE json_extract(v.source_json, '$.kind') = 'activity'
                   AND json_extract(v.source_json, '$.activityId') = p.activity_id
                   AND v.status <> 'candidate'
               ) THEN 'retained-data'
               WHEN EXISTS (
                 SELECT 1 FROM exercises e WHERE e.activity_id = p.activity_id
               ) THEN 'cascade'
               ELSE 'available'
             END AS deletion_status
           FROM prepared_activities p
           WHERE p.status = 'prepared'
           ORDER BY prepared_at DESC, activity_id
           LIMIT 20`,
        )
        .all()
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            activityId: activityIdSchema.parse(row["activity_id"]),
            activityType: preparedActivitySchema.shape.activityType.parse(row["activity_type"]),
            title: preparedActivitySchema.shape.title.parse(row["title"]),
            originSurface: preparedActivitySchema.shape.originSurface.parse(row["origin_surface"]),
            preparedAt: utcInstantSchema.parse(row["prepared_at"]),
            deletionStatus: z
              .enum(["available", "cascade", "retained-data"])
              .parse(row["deletion_status"]),
          });
        });

      const dueVocabulary = connection
        .prepare(
          `SELECT vocabulary_id, lemma, meaning, due_on, stage
           FROM vocabulary_entries
           WHERE status = 'active' AND due_on <= ?
           ORDER BY due_on, vocabulary_id
           LIMIT 20`,
        )
        .all(onDate)
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            vocabularyId: vocabularyIdSchema.parse(row["vocabulary_id"]),
            lemma: z.string().min(1).max(160).parse(row["lemma"]),
            meaning: z.string().min(1).max(500).parse(row["meaning"]),
            dueOn: calendarDateSchema.parse(row["due_on"]),
            stage: z.int().min(1).max(12).parse(row["stage"]),
          });
        });

      const recentCorrections = connection
        .prepare(
          `SELECT c.correction_id, c.created_at,
            SUM(CASE WHEN cc.kind = 'unchanged' THEN 0 ELSE 1 END) AS changed_segment_count
           FROM corrections c
           JOIN correction_changes cc ON cc.correction_id = c.correction_id
           WHERE c.state = 'final'
           GROUP BY c.correction_id, c.created_at
           ORDER BY c.created_at DESC, c.correction_id
           LIMIT 10`,
        )
        .all()
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            correctionId: correctionIdSchema.parse(row["correction_id"]),
            createdAt: utcInstantSchema.parse(row["created_at"]),
            changedSegmentCount: z.int().min(0).max(500).parse(row["changed_segment_count"]),
          });
        });

      const recurringMistakes = connection
        .prepare(
          `SELECT m.mistake_id, m.effective_category_json, COUNT(*) AS occurrence_count,
            MAX(o.observed_on) AS last_observed_on
           FROM mistakes m
           JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
           WHERE m.disposition = 'active'
           GROUP BY m.mistake_id, m.effective_category_json
           HAVING COUNT(*) >= 2
           ORDER BY last_observed_on DESC, m.mistake_id
           LIMIT 10`,
        )
        .all()
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            mistakeId: mistakeIdSchema.parse(row["mistake_id"]),
            category: mistakeCategorySchema.parse(parseJson(row["effective_category_json"])),
            occurrenceCount: z.int().min(2).max(100).parse(row["occurrence_count"]),
            lastObservedOn: calendarDateSchema.parse(row["last_observed_on"]),
          });
        });

      return Object.freeze({
        rootGeneration: this.#database.rootGeneration,
        preparedActivities: Object.freeze(preparedActivities),
        dueVocabulary: Object.freeze(dueVocabulary),
        recentCorrections: Object.freeze(recentCorrections),
        recurringMistakes: Object.freeze(recurringMistakes),
      });
    });
  }

  async readSuggestionLearningContext(contextValue: unknown) {
    const context = practiceSuggestionContextSchema.parse(contextValue);
    return withLeasedConnection(this.#database, (connection) => {
      const mistakes = connection
        .prepare(
          `SELECT m.mistake_id, m.effective_category_json, COUNT(*) AS occurrence_count,
          MAX(o.observed_on) AS last_observed_on
         FROM mistakes m JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
         WHERE m.disposition = 'active'
           AND m.mistake_id IN (SELECT value FROM json_each(?))
         GROUP BY m.mistake_id ORDER BY last_observed_on DESC, m.mistake_id LIMIT 12`,
        )
        .all(JSON.stringify(context.mistakeIds))
        .map((raw) => {
          const row = raw as Record<string, unknown>;
          const category = mistakeCategorySchema.parse(parseJson(row["effective_category_json"]));
          return {
            mistakeId: mistakeIdSchema.parse(row["mistake_id"]),
            summary: {
              kind: category.kind,
              categoryKey: category.categoryKey,
              ...(category.kind === "vocabulary" ? { lemma: category.lemma } : {}),
              occurrenceCount: z.int().min(1).max(100).parse(row["occurrence_count"]),
              lastObservedOn: calendarDateSchema.parse(row["last_observed_on"]),
            },
          };
        });
      const vocabulary = connection
        .prepare(
          `SELECT * FROM vocabulary_entries WHERE status = 'active'
         AND vocabulary_id IN (SELECT value FROM json_each(?))
         ORDER BY due_on, vocabulary_id LIMIT 24`,
        )
        .all(JSON.stringify(context.vocabularyIds))
        .map((row) => vocabularyEntryFromRow(row as Record<string, unknown>));
      return {
        relevantMistakes: mistakes
          .filter(({ summary }) => summary.occurrenceCount >= 2)
          .slice(0, 6)
          .map(({ summary }) => summary),
        relevantMistakeIds: mistakes.map(({ mistakeId }) => mistakeId),
        relevantVocabularyIds: vocabulary.map(({ vocabularyId }) => vocabularyId),
        vocabularyToReview: vocabulary.slice(0, 12).map((entry) => ({
          vocabularyId: entry.vocabularyId,
          lemma: entry.lemma,
          meaning: entry.meaning,
          ...(entry.examples[0] ? { example: entry.examples[0].german } : {}),
        })),
      };
    });
  }

  async readCorrectionMistakeSample(maximumValue = 6): Promise<readonly CorrectionMistakeSample[]> {
    const maximum = z.int().min(0).max(6).parse(maximumValue);
    if (maximum === 0) return Object.freeze([]);
    return withLeasedConnection(this.#database, (connection) =>
      Object.freeze(
        connection
          .prepare(
            `SELECT m.effective_category_json, COUNT(*) AS occurrence_count,
              MAX(o.observed_on) AS last_observed_on
             FROM mistakes m
             JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
             WHERE m.disposition = 'active'
             GROUP BY m.mistake_id, m.effective_category_json
             HAVING COUNT(*) >= 2
             ORDER BY last_observed_on DESC, m.mistake_id
             LIMIT ?`,
          )
          .all(maximum)
          .map((rawRow) => {
            const row = rawRow as Record<string, unknown>;
            const category = mistakeCategorySchema.parse(parseJson(row["effective_category_json"]));
            const shared = {
              kind: category.kind,
              categoryKey: category.categoryKey,
              occurrenceCount: z.int().min(2).max(100).parse(row["occurrence_count"]),
              lastObservedOn: calendarDateSchema.parse(row["last_observed_on"]),
            } as const;
            return Object.freeze(
              category.kind === "vocabulary"
                ? { ...shared, kind: "vocabulary" as const, lemma: category.lemma }
                : { ...shared, kind: "grammar" as const },
            );
          }),
      ),
    );
  }

  async listMistakePatterns(
    filterValue: z.input<typeof mistakePatternFilterSchema> = {},
  ): Promise<readonly MistakePatternRecord[]> {
    const filter = mistakePatternFilterSchema.parse(filterValue);
    if (filter.fromDate && filter.toDate && filter.fromDate > filter.toDate) {
      throw new Error("OD_HISTORY_DATE_RANGE_INVALID");
    }
    return withLeasedConnection(this.#database, (connection) => {
      const clauses = ["m.disposition = 'active'"];
      const parameters: string[] = [];
      if (filter.fromDate) {
        clauses.push("o.observed_on >= ?");
        parameters.push(filter.fromDate);
      }
      if (filter.toDate) {
        clauses.push("o.observed_on <= ?");
        parameters.push(filter.toDate);
      }
      if (filter.curriculumTopicId) {
        clauses.push(
          "EXISTS (SELECT 1 FROM json_each(m.effective_category_json, '$.curriculumTopicIds') WHERE value = ?)",
        );
        parameters.push(filter.curriculumTopicId);
      }
      if (filter.mistakeCategory) {
        clauses.push("json_extract(m.effective_category_json, '$.categoryKey') = ?");
        parameters.push(filter.mistakeCategory);
      }
      const rows = connection
        .prepare(
          `WITH ranked AS (
             SELECT m.mistake_id, m.effective_category_json, m.classification_source,
               o.observed_on, o.before_context, o.evidence_text, o.after_context, o.explanation,
               (SELECT l.activity_id FROM targeted_practice_links l
                 WHERE l.category_json = m.effective_category_json
                 ORDER BY l.created_at DESC, l.activity_id DESC LIMIT 1) AS targeted_activity_id,
               (SELECT l.created_at FROM targeted_practice_links l
                 WHERE l.category_json = m.effective_category_json
                 ORDER BY l.created_at DESC, l.activity_id DESC LIMIT 1) AS targeted_activity_created_at,
               COUNT(*) OVER (PARTITION BY m.effective_category_json) AS occurrence_count,
               MAX(o.observed_on) OVER (PARTITION BY m.effective_category_json) AS last_observed_on,
               ROW_NUMBER() OVER (
                 PARTITION BY m.effective_category_json
                 ORDER BY o.observed_on DESC, m.mistake_id, o.correction_id,
                   o.alignment_segment_position
               ) AS occurrence_position
             FROM mistakes m
             JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
             WHERE ${clauses.join(" AND ")}
           ), selected_categories AS (
             SELECT effective_category_json, last_observed_on
             FROM ranked
             GROUP BY effective_category_json, last_observed_on
             ORDER BY last_observed_on DESC, effective_category_json
             LIMIT ?
           )
           SELECT r.* FROM ranked r
           JOIN selected_categories s USING (effective_category_json, last_observed_on)
           WHERE r.occurrence_position <= 100
           ORDER BY r.last_observed_on DESC, r.effective_category_json,
             r.observed_on DESC, r.mistake_id, r.occurrence_position`,
        )
        .all(...parameters, filter.maximum) as Record<string, unknown>[];
      const groups = new Map<
        string,
        {
          category: MistakeCategory;
          occurrenceCount: number;
          occurrences: Array<MistakePatternRecord["occurrences"][number]>;
          sources: Set<"inferred" | "learner-amended">;
          targetedPractice: MistakePatternRecord["targetedPractice"];
        }
      >();
      for (const row of rows) {
        const categoryJson = z.string().parse(row["effective_category_json"]);
        const classificationSource = z
          .enum(["inferred", "learner-amended"])
          .parse(row["classification_source"]);
        const group = groups.get(categoryJson) ?? {
          category: mistakeCategorySchema.parse(parseJson(categoryJson)),
          occurrenceCount: z.int().min(1).parse(row["occurrence_count"]),
          occurrences: [],
          sources: new Set<"inferred" | "learner-amended">(),
          targetedPractice:
            row["targeted_activity_id"] === null
              ? Object.freeze({ status: "not-created" as const })
              : Object.freeze({
                  status: "created" as const,
                  activityId: activityIdSchema.parse(row["targeted_activity_id"]),
                  createdAt: utcInstantSchema.parse(row["targeted_activity_created_at"]),
                }),
        };
        group.sources.add(classificationSource);
        group.occurrences.push(
          Object.freeze({
            mistakeId: mistakeIdSchema.parse(row["mistake_id"]),
            observedOn: calendarDateSchema.parse(row["observed_on"]),
            evidence: Object.freeze({
              beforeContext: z.string().max(500).parse(row["before_context"]),
              evidenceText: z.string().min(1).max(1_000).parse(row["evidence_text"]),
              afterContext: z.string().max(500).parse(row["after_context"]),
            }),
            explanation: z.string().min(1).max(800).parse(row["explanation"]),
            classificationSource,
          }),
        );
        groups.set(categoryJson, group);
      }
      return Object.freeze(
        [...groups.values()].map((group) => {
          const classificationSource: MistakePatternRecord["classificationSource"] =
            group.sources.size === 2
              ? "mixed"
              : (group.sources.values().next().value ?? "inferred");
          return Object.freeze({
            category: group.category,
            status: group.occurrenceCount >= 2 ? "recurring" : "single-occurrence",
            occurrenceCount: group.occurrenceCount,
            classificationSource,
            occurrences: Object.freeze(group.occurrences),
            targetedPractice: group.targetedPractice,
          });
        }),
      );
    });
  }

  async saveVoiceSummary(
    summaryValue: VoiceSummary,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const summary = voiceSummarySchema.parse(summaryValue);
    return withLeasedTransaction(this.#database, (connection) => {
      const linked = summary.activity
        ? (connection
            .prepare("SELECT context_json FROM prepared_activities WHERE activity_id = ?")
            .get(summary.activity.activityId) as { context_json: string } | undefined)
        : undefined;
      const linkedContext = linked
        ? parseScopedActivityContext(connection, parseJson(linked.context_json))
        : undefined;
      if (summary.activity) {
        if (!linkedContext?.learningPath || !linkedContext.courseTeaching)
          throw new Error("OD_COURSE_EVIDENCE_INVALID");
        validateCourseEvidence(linkedContext.courseTeaching, summary.activity.objectiveResults);
      }
      const skill = linkedContext?.voiceContext?.kind ?? "speaking";
      const claim = claimIdempotentWrite(connection, {
        operation: "voice-summary",
        idempotencyKey,
        request: summary,
        entityId: summary.voiceSessionId,
        recordedAt: summary.summarizedAt,
      });
      if (claim.replayed) return claim;
      connection
        .prepare(
          `INSERT INTO voice_summaries (
            voice_session_id, summarized_at, scenario_title, target_level, summary_json
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          summary.voiceSessionId,
          summary.summarizedAt,
          summary.scenario.title,
          summary.scenario.targetLevel,
          stringifyBounded(summary),
        );
      const historyEntryId = historyEntryIdSchema.parse(
        `history-entry_${randomUUID().replaceAll("-", "")}`,
      );
      connection
        .prepare(
          `INSERT INTO history_entries (
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, 'voice-summary', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          historyEntryId,
          summary.voiceSessionId,
          skill,
          skill === "listening" ? "codex-listening" : "voice-speaking",
          summary.scenario.title,
          summary.summarizedAt,
          stringifyBounded(summary),
          this.#database.rootGeneration,
        );
      if (summary.activity) {
        saveCourseEvidence(connection, {
          activityId: summary.activity.activityId,
          historyEntryId,
          occurredAt: summary.summarizedAt,
          evidence: summary.activity.objectiveResults,
          ...(summary.activity.facts ? { facts: summary.activity.facts } : {}),
        });
        if (summary.activity.outcome === "completed")
          connection
            .prepare(
              "UPDATE prepared_activities SET status = 'completed', completed_at = ? WHERE activity_id = ?",
            )
            .run(summary.summarizedAt, summary.activity.activityId);
      }
      return claim;
    });
  }

  async savePlacementResult(
    resultValue: PlacementResult,
    idempotencyKeyValue: string,
  ): Promise<Readonly<{ historyEntryId: string; replayed: boolean }>> {
    const result = placementResultSchema.parse(resultValue);
    const idempotencyKey = z.string().min(8).max(128).parse(idempotencyKeyValue);
    const digest = createHash("sha256").update(idempotencyKey, "utf8").digest("hex").slice(0, 32);
    const entityId = `placement_${digest}`;
    const historyEntryId = historyEntryIdSchema.parse(`history-entry_${digest}`);
    return withLeasedTransaction(this.#database, (connection) => {
      const existing = connection
        .prepare(
          `SELECT reconstruction_json FROM history_entries
           WHERE entity_kind = 'placement' AND entity_id = ?`,
        )
        .get(entityId) as { reconstruction_json: string } | undefined;
      if (existing) {
        if (
          JSON.stringify(placementResultSchema.parse(parseJson(existing.reconstruction_json))) !==
          JSON.stringify(result)
        ) {
          throw new Error("OD_PLACEMENT_RESULT_CONFLICT");
        }
        return { historyEntryId, replayed: true };
      }
      connection
        .prepare(
          `INSERT INTO history_entries (
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, 'placement', ?, 'writing', 'placement', ?, ?, ?, ?)`,
        )
        .run(
          historyEntryId,
          entityId,
          "Optional diagnostic",
          `${result.completedOn}T12:00:00.000Z`,
          stringifyBounded(result),
          this.#database.rootGeneration,
        );
      return { historyEntryId, replayed: false };
    });
  }

  async savePreparedActivity(
    activityValue: PreparedActivityRecord,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const activity = preparedActivitySchema.parse(activityValue);
    return withLeasedTransaction(this.#database, (connection) => {
      assertLocalLearningScope(connection, activity.context.learningScope);
      const claim = claimIdempotentWrite(connection, {
        operation: "prepared-activity",
        idempotencyKey,
        request: { ...activity, preparedAt: null },
        entityId: activity.activityId,
        recordedAt: activity.preparedAt,
      });
      if (claim.replayed) return claim;
      connection
        .prepare(
          `INSERT INTO prepared_activities (
            activity_id, activity_type, title, origin_surface, context_json,
            prepared_at, root_generation
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          activity.activityId,
          activity.activityType,
          activity.title,
          activity.originSurface,
          stringifyBounded(activity.context),
          activity.preparedAt,
          this.#database.rootGeneration,
        );
      return claim;
    });
  }

  async readPreparedActivity(activityIdValue: string): Promise<PreparedActivityRecord | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT activity_id, activity_type, title, origin_surface, context_json, prepared_at
           FROM prepared_activities
           WHERE activity_id = ? AND status IN ('prepared', 'completed')`,
        )
        .get(activityId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return preparedActivitySchema.parse({
        activityId: row["activity_id"],
        activityType: row["activity_type"],
        title: row["title"],
        originSurface: row["origin_surface"],
        context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
        preparedAt: row["prepared_at"],
      });
    });
  }

  async listPreparedActivities(filterValue: z.input<typeof activityLibraryFilterSchema> = {}) {
    const filter = activityLibraryFilterSchema.parse(filterValue);
    return withLeasedConnection(this.#database, (connection) => {
      const clauses = ["p.status IN ('prepared', 'completed')"];
      const parameters: Array<string | number> = [];
      if (filter.activityTypes.length > 0) {
        clauses.push(`p.activity_type IN (${filter.activityTypes.map(() => "?").join(", ")})`);
        parameters.push(...filter.activityTypes);
      }
      if (filter.cursor) {
        clauses.push("(p.prepared_at < ? OR (p.prepared_at = ? AND p.activity_id > ?))");
        parameters.push(
          filter.cursor.preparedAt,
          filter.cursor.preparedAt,
          filter.cursor.activityId,
        );
      }
      const rows = connection
        .prepare(
          `
        SELECT p.*, EXISTS (SELECT 1 FROM generated_activity_payloads g
          WHERE g.activity_id = p.activity_id) AS generated,
          CASE WHEN (p.status <> 'prepared' AND json_type(p.context_json, '$.learningPath') IS NULL) OR EXISTS (
            SELECT 1 FROM vocabulary_entries v
            WHERE json_extract(v.source_json, '$.kind') = 'activity'
              AND json_extract(v.source_json, '$.activityId') = p.activity_id
              AND v.status <> 'candidate'
          ) THEN 'retained-data'
          WHEN EXISTS (SELECT 1 FROM exercises e WHERE e.activity_id = p.activity_id) OR EXISTS (SELECT 1 FROM course_results r WHERE r.activity_id = p.activity_id)
            THEN 'cascade' ELSE 'available' END AS deletion_status
        FROM prepared_activities p WHERE ${clauses.join(" AND ")}
        ORDER BY p.prepared_at DESC, p.activity_id LIMIT ?
      `,
        )
        .all(...parameters, filter.maximum + 1) as Record<string, unknown>[];
      const entries = rows.slice(0, filter.maximum).map((row) =>
        activityLibraryItemSchema.parse({
          activityId: row["activity_id"],
          activityType: row["activity_type"],
          title: row["title"],
          originSurface: row["origin_surface"],
          preparedAt: row["prepared_at"],
          generated: row["generated"] === 1,
          deletionStatus: row["deletion_status"],
        }),
      );
      const last = entries.at(-1);
      return {
        rootGeneration: this.#database.rootGeneration,
        entries,
        nextCursor:
          rows.length > filter.maximum && last
            ? { preparedAt: last.preparedAt, activityId: last.activityId }
            : null,
      };
    });
  }

  async readLatestPreparedVoiceActivity(
    kind: "speaking" | "listening",
  ): Promise<PreparedActivityRecord | undefined> {
    const activityType = kind === "speaking" ? "voice-speaking" : "codex-listening";
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT activity_id, activity_type, title, origin_surface, context_json, prepared_at
           FROM prepared_activities
           WHERE activity_type = ? AND status = 'prepared'
           ORDER BY prepared_at DESC, activity_id DESC
           LIMIT 1`,
        )
        .get(activityType) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return preparedActivitySchema.parse({
        activityId: row["activity_id"],
        activityType: row["activity_type"],
        title: row["title"],
        originSurface: row["origin_surface"],
        context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
        preparedAt: row["prepared_at"],
      });
    });
  }

  async deletePreparedActivity(activityIdValue: string): Promise<void> {
    const activityId = activityIdSchema.parse(activityIdValue);
    const deletedAt = utcInstantSchema.parse(new Date().toISOString());
    await withLeasedTransaction(this.#database, (connection) => {
      const activity = connection
        .prepare(`SELECT status, context_json FROM prepared_activities WHERE activity_id = ?`)
        .get(activityId) as { status: string; context_json: string } | undefined;
      if (!activity) throw new Error("OD_PREPARED_ACTIVITY_NOT_FOUND");
      const courseMissionId = parseScopedActivityContext(
        connection,
        parseJson(activity.context_json),
      ).courseTeaching?.mission.id;
      if (activity.status !== "prepared" && !courseMissionId) {
        throw new Error("OD_PREPARED_ACTIVITY_DELETE_BLOCKED");
      }
      const retainedVocabulary = connection
        .prepare(
          `SELECT 1
           FROM vocabulary_entries
           WHERE json_extract(source_json, '$.kind') = 'activity'
             AND json_extract(source_json, '$.activityId') = ?
             AND status <> 'candidate'
           LIMIT 1`,
        )
        .get(activityId);
      if (retainedVocabulary) {
        throw new Error("OD_PREPARED_ACTIVITY_DELETE_BLOCKED");
      }
      const courseVoice = connection
        .prepare(
          `SELECT h.entity_id FROM course_results r JOIN history_entries h ON h.history_entry_id = r.history_entry_id WHERE r.activity_id = ? AND h.entity_kind = 'voice-summary'`,
        )
        .all(activityId) as { entity_id: string }[];
      connection
        .prepare(
          "DELETE FROM history_entries WHERE history_entry_id IN (SELECT history_entry_id FROM course_results WHERE activity_id = ?)",
        )
        .run(activityId);
      for (const row of courseVoice)
        connection
          .prepare("DELETE FROM voice_summaries WHERE voice_session_id = ?")
          .run(row.entity_id);
      connection
        .prepare(
          `DELETE FROM history_entries
           WHERE entity_kind = 'attempt'
             AND EXISTS (
               SELECT 1 FROM attempts a
               JOIN exercises e ON e.exercise_id = a.exercise_id
               WHERE a.attempt_id = history_entries.entity_id
                 AND e.activity_id = ?
             )`,
        )
        .run(activityId);
      connection.prepare(`DELETE FROM mcp_attempt_feedback WHERE activity_id = ?`).run(activityId);
      connection
        .prepare(
          `INSERT INTO attempt_deletions (attempt_id, deleted_at)
           SELECT a.attempt_id, ?
           FROM attempts a
           JOIN exercises e ON e.exercise_id = a.exercise_id
           WHERE e.activity_id = ?`,
        )
        .run(deletedAt, activityId);
      connection
        .prepare(
          `DELETE FROM attempts
           WHERE exercise_id IN (
             SELECT exercise_id FROM exercises WHERE activity_id = ?
           )`,
        )
        .run(activityId);
      connection.prepare(`DELETE FROM exercises WHERE activity_id = ?`).run(activityId);
      connection
        .prepare(
          `INSERT INTO vocabulary_deletions (vocabulary_id, deleted_at)
           SELECT vocabulary_id, ?
           FROM vocabulary_entries
           WHERE status = 'candidate'
             AND json_extract(source_json, '$.kind') = 'activity'
             AND json_extract(source_json, '$.activityId') = ?`,
        )
        .run(deletedAt, activityId);
      connection
        .prepare(
          `DELETE FROM vocabulary_entries
           WHERE status = 'candidate'
             AND json_extract(source_json, '$.kind') = 'activity'
             AND json_extract(source_json, '$.activityId') = ?`,
        )
        .run(activityId);
      const result = connection
        .prepare(`DELETE FROM prepared_activities WHERE activity_id = ?`)
        .run(activityId);
      if (result.changes !== 1) throw new Error("OD_PREPARED_ACTIVITY_NOT_FOUND");
      if (courseMissionId)
        connection
          .prepare(
            "DELETE FROM course_missions WHERE mission_id = ? AND NOT EXISTS (SELECT 1 FROM prepared_activities WHERE json_extract(context_json, '$.courseTeaching.mission.id') = ?)",
          )
          .run(courseMissionId, courseMissionId);
    });
  }

  async saveMcpAttemptFeedback(
    value: Omit<
      z.input<typeof attemptFeedbackSaveInputSchema>,
      "dataRootGeneration" | "idempotencyKey"
    > & {
      attemptId: string;
      savedAt: string;
      idempotencyKey: string;
    },
  ): Promise<IdempotentWriteResult> {
    const record = strictBoundaryObject({
      attemptId: attemptIdSchema,
      activityId: activityIdSchema,
      expectedActivityRevision: z.int().positive(),
      feedback: z.strictObject({
        outcome: z.enum(["completed", "partially-completed", "abandoned"]),
        summary: z.string().min(1).max(1_000).regex(/\S/u),
        objectiveResults: z
          .array(z.enum(["met", "partially-met", "not-met", "not-evaluated"]))
          .max(20),
        evidence: z.array(z.string().min(1).max(500).regex(/\S/u)).max(20),
      }),
      savedAt: utcInstantSchema,
      idempotencyKey: z.string().min(16).max(128),
    }).parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const activity = connection
        .prepare(
          `SELECT title, activity_type, status FROM prepared_activities
           WHERE activity_id = ?`,
        )
        .get(record.activityId) as
        { title: string; activity_type: string; status: "prepared" | "completed" } | undefined;
      if (!activity) throw new Error("OD_MCP_ACTIVITY_NOT_FOUND");
      const claim = claimIdempotentWrite(connection, {
        operation: "attempt-completion",
        idempotencyKey: record.idempotencyKey,
        request: {
          attemptId: record.attemptId,
          activityId: record.activityId,
          expectedActivityRevision: record.expectedActivityRevision,
          feedback: record.feedback,
        },
        entityId: record.attemptId,
        recordedAt: record.savedAt,
      });
      if (claim.replayed) return claim;
      if (record.expectedActivityRevision !== 1 || activity.status === "completed") {
        throw new Error("OD_MCP_ACTIVITY_REVISION_CONFLICT");
      }
      connection
        .prepare(
          `INSERT INTO mcp_attempt_feedback (
            attempt_id, activity_id, expected_activity_revision, feedback_json,
            saved_at, root_generation
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.attemptId,
          record.activityId,
          record.expectedActivityRevision,
          stringifyBounded(record.feedback),
          record.savedAt,
          this.#database.rootGeneration,
        );
      const historyEntryId = historyEntryIdSchema.parse(
        `history-entry_${randomUUID().replaceAll("-", "")}`,
      );
      const activityType = historyActivityTypeSchema.parse(activity.activity_type);
      const skill =
        activityType === "reading"
          ? "reading"
          : activityType === "codex-listening"
            ? "listening"
            : activityType === "voice-speaking"
              ? "speaking"
              : "writing";
      connection
        .prepare(
          `INSERT INTO history_entries (
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, 'attempt', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          historyEntryId,
          record.attemptId,
          skill,
          activityType,
          activity.title,
          record.savedAt,
          stringifyBounded({ kind: "reference" }),
          this.#database.rootGeneration,
        );
      if (record.feedback.outcome === "completed") {
        connection
          .prepare(
            `UPDATE prepared_activities SET status = 'completed', completed_at = ?
             WHERE activity_id = ? AND status = 'prepared'`,
          )
          .run(record.savedAt, record.activityId);
      }
      return claim;
    });
  }

  async saveTargetedPracticeActivity(
    value: TargetedPracticeActivity,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const record = targetedPracticeActivitySchema.parse(value);
    if (
      record.activity.activityType !== "grammar" ||
      record.activity.context.mistakeIds.length < 1
    ) {
      throw new Error("OD_TARGETED_PRACTICE_ACTIVITY_INVALID");
    }
    if (record.aiProvenance.producer !== "desktop-app-server") {
      throw new Error("OD_TARGETED_PRACTICE_PROVENANCE_INVALID");
    }
    const modelSelection = record.aiProvenance.modelSelection;
    const categoryJson = stringifyBounded(record.category, 16_384);
    return withLeasedTransaction(this.#database, (connection) => {
      const placeholders = record.activity.context.mistakeIds.map(() => "?").join(", ");
      const mistakes = connection
        .prepare(
          `SELECT mistake_id, effective_category_json FROM mistakes
           WHERE disposition = 'active' AND mistake_id IN (${placeholders})`,
        )
        .all(...record.activity.context.mistakeIds) as Record<string, unknown>[];
      if (
        mistakes.length !== record.activity.context.mistakeIds.length ||
        mistakes.some(({ effective_category_json }) => effective_category_json !== categoryJson)
      ) {
        throw new Error("OD_TARGETED_PRACTICE_PATTERN_STALE");
      }
      assertLocalLearningScope(connection, record.activity.context.learningScope);
      const claim = claimIdempotentWrite(connection, {
        operation: "prepared-activity",
        idempotencyKey,
        request: record,
        entityId: record.activity.activityId,
        recordedAt: record.activity.preparedAt,
      });
      if (claim.replayed) return claim;
      const content = preparePortableContent(connection, record);
      connection
        .prepare(
          `INSERT INTO prepared_activities (
            activity_id, activity_type, title, origin_surface, context_json,
            prepared_at, root_generation
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.activity.activityId,
          record.activity.activityType,
          record.activity.title,
          record.activity.originSurface,
          stringifyBounded(record.activity.context),
          record.activity.preparedAt,
          this.#database.rootGeneration,
        );
      connection
        .prepare(
          `INSERT INTO generated_activity_payloads (
            activity_id, workload, model_request_id, model_id, effort_id, generated_at, output_json
          ) VALUES (?, 'exercise-generation', ?, ?, ?, ?, ?)`,
        )
        .run(
          record.activity.activityId,
          record.aiProvenance.modelRequestId,
          modelSelection.modelId,
          modelSelection.effortId,
          record.aiProvenance.generatedAt,
          stringifyBounded(content, maximumExerciseContentBytes),
        );
      linkPortableContent(connection, record.activity.activityId, content);
      const insertReference = connection.prepare(
        `INSERT INTO activity_context_references (activity_id, reference_kind, reference_id)
         VALUES (?, ?, ?)`,
      );
      const insertLink = connection.prepare(
        `INSERT INTO targeted_practice_links (activity_id, mistake_id, category_json, created_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const mistakeId of record.activity.context.mistakeIds) {
        insertReference.run(record.activity.activityId, "mistake", mistakeId);
        insertLink.run(
          record.activity.activityId,
          mistakeId,
          categoryJson,
          record.activity.preparedAt,
        );
      }
      for (const topicId of record.activity.context.curriculumTopicIds) {
        insertReference.run(record.activity.activityId, "curriculum-topic", topicId);
      }
      insertActivityVocabularyCandidates(
        connection,
        record.vocabularyEntries,
        record.activity.activityId,
        record.activity.preparedAt,
      );
      return claim;
    });
  }

  async saveGeneratedPracticeActivity(
    value: GeneratedPracticeActivity,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const record = generatedPracticeActivitySchema.parse(value);
    if (record.aiProvenance.producer !== "desktop-app-server") {
      throw new Error("OD_GENERATED_PRACTICE_PROVENANCE_INVALID");
    }
    const modelSelection = record.aiProvenance.modelSelection;
    return withLeasedTransaction(this.#database, (connection) => {
      assertLocalLearningScope(connection, record.activity.context.learningScope);
      const claim = claimIdempotentWrite(connection, {
        operation: "prepared-activity",
        idempotencyKey,
        request: record,
        entityId: record.activity.activityId,
        recordedAt: record.activity.preparedAt,
      });
      if (claim.replayed) return claim;
      const content = preparePortableContent(connection, record);
      connection
        .prepare(
          `INSERT INTO prepared_activities (
            activity_id, activity_type, title, origin_surface, context_json,
            prepared_at, root_generation
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.activity.activityId,
          record.activity.activityType,
          record.activity.title,
          record.activity.originSurface,
          stringifyBounded(record.activity.context),
          record.activity.preparedAt,
          this.#database.rootGeneration,
        );
      connection
        .prepare(
          `INSERT INTO generated_activity_payloads (
            activity_id, workload, model_request_id, model_id, effort_id, generated_at, output_json
          ) VALUES (?, 'exercise-generation', ?, ?, ?, ?, ?)`,
        )
        .run(
          record.activity.activityId,
          record.aiProvenance.modelRequestId,
          modelSelection.modelId,
          modelSelection.effortId,
          record.aiProvenance.generatedAt,
          stringifyBounded(content, maximumExerciseContentBytes),
        );
      linkPortableContent(connection, record.activity.activityId, content);
      const insertReference = connection.prepare(
        `INSERT INTO activity_context_references (activity_id, reference_kind, reference_id)
         VALUES (?, ?, ?)`,
      );
      for (const topicId of record.activity.context.curriculumTopicIds) {
        insertReference.run(record.activity.activityId, "curriculum-topic", topicId);
      }
      for (const mistakeId of record.activity.context.mistakeIds) {
        insertReference.run(record.activity.activityId, "mistake", mistakeId);
      }
      for (const vocabularyId of record.activity.context.vocabularyIds) {
        insertReference.run(record.activity.activityId, "vocabulary", vocabularyId);
      }
      insertActivityVocabularyCandidates(
        connection,
        record.vocabularyEntries,
        record.activity.activityId,
        record.activity.preparedAt,
      );
      return claim;
    });
  }

  async readGeneratedActivity(activityIdValue: string): Promise<GeneratedActivityRead | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT a.activity_id, a.title, a.context_json, p.model_request_id,
            p.model_id, p.effort_id, p.generated_at, p.output_json
           FROM prepared_activities a
           JOIN generated_activity_payloads p ON p.activity_id = a.activity_id
           WHERE a.activity_id = ? AND a.status IN ('prepared', 'completed')`,
        )
        .get(activityId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return generatedActivityReadSchema.parse({
        activityId: row["activity_id"],
        title: row["title"],
        context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
        aiProvenance: {
          source: "ai",
          producer: "desktop-app-server",
          modelRequestId: row["model_request_id"],
          generatedAt: row["generated_at"],
          modelSelection: {
            availability: "reported",
            modelId: row["model_id"],
            effortId: row["effort_id"],
          },
        },
        content: readStoredExerciseContent(
          connection,
          activityId,
          parseJson(row["output_json"], maximumExerciseContentBytes),
        ),
      });
    });
  }

  async readPreparedActivityDeletionStatus(
    activityIdValue: string,
  ): Promise<"available" | "cascade" | "retained-data" | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT CASE
             WHEN p.status <> 'prepared' AND json_type(p.context_json, '$.learningPath') IS NULL THEN 'retained-data'
             WHEN EXISTS (
               SELECT 1 FROM vocabulary_entries v
               WHERE json_extract(v.source_json, '$.kind') = 'activity'
                 AND json_extract(v.source_json, '$.activityId') = p.activity_id
                 AND v.status <> 'candidate'
             ) THEN 'retained-data'
             WHEN EXISTS (
               SELECT 1 FROM exercises e WHERE e.activity_id = p.activity_id
             ) OR EXISTS (SELECT 1 FROM course_results r WHERE r.activity_id = p.activity_id) THEN 'cascade'
             ELSE 'available'
           END AS deletion_status
           FROM prepared_activities p
           WHERE p.activity_id = ?`,
        )
        .get(activityId) as { deletion_status: unknown } | undefined;
      return row === undefined
        ? undefined
        : z.enum(["available", "cascade", "retained-data"]).parse(row.deletion_status);
    });
  }

  async readActiveGeneratedExerciseSet(
    activityIdValue: string,
  ): Promise<ActiveGeneratedExerciseSet | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const rows = connection
        .prepare(
          `SELECT a.attempt_id, a.started_at FROM attempts a
           JOIN exercises e ON e.exercise_id = a.exercise_id
           WHERE e.activity_id = ? AND a.status = 'in-progress'
           ORDER BY e.rowid`,
        )
        .all(activityId) as Record<string, unknown>[];
      if (rows.length === 0) return undefined;
      const startedAt = utcInstantSchema.parse(rows[0]?.["started_at"]);
      if (rows.some((row) => row["started_at"] !== startedAt)) {
        throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      }
      return activeGeneratedExerciseSetSchema.parse({
        startedAt,
        attemptIds: rows.map((row) => attemptIdSchema.parse(row["attempt_id"])),
      });
    });
  }

  async startGeneratedExerciseSet(value: GeneratedExerciseSetStart): Promise<void> {
    const record = generatedExerciseSetStartSchema.parse(value);
    await withLeasedTransaction(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT a.context_json, p.model_request_id, p.model_id, p.effort_id,
            p.generated_at, p.output_json
           FROM prepared_activities a
           JOIN generated_activity_payloads p ON p.activity_id = a.activity_id
           WHERE a.activity_id = ? AND a.status IN ('prepared', 'completed')`,
        )
        .get(record.activityId) as Record<string, unknown> | undefined;
      if (!row) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
      const activeAttempt = connection
        .prepare(
          `SELECT 1 FROM attempts a
           JOIN exercises e ON e.exercise_id = a.exercise_id
           WHERE e.activity_id = ? AND a.status = 'in-progress' LIMIT 1`,
        )
        .get(record.activityId);
      if (activeAttempt !== undefined) throw new Error("OD_EXERCISE_ATTEMPT_SET_ACTIVE");
      const context = parseScopedActivityContext(connection, parseJson(row["context_json"]));
      const provenance = aiProvenanceSchema.parse({
        source: "ai",
        producer: "desktop-app-server",
        modelRequestId: row["model_request_id"],
        generatedAt: row["generated_at"],
        modelSelection: {
          availability: "reported",
          modelId: row["model_id"],
          effortId: row["effort_id"],
        },
      });
      const content = readStoredExerciseContent(
        connection,
        record.activityId,
        parseJson(row["output_json"], maximumExerciseContentBytes),
      );
      const materializeOptions = {
        exerciseIds: record.exercises.map(({ snapshot }) => snapshot.exercise.exerciseId),
        aiProvenance: provenance,
        curriculumTopicIds: context.curriculumTopicIds,
      };
      const expected = materializeContentExercises(content, materializeOptions);
      for (const [position, exercise] of expected.entries()) {
        const started = record.exercises[position];
        if (
          !started ||
          started.snapshot.startedAt !== record.startedAt ||
          JSON.stringify(started.snapshot.exercise) !== JSON.stringify(exercise)
        ) {
          throw new Error("OD_GENERATED_ACTIVITY_SNAPSHOT_INVALID");
        }
        connection
          .prepare(
            `INSERT INTO exercises (
              exercise_id, activity_id, kind, cefr_band, started_at, objectives_json,
              instructions, explanation, content_json, answer_contract_json,
              ai_provenance_json, snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            exercise.exerciseId,
            record.activityId,
            exercise.kind,
            exercise.cefrBand,
            record.startedAt,
            stringifyBounded(exercise.objectives),
            exercise.instructions,
            exercise.explanation ?? null,
            stringifyBounded(exercise.content, maximumMaterializedExerciseBytes),
            stringifyBounded(exercise.answerContract, maximumMaterializedExerciseBytes),
            stringifyBounded(exercise.aiProvenance),
            stringifyBounded(started.snapshot, maximumExerciseSnapshotBytes),
          );
        connection
          .prepare(
            `INSERT INTO attempts (
              attempt_id, exercise_id, status, started_at, exercise_snapshot_json
            ) VALUES (?, ?, 'in-progress', ?, ?)`,
          )
          .run(
            started.attemptId,
            exercise.exerciseId,
            record.startedAt,
            stringifyBounded(started.snapshot, maximumExerciseSnapshotBytes),
          );
        connection
          .prepare(
            "INSERT INTO attempt_content_revisions(attempt_id, content_revision_id) VALUES (?, ?)",
          )
          .run(started.attemptId, content.revisionId);
      }
    });
  }

  async saveGeneratedExerciseAnswer(
    value: GeneratedExerciseAnswerSave,
  ): Promise<ReturnType<typeof startedExerciseSnapshotSchema.parse>> {
    const record = generatedExerciseAnswerSaveSchema.parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT a.started_at, a.exercise_snapshot_json
           FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
           WHERE a.attempt_id = ? AND a.status = 'in-progress' AND e.activity_id = ?`,
        )
        .get(record.attemptId, record.activityId) as Record<string, unknown> | undefined;
      if (!row) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      const snapshot = startedExerciseSnapshotSchema.parse(
        parseJson(row["exercise_snapshot_json"], maximumExerciseSnapshotBytes),
      );
      const evaluation = evaluateExerciseAnswer(
        snapshot.exercise,
        record.answer,
        requireLocalLearningScope(connection).targetLanguage,
      );
      if (evaluation.status !== "requires-ai") {
        throw new Error("OD_EXERCISE_AI_FEEDBACK_NOT_REQUIRED");
      }
      const elapsed = Math.max(
        0,
        Date.parse(record.submittedAt) - Date.parse(utcInstantSchema.parse(row["started_at"])),
      );
      const existing = connection
        .prepare(`SELECT answer_json FROM answers WHERE attempt_id = ? AND position = 0`)
        .get(record.attemptId) as { answer_json: string } | undefined;
      if (existing) {
        if (
          JSON.stringify(exerciseAnswerSchema.parse(parseJson(existing.answer_json))) !==
          JSON.stringify(record.answer)
        ) {
          throw new Error("OD_EXERCISE_ANSWER_CONFLICT");
        }
      } else {
        connection
          .prepare(
            `INSERT INTO answers (
              attempt_id, position, submitted_after_previous_event_ms, answer_json
            ) VALUES (?, 0, ?, ?)`,
          )
          .run(record.attemptId, elapsed, stringifyBounded(record.answer));
      }
      return snapshot;
    });
  }

  async recordCourseHelperSupport(intent: "chat" | "translate") {
    await withLeasedTransaction(this.#database, (connection) => {
      connection
        .prepare(
          `INSERT INTO exercise_support (attempt_id, hints_used, helper_used, translation_used)
        SELECT a.attempt_id, 0, 1, ? FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
        JOIN prepared_activities p ON p.activity_id = e.activity_id
        WHERE a.status = 'in-progress' AND json_type(p.context_json, '$.learningPath') = 'object'
        ON CONFLICT(attempt_id) DO UPDATE SET helper_used = 1, translation_used = max(translation_used, excluded.translation_used)`,
        )
        .run(intent === "translate" ? 1 : 0);
      connection
        .prepare(
          `INSERT INTO course_activity_support (activity_id, helper_used, translation_used)
        SELECT DISTINCT e.activity_id, 1, ? FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
        JOIN prepared_activities p ON p.activity_id = e.activity_id
        WHERE a.status = 'in-progress' AND json_type(p.context_json, '$.learningPath') = 'object'
        ON CONFLICT(activity_id) DO UPDATE SET helper_used = 1, translation_used = max(translation_used, excluded.translation_used)`,
        )
        .run(intent === "translate" ? 1 : 0);
    });
  }

  async recordExerciseSupport(activityId: string, attemptId: string) {
    await withLeasedTransaction(this.#database, (connection) => {
      const attempt = connection
        .prepare(
          "SELECT 1 FROM attempts a JOIN exercises e ON a.exercise_id = e.exercise_id WHERE a.attempt_id = ? AND e.activity_id = ? AND a.status = 'in-progress'",
        )
        .get(attemptId, activityId);
      if (!attempt) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      connection
        .prepare(
          "INSERT INTO exercise_support (attempt_id, hints_used) VALUES (?, 1) ON CONFLICT(attempt_id) DO UPDATE SET hints_used = hints_used + 1",
        )
        .run(attemptId);
      connection
        .prepare(
          `INSERT INTO course_activity_support (activity_id, hints_used)
        SELECT activity_id, 1 FROM prepared_activities WHERE activity_id = ? AND json_type(context_json, '$.learningPath') = 'object'
        ON CONFLICT(activity_id) DO UPDATE SET hints_used = 1`,
        )
        .run(activityId);
    });
  }

  async completeGeneratedExerciseSet(value: GeneratedExerciseSetComplete): Promise<void> {
    const record = generatedExerciseSetCompleteSchema.parse(value);
    if (new Set(record.answers.map(({ attemptId }) => attemptId)).size !== record.answers.length) {
      throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
    }
    await withLeasedTransaction(this.#database, (connection) => {
      const activity = connection
        .prepare(
          `SELECT title, activity_type, context_json FROM prepared_activities
           WHERE activity_id = ? AND status = 'prepared'`,
        )
        .get(record.activityId) as Record<string, unknown> | undefined;
      if (!activity) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
      const activityTitle = z.string().min(1).max(160).parse(activity["title"]);
      const activityType = historyActivityTypeSchema.parse(activity["activity_type"]);
      const activityContext = parseScopedActivityContext(
        connection,
        parseJson(activity["context_json"]),
      );
      const payload = connection
        .prepare("SELECT output_json FROM generated_activity_payloads WHERE activity_id = ?")
        .get(record.activityId) as { output_json: string } | undefined;
      if (!payload) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
      const readingMaterial = readStoredExerciseContent(
        connection,
        record.activityId,
        parseJson(payload.output_json, maximumExerciseContentBytes),
      ).payload.readingMaterial;
      const expectedCount = (
        connection
          .prepare(
            `SELECT count(*) AS count FROM attempts a
               JOIN exercises e ON e.exercise_id = a.exercise_id
               WHERE e.activity_id = ? AND a.status = 'in-progress'`,
          )
          .get(record.activityId) as { count: number }
      ).count;
      if (expectedCount !== record.answers.length) {
        throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      }
      for (const item of record.answers) {
        const row = connection
          .prepare(
            `SELECT a.started_at, a.exercise_snapshot_json
             FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
             WHERE a.attempt_id = ? AND a.status = 'in-progress' AND e.activity_id = ?`,
          )
          .get(item.attemptId, record.activityId) as Record<string, unknown> | undefined;
        if (!row) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
        const snapshot = startedExerciseSnapshotSchema.parse(
          parseJson(row["exercise_snapshot_json"], maximumExerciseSnapshotBytes),
        );
        const evaluation = evaluateExerciseAnswer(
          snapshot.exercise,
          item.answer,
          requireLocalLearningScope(connection).targetLanguage,
        );
        if (evaluation.status === "requires-ai" && item.aiFeedback === undefined) {
          throw new Error("OD_EXERCISE_AI_FEEDBACK_REQUIRED");
        }
        const elapsed = Math.max(
          0,
          Date.parse(record.completedAt) - Date.parse(utcInstantSchema.parse(row["started_at"])),
        );
        const existingAnswer = connection
          .prepare(`SELECT answer_json FROM answers WHERE attempt_id = ? AND position = 0`)
          .get(item.attemptId) as { answer_json: string } | undefined;
        if (existingAnswer) {
          if (
            JSON.stringify(exerciseAnswerSchema.parse(parseJson(existingAnswer.answer_json))) !==
            JSON.stringify(item.answer)
          ) {
            throw new Error("OD_EXERCISE_ANSWER_CONFLICT");
          }
        } else {
          connection
            .prepare(
              `INSERT INTO answers (
                attempt_id, position, submitted_after_previous_event_ms, answer_json
              ) VALUES (?, 0, ?, ?)`,
            )
            .run(item.attemptId, elapsed, stringifyBounded(item.answer));
        }
        let objectiveEvaluations;
        let feedback;
        if (evaluation.status === "requires-ai") {
          const ai = item.aiFeedback;
          if (
            !ai ||
            ai.output.objectiveEvaluations.length !== snapshot.exercise.objectives.length
          ) {
            throw new Error("OD_EXERCISE_AI_FEEDBACK_INVALID");
          }
          objectiveEvaluations = ai.output.objectiveEvaluations;
          feedback = attemptFeedbackSchema.parse({
            source: { kind: "ai", modelRequestId: ai.modelRequestId },
            summary: ai.output.summary,
            strengths: ai.output.strengths,
            improvements: [...ai.output.improvements, ...ai.output.caveats].slice(0, 20),
            ...(ai.output.nextStep ? { nextStep: ai.output.nextStep } : {}),
            overallUncertainty: ai.output.overallUncertainty,
            mistakeIds: [],
            vocabularyCandidateIds: [],
          });
        } else {
          const outcome: "demonstrated" | "developing" | "not-demonstrated" =
            evaluation.status === "correct"
              ? "demonstrated"
              : evaluation.status === "almost-correct"
                ? "developing"
                : "not-demonstrated";
          objectiveEvaluations = snapshot.exercise.objectives.map(() => ({
            outcome,
            evidence:
              evaluation.status === "correct"
                ? "The submitted answer matched the exercise contract."
                : evaluation.status === "almost-correct"
                  ? "The submitted answer was close to an accepted answer with minor spelling " +
                    "or diacritic differences."
                  : "The submitted answer did not match the exercise contract.",
            uncertainty: { level: "none" as const },
          }));
          feedback = attemptFeedbackSchema.parse({
            source: { kind: "deterministic" },
            summary:
              evaluation.status === "correct"
                ? "The answer matched the accepted exercise evidence."
                : evaluation.status === "almost-correct"
                  ? "The answer was nearly correct and needs only minor spelling or diacritic review."
                  : "The answer needs review against the accepted exercise evidence.",
            strengths:
              evaluation.status === "correct"
                ? ["The submitted answer was accepted."]
                : evaluation.status === "almost-correct"
                  ? ["The submitted answer was close to an accepted correction."]
                  : [],
            improvements:
              evaluation.status === "almost-correct" || evaluation.status === "incorrect"
                ? ["Review the revealed accepted answer."]
                : [],
            overallUncertainty: { level: "none" },
            mistakeIds: [],
            vocabularyCandidateIds: [],
          });
        }
        connection
          .prepare(
            `UPDATE attempts SET status = 'completed', terminal_after_previous_event_ms = ?,
              objective_evaluations_json = ?, feedback_json = ?
             WHERE attempt_id = ? AND status = 'in-progress'`,
          )
          .run(
            elapsed,
            stringifyBounded(objectiveEvaluations),
            stringifyBounded(feedback, maximumExerciseFeedbackBytes),
            item.attemptId,
          );
        const reconstruction = generatedExerciseHistorySchema.parse({
          kind: "exercise-attempt",
          readingMaterial,
          snapshot,
          answer: item.answer,
          objectiveEvaluations,
          feedback,
          suggestedAnswer:
            evaluation.status === "requires-ai"
              ? (item.aiFeedback?.output.suggestedAnswer ?? null)
              : null,
        });
        const skill =
          activityType === "reading"
            ? "reading"
            : snapshot.exercise.kind === "free-writing" ||
                snapshot.exercise.kind === "short-answer" ||
                snapshot.exercise.kind === "sentence-correction"
              ? "writing"
              : "reading";
        connection
          .prepare(
            `INSERT INTO history_entries (
              history_entry_id, entity_kind, entity_id, skill, activity_type, title,
              occurred_at, reconstruction_json, root_generation
            ) VALUES (?, 'attempt', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.historyEntryId,
            item.attemptId,
            skill,
            activityType,
            activityTitle,
            record.completedAt,
            stringifyBounded(reconstruction, maximumExerciseHistoryBytes),
            this.#database.rootGeneration,
          );
        if (activityContext.learningPath) {
          const teaching = activityContext.courseTeaching;
          const repeatedAttempt = !!connection
            .prepare(
              `SELECT 1 FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id WHERE e.activity_id = ? AND a.started_at < ? LIMIT 1`,
            )
            .get(record.activityId, snapshot.startedAt);
          const assistance = connection
            .prepare(
              "SELECT max(hints_used) AS hints_used, max(helper_used) AS helper_used, max(translation_used) AS translation_used FROM (SELECT hints_used, helper_used, translation_used FROM exercise_support WHERE attempt_id = ? UNION ALL SELECT hints_used, helper_used, translation_used FROM course_activity_support WHERE activity_id = ?)",
            )
            .get(item.attemptId, record.activityId) as
            { hints_used: number; helper_used: number; translation_used: number } | undefined;
          const hints = assistance?.hints_used ?? 0;
          const evidence: CourseEvidence[] = teaching
            ? objectiveEvaluations.flatMap((evaluation, index) => {
                const description = snapshot.exercise.objectives[index]?.description;
                const objective = teaching.objectives.find((o) => o.description === description);
                const skill = teaching.delivery === "practice" ? "writing" : teaching.delivery;
                if (!objective || !["reading", "writing"].includes(skill)) return [];
                const supported =
                  hints > 0 ||
                  repeatedAttempt ||
                  assistance?.helper_used === 1 ||
                  teaching.priorFeedback ||
                  teaching.purpose === "practice";
                return [
                  {
                    objectiveId: objective.id,
                    skill: skill as "reading" | "writing",
                    outcome:
                      evaluation.outcome === "demonstrated"
                        ? supported
                          ? "supported"
                          : teaching.purpose === "review"
                            ? "transfer"
                            : "independent"
                        : evaluation.outcome === "not-evaluated"
                          ? "not-evaluated"
                          : "not-yet",
                    ...(objective.targetId
                      ? {
                          retrieval:
                            snapshot.exercise.kind === "multiple-choice"
                              ? ("recognition" as const)
                              : snapshot.exercise.kind === "free-writing"
                                ? ("use" as const)
                                : ("recall" as const),
                        }
                      : {}),
                    support: [
                      ...(hints || assistance?.helper_used ? ["hint" as const] : []),
                      ...(repeatedAttempt ? ["repeat-attempt" as const] : []),
                      ...(assistance?.translation_used ? ["translation" as const] : []),
                      ...(teaching.priorFeedback ? ["model-answer" as const] : []),
                    ],
                    evidence: evaluation.evidence,
                    uncertainty: evaluation.uncertainty.level,
                  },
                ];
              })
            : [];
          saveCourseEvidence(connection, {
            activityId: record.activityId,
            historyEntryId: item.historyEntryId,
            occurredAt: record.completedAt,
            evidence,
          });
        }
        const insertTopic = connection.prepare(
          `INSERT INTO history_curriculum_topics (history_entry_id, curriculum_topic_id)
           VALUES (?, ?)`,
        );
        for (const topicId of activityContext.curriculumTopicIds) {
          insertTopic.run(item.historyEntryId, topicId);
        }
      }
      const updated = connection
        .prepare(
          `UPDATE prepared_activities SET status = 'completed', completed_at = ?
           WHERE activity_id = ? AND status IN ('prepared', 'completed')`,
        )
        .run(record.completedAt, record.activityId);
      if (updated.changes !== 1) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
    });
  }

  async abandonGeneratedExerciseSet(
    value: GeneratedExerciseSetAbandon,
  ): Promise<readonly AttemptId[]> {
    const record = generatedExerciseSetAbandonSchema.parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const rows = connection
        .prepare(
          `SELECT a.attempt_id, a.started_at FROM attempts a
           JOIN exercises e ON e.exercise_id = a.exercise_id
           WHERE e.activity_id = ? AND a.status = 'in-progress'`,
        )
        .all(record.activityId) as Record<string, unknown>[];
      if (rows.length === 0) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      const update = connection.prepare(
        `UPDATE attempts SET status = 'abandoned', terminal_after_previous_event_ms = ?
         WHERE attempt_id = ? AND status = 'in-progress'`,
      );
      for (const row of rows) {
        const elapsed = Math.max(
          0,
          Date.parse(record.abandonedAt) - Date.parse(utcInstantSchema.parse(row["started_at"])),
        );
        const result = update.run(elapsed, attemptIdSchema.parse(row["attempt_id"]));
        if (result.changes !== 1) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      }
      return rows.map((row) => attemptIdSchema.parse(row["attempt_id"]));
    });
  }

  async readHistorySkillTotals() {
    return withLeasedConnection(this.#database, (connection) => {
      const totals = { writing: 0, reading: 0, listening: 0, speaking: 0 };
      for (const row of connection
        .prepare("SELECT skill, COUNT(*) AS count FROM history_entries GROUP BY skill")
        .all()) {
        const skill = z.enum(["writing", "reading", "listening", "speaking"]).parse(row["skill"]);
        totals[skill] = z.int().nonnegative().parse(row["count"]);
      }
      return totals;
    });
  }

  async listHistory(filterValue: HistoryFilter = {}): Promise<readonly HistoryEntryRecord[]> {
    const filter = historyFilterSchema.parse(filterValue);
    if (filter.fromDate && filter.toDate && filter.fromDate > filter.toDate) {
      throw new Error("OD_HISTORY_DATE_RANGE_INVALID");
    }
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (filter.skill !== undefined) {
      clauses.push("skill = ?");
      parameters.push(filter.skill);
    }
    if (filter.activityType !== undefined) {
      clauses.push("activity_type = ?");
      parameters.push(filter.activityType);
    }
    if (filter.fromDate !== undefined) {
      clauses.push("substr(occurred_at, 1, 10) >= ?");
      parameters.push(filter.fromDate);
    }
    if (filter.toDate !== undefined) {
      clauses.push("substr(occurred_at, 1, 10) <= ?");
      parameters.push(filter.toDate);
    }
    if (filter.curriculumTopicId !== undefined) {
      clauses.push(
        "EXISTS (SELECT 1 FROM history_curriculum_topics t WHERE t.history_entry_id = history_entries.history_entry_id AND t.curriculum_topic_id = ?)",
      );
      parameters.push(filter.curriculumTopicId);
    }
    if (filter.mistakeCategory !== undefined) {
      clauses.push(
        "EXISTS (SELECT 1 FROM history_mistake_categories m WHERE m.history_entry_id = history_entries.history_entry_id AND m.category = ?)",
      );
      parameters.push(filter.mistakeCategory);
    }
    if (filter.historyEntryIds) {
      clauses.push(`history_entry_id IN (${filter.historyEntryIds.map(() => "?").join(",")})`);
      parameters.push(...filter.historyEntryIds);
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    return withLeasedConnection(this.#database, (connection) =>
      connection
        .prepare(
          `SELECT history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
           FROM history_entries ${where} ORDER BY occurred_at DESC LIMIT ?`,
        )
        .all(...parameters, filter.maximum)
        .map((row) => {
          const record = row as Record<string, unknown>;
          const historyEntryId = historyEntryIdSchema.parse(record["history_entry_id"]);
          const curriculumTopicIds = connection
            .prepare(
              `SELECT curriculum_topic_id FROM history_curriculum_topics
               WHERE history_entry_id = ? ORDER BY curriculum_topic_id`,
            )
            .all(historyEntryId)
            .map((entry) => curriculumTopicIdSchema.parse(entry["curriculum_topic_id"]));
          const mistakeCategories = connection
            .prepare(
              `SELECT category FROM history_mistake_categories
               WHERE history_entry_id = ? ORDER BY category`,
            )
            .all(historyEntryId)
            .map((entry) => z.string().min(1).max(120).parse(entry["category"]));
          let detail: HistoryEntryRecord["detail"] = { kind: "reference" };
          if (record["entity_kind"] === "attempt" && record["activity_type"] === "writing") {
            const entityId = attemptIdSchema.parse(record["entity_id"]);
            const writing = connection
              .prepare(
                `SELECT a.feedback_json, ans.answer_json, c.original_text, c.corrected_text,
                  c.ai_provenance_json, c.vocabulary_candidates_json, c.correction_id
                 FROM attempts a
                 JOIN answers ans ON ans.attempt_id = a.attempt_id AND ans.position = 0
                 JOIN corrections c ON c.attempt_id = a.attempt_id AND c.state = 'final'
                 WHERE a.attempt_id = ? AND a.status = 'completed'`,
              )
              .get(entityId) as Record<string, unknown> | undefined;
            if (writing) {
              const answer = exerciseAnswerSchema.parse(parseJson(writing["answer_json"]));
              if (answer.kind !== "free-writing") throw new Error("OD_HISTORY_WRITING_INVALID");
              const correctionId = correctionIdSchema.parse(writing["correction_id"]);
              const changes = connection
                .prepare(
                  `SELECT category, explanation FROM correction_changes
                   WHERE correction_id = ? AND kind <> 'unchanged' ORDER BY position`,
                )
                .all(correctionId)
                .map((entry) => ({
                  category: z.string().min(1).max(80).parse(entry["category"]),
                  explanation: z.string().min(1).max(800).parse(entry["explanation"]),
                }));
              detail = Object.freeze({
                kind: "writing-correction" as const,
                learnerText: answer.text,
                correctedText: z.string().min(1).max(12_000).parse(writing["corrected_text"]),
                feedback: attemptFeedbackSchema.parse(parseJson(writing["feedback_json"])),
                aiProvenance: aiProvenanceSchema.parse(parseJson(writing["ai_provenance_json"])),
                vocabularyCandidates: Object.freeze(
                  z
                    .array(correctionVocabularyCandidateSchema)
                    .max(50)
                    .parse(parseJson(writing["vocabulary_candidates_json"])),
                ),
                changes: Object.freeze(changes),
              });
            }
          } else if (record["entity_kind"] === "voice-summary") {
            const summary = voiceSummarySchema.parse(parseJson(record["reconstruction_json"]));
            detail = Object.freeze({
              kind: "voice-summary" as const,
              scenario: summary.scenario,
              duration: summary.duration,
              observedIssues: summary.observedIssues,
              vocabulary: summary.vocabulary,
              feedback: summary.feedback,
              nextSteps: summary.nextSteps,
            });
          } else if (record["entity_kind"] === "placement") {
            detail = Object.freeze({
              kind: "placement" as const,
              ...placementResultSchema.parse(parseJson(record["reconstruction_json"])),
            });
          } else if (
            record["entity_kind"] === "attempt" &&
            record["activity_type"] === "codex-listening"
          ) {
            detail = Object.freeze({
              kind: "listening" as const,
              ...listeningResultSchema.parse(parseJson(record["reconstruction_json"])),
            });
          } else if (record["entity_kind"] === "attempt") {
            const attemptId = attemptIdSchema.parse(record["entity_id"]);
            const reconstructed = generatedExerciseHistorySchema.safeParse(
              parseJson(record["reconstruction_json"], maximumExerciseHistoryBytes),
            );
            const source = connection
              .prepare(
                `SELECT e.activity_id FROM attempts a
                 JOIN exercises e ON e.exercise_id = a.exercise_id
                 WHERE a.attempt_id = ?`,
              )
              .get(attemptId) as Record<string, unknown> | undefined;
            if (reconstructed.success && source) {
              detail = Object.freeze({
                ...reconstructed.data,
                activityId: activityIdSchema.parse(source["activity_id"]),
              });
            }
          }
          return Object.freeze({
            historyEntryId,
            entityKind: z
              .enum(["attempt", "correction", "vocabulary-review", "voice-summary", "placement"])
              .parse(record["entity_kind"]),
            entityId: z.string().min(18).max(96).parse(record["entity_id"]),
            skill: z.enum(["writing", "reading", "listening", "speaking"]).parse(record["skill"]),
            activityType: historyActivityTypeSchema.parse(record["activity_type"]),
            title: z.string().min(1).max(160).parse(record["title"]),
            occurredAt: utcInstantSchema.parse(record["occurred_at"]),
            curriculumTopicIds: Object.freeze(curriculumTopicIds),
            mistakeCategories: Object.freeze(mistakeCategories),
            detail,
            rootGeneration: z.int().positive().parse(record["root_generation"]),
          }) satisfies HistoryEntryRecord;
        }),
    );
  }

  async deleteHistoryEntry(historyEntryIdValue: string, deletedAtValue: string): Promise<void> {
    const historyEntryId = historyEntryIdSchema.parse(historyEntryIdValue);
    const deletedAt = utcInstantSchema.parse(deletedAtValue);
    await withLeasedTransaction(this.#database, (connection) => {
      const entry = connection
        .prepare(
          `SELECT entity_kind, entity_id, activity_type, reconstruction_json FROM history_entries WHERE history_entry_id = ?`,
        )
        .get(historyEntryId) as
        | {
            entity_kind: string;
            entity_id: string;
            activity_type: string;
            reconstruction_json: string;
          }
        | undefined;
      if (!entry) throw new Error("OD_HISTORY_NOT_FOUND");
      if (entry.entity_kind === "voice-summary") {
        const voiceSessionId = z.string().min(18).max(96).parse(entry.entity_id);
        connection
          .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
          .run(historyEntryId);
        const result = connection
          .prepare(`DELETE FROM voice_summaries WHERE voice_session_id = ?`)
          .run(voiceSessionId);
        if (result.changes !== 1) throw new Error("OD_VOICE_SUMMARY_NOT_FOUND");
        return;
      }
      if (entry.entity_kind === "placement") {
        const result = connection
          .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
          .run(historyEntryId);
        if (result.changes !== 1) throw new Error("OD_HISTORY_NOT_FOUND");
        return;
      }
      if (entry.entity_kind === "attempt" && entry.activity_type === "codex-listening") {
        const result = connection
          .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
          .run(historyEntryId);
        if (result.changes !== 1) throw new Error("OD_HISTORY_NOT_FOUND");
        return;
      }
      if (entry.entity_kind !== "attempt") throw new Error("OD_HISTORY_DELETE_UNSUPPORTED");
      const attemptId = attemptIdSchema.parse(entry.entity_id);
      connection
        .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
        .run(historyEntryId);
      connection
        .prepare(`INSERT INTO attempt_deletions (attempt_id, deleted_at) VALUES (?, ?)`)
        .run(attemptId, deletedAt);
      const result = connection.prepare(`DELETE FROM attempts WHERE attempt_id = ?`).run(attemptId);
      if (result.changes !== 1) throw new Error("OD_ATTEMPT_NOT_FOUND");
    });
  }

  async saveListeningResult(
    value: Readonly<{
      attemptId: string;
      activityId: string;
      expectedActivityRevision: number;
      result: ListeningResult;
      occurredAt: string;
      idempotencyKey: string;
    }>,
  ): Promise<Readonly<{ historyEntryId: string; replayed: boolean }>> {
    const record = strictBoundaryObject({
      attemptId: attemptIdSchema,
      activityId: activityIdSchema,
      expectedActivityRevision: z.int().nonnegative(),
      result: listeningResultSchema,
      occurredAt: utcInstantSchema,
      idempotencyKey: z.string().min(16).max(128),
    }).parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const activity = connection
        .prepare(
          `SELECT title, activity_type, status FROM prepared_activities
           WHERE activity_id = ?`,
        )
        .get(record.activityId) as
        { title: string; activity_type: string; status: "prepared" | "completed" } | undefined;
      if (!activity) throw new Error("OD_MCP_ACTIVITY_NOT_FOUND");
      if (activity.activity_type !== "codex-listening") {
        throw new Error("OD_MCP_LISTENING_ACTIVITY_INVALID");
      }
      const historyEntryId = historyEntryIdSchema.parse(
        `history-entry_${record.attemptId.slice("attempt_".length)}`,
      );
      const claim = claimIdempotentWrite(connection, {
        operation: "attempt-completion",
        idempotencyKey: record.idempotencyKey,
        request: record,
        entityId: record.attemptId,
        recordedAt: record.occurredAt,
      });
      if (claim.replayed) return { historyEntryId, replayed: true };
      if (record.expectedActivityRevision !== 1 || activity.status === "completed") {
        throw new Error("OD_MCP_ACTIVITY_REVISION_CONFLICT");
      }
      connection
        .prepare(
          `INSERT INTO history_entries (
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, 'attempt', ?, 'listening', 'codex-listening', ?, ?, ?, ?)`,
        )
        .run(
          historyEntryId,
          record.attemptId,
          activity.title,
          record.occurredAt,
          stringifyBounded(record.result),
          this.#database.rootGeneration,
        );
      connection
        .prepare(
          `UPDATE prepared_activities SET status = 'completed', completed_at = ?
           WHERE activity_id = ? AND status = 'prepared'`,
        )
        .run(record.occurredAt, record.activityId);
      return { historyEntryId, replayed: false };
    });
  }
}

function vocabularyEntryFromRow(row: Record<string, unknown>): VocabularyEntry {
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

function vocabularyRecordFromRow(row: Record<string, unknown>): VocabularyRecord {
  return {
    entry: vocabularyEntryFromRow(row),
    revision: z.int().nonnegative().parse(row["revision"]),
    updatedAt: utcInstantSchema.parse(row["updated_at"]),
  };
}
