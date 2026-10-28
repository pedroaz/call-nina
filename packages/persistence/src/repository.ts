import {
  type activityLibraryFilterSchema,
  type attemptFeedbackSaveInputSchema,
  languageSchema,
  learningContextSchema,
  type vocabularyBulkRequestSchema,
  type vocabularyLibraryFilterSchema,
  type z,
  type ActivityAction,
  type AttemptId,
  type CapturedTeachingContext,
  type Language,
  type LearningCourse,
  type LearningScope,
  type ListeningResult,
  type PlacementResult,
} from "@call-nina/contracts";
import {
  type MistakeCategory,
  type VocabularyEntry,
  type VocabularyLessonSetRequest,
  type VoiceSummary,
} from "@call-nina/domain";
import { type IdempotentWriteResult } from "./idempotency.js";
import {
  assertRegisteredLearningScope as assertLocalLearningScope,
  requireLocalLearningScope,
  scopeForLanguage,
} from "./learning-context.js";
import { readLearningPathState, updateLearningPath } from "./learning-path.js";
import { clearPersonalData, readPersonalDataInventory } from "./personal-data.js";
import { readRecommendationEvidence } from "./recommendation-evidence.js";
import { ActivitiesRepository } from "./repository-activities.js";
import { ExercisesRepository } from "./repository-exercises.js";
import { HistoryRepository } from "./repository-history.js";
import { SettingsRepository } from "./repository-settings.js";
import {
  type ActiveGeneratedExerciseSet,
  type CorrectionMistakeSample,
  type DashboardSnapshot,
  type GeneratedActivityRead,
  type GeneratedExerciseAnswerSave,
  type GeneratedExerciseSetAbandon,
  type GeneratedExerciseSetComplete,
  type GeneratedExerciseSetStart,
  type GeneratedPracticeActivity,
  type HistoryFilter,
  type HistoryPageRecord,
  type LearnerSettingsRecord,
  type LearnerSettingsUpdate,
  type MistakePatternRecord,
  type PreparedActivityRecord,
  type TargetedPracticeActivity,
  type VocabularyLessonSetRecord,
  type VocabularyRecord,
  type VocabularyReviewSession,
  type learnerSettingsInputSchema,
  type mistakePatternFilterSchema,
} from "./repository-support.js";
import { VocabularyRepository } from "./repository-vocabulary.js";
import { withLeasedConnection, type CallNinaDatabase } from "./sqlite.js";
import { saveWritingAttempt, type WritingAttemptPersistence } from "./writing-attempt.js";

export { preparedActivitySchema } from "@call-nina/contracts";
export {
  activeGeneratedExerciseSetSchema,
  generatedActivityReadSchema,
  generatedExerciseAnswerSaveSchema,
  generatedExerciseSetAbandonSchema,
  generatedExerciseSetCompleteSchema,
  generatedExerciseSetStartSchema,
  generatedPracticeActivitySchema,
  learnerSettingsRecordSchema,
  learnerSettingsUpdateSchema,
  targetedPracticeActivitySchema,
  vocabularyLessonSetRecordSchema,
  vocabularyReviewSessionCardSchema,
  vocabularyReviewSessionSchema,
  type ActiveGeneratedExerciseSet,
  type CorrectionMistakeSample,
  type DashboardSnapshot,
  type GeneratedActivityRead,
  type GeneratedExerciseAnswerSave,
  type GeneratedExerciseSetAbandon,
  type GeneratedExerciseSetComplete,
  type GeneratedExerciseSetStart,
  type GeneratedPracticeActivity,
  type HistoryFilter,
  type HistoryEntryRecord,
  type LearnerSettingsRecord,
  type LearnerSettingsUpdate,
  type MistakePatternRecord,
  type PreparedActivityRecord,
  type TargetedPracticeActivity,
  type VocabularyLessonSetRecord,
  type VocabularyRecord,
  type VocabularyReviewSession,
  type VocabularyReviewSessionCard,
} from "./repository-support.js";
export class CallNinaRepository {
  readonly #settings: SettingsRepository;
  readonly #vocabulary: VocabularyRepository;
  readonly #history: HistoryRepository;
  readonly #activities: ActivitiesRepository;
  readonly #exercises: ExercisesRepository;

  readonly #database: CallNinaDatabase;

  constructor(database: CallNinaDatabase) {
    this.#database = database;
    this.#settings = new SettingsRepository(database);
    this.#vocabulary = new VocabularyRepository(database);
    this.#history = new HistoryRepository(database);
    this.#activities = new ActivitiesRepository(database);
    this.#exercises = new ExercisesRepository(database);
  }

  async readRecentAttemptEvidence(maximum = 5) {
    return this.#history.readRecentAttemptEvidence(maximum);
  }

  async readRecommendationEvidence(contextValue: unknown) {
    const context = learningContextSchema.parse(contextValue);
    return withLeasedConnection(this.#database, (connection) =>
      readRecommendationEvidence(connection, context),
    );
  }

  async readRecommendationPreparedActivities(contextValue: unknown) {
    return this.#activities.readRecommendationPreparedActivities(contextValue);
  }

  async requireLearningScope(language?: Language) {
    return withLeasedConnection(this.#database, (connection) => {
      const scope = language
        ? scopeForLanguage(connection, languageSchema.parse(language))
        : requireLocalLearningScope(connection);
      assertLocalLearningScope(connection, scope);
      return scope;
    });
  }

  async requireLearningContext() {
    const settings = await this.readCurrentLearnerSettings();
    if (!settings) throw new Error("OD_LEARNING_CONTEXT_REQUIRED");
    return settings.learningContext;
  }

  async readLearningPathState() {
    return readLearningPathState(this.#database);
  }

  async updateLearningPath(
    course: LearningCourse,
    input: unknown,
    locale: "en" | "de" | "es" | "pt-BR",
  ) {
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
    return this.#settings.hasAcknowledgedFirstAiDisclosure();
  }

  async acknowledgeFirstAiDisclosure(acknowledgedAtValue: string): Promise<void> {
    return this.#settings.acknowledgeFirstAiDisclosure(acknowledgedAtValue);
  }

  async readCurrentLearnerSettings(): Promise<LearnerSettingsRecord | undefined> {
    return this.#settings.readCurrentLearnerSettings();
  }

  async readLearnerSettingsForScope(scope: LearningScope) {
    return this.#settings.readLearnerSettingsForScope(scope);
  }

  async createLearnerSettings(
    settingsValue: z.infer<typeof learnerSettingsInputSchema>,
  ): Promise<LearnerSettingsRecord> {
    return this.#settings.createLearnerSettings(settingsValue);
  }

  async selectLearningLanguage(languageValue: Language): Promise<LearnerSettingsRecord> {
    return this.#settings.selectLearningLanguage(languageValue);
  }

  async updateLearnerSettings(updateValue: LearnerSettingsUpdate): Promise<LearnerSettingsRecord> {
    return this.#settings.updateLearnerSettings(updateValue);
  }

  async addVocabularyCandidate(
    entryValue: VocabularyEntry,
    createdAtValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    return this.#vocabulary.addVocabularyCandidate(entryValue, createdAtValue, idempotencyKey);
  }

  async saveVocabularyLessonSet(
    requestValue: VocabularyLessonSetRequest,
    entriesValue: readonly VocabularyEntry[],
    setIdValue: string,
    createdAtValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    return this.#vocabulary.saveVocabularyLessonSet(
      requestValue,
      entriesValue,
      setIdValue,
      createdAtValue,
      idempotencyKey,
    );
  }

  async listVocabularyLessonSets(): Promise<readonly VocabularyLessonSetRecord[]> {
    return this.#vocabulary.listVocabularyLessonSets();
  }

  async reviewVocabularyCard(
    inputValue: Readonly<{
      vocabularyId: string;
      grade: "again" | "hard" | "good" | "easy";
      retrieval: "recognition" | "recall" | "use";
      reviewedAt: string;
      expectedRevision?: number;
      expectedUpdatedAt?: string;
      idempotencyKey: string;
    }>,
  ): Promise<IdempotentWriteResult & { dueOn: string }> {
    return this.#vocabulary.reviewVocabularyCard(inputValue);
  }

  async confirmVocabulary(
    vocabularyId: string,
    confirmedAtValue: string,
    dueOnValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    return this.#vocabulary.confirmVocabulary(
      vocabularyId,
      confirmedAtValue,
      dueOnValue,
      idempotencyKey,
    );
  }

  async readVocabularyLibrary(
    input: z.input<typeof vocabularyLibraryFilterSchema>,
    todayValue: string,
  ) {
    return this.#vocabulary.readVocabularyLibrary(input, todayValue);
  }

  async readVocabularyRecord(id: string): Promise<VocabularyRecord | undefined> {
    return this.#vocabulary.readVocabularyRecord(id);
  }

  async readVocabularyRetrievalSchedules(id: string) {
    return this.#vocabulary.readVocabularyRetrievalSchedules(id);
  }

  async readVocabularyReviewQueue(todayValue: string): Promise<readonly VocabularyRecord[]> {
    return this.#vocabulary.readVocabularyReviewQueue(todayValue);
  }

  async mutateVocabularyBulk(
    input: z.infer<typeof vocabularyBulkRequestSchema>,
    atValue: string,
  ): Promise<void> {
    return this.#vocabulary.mutateVocabularyBulk(input, atValue);
  }

  async listVocabularyRecords(
    status?: "candidate" | "active" | "suspended",
  ): Promise<readonly VocabularyRecord[]> {
    return this.#vocabulary.listVocabularyRecords(status);
  }

  async editVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      expectedUpdatedAt?: string;
      lemma: string;
      meaning: string;
      example: { text: string; meaning: string };
      updatedAt: string;
    }>,
  ): Promise<void> {
    return this.#vocabulary.editVocabulary(input);
  }

  async suspendVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      suspendedAt: string;
      reason: "learner-paused" | "duplicate" | "not-useful" | "other";
    }>,
  ): Promise<void> {
    return this.#vocabulary.suspendVocabulary(input);
  }

  async resumeVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      resumedAt: string;
    }>,
  ): Promise<void> {
    return this.#vocabulary.resumeVocabulary(input);
  }

  async deleteVocabulary(vocabularyIdValue: string, deletedAtValue: string): Promise<void> {
    return this.#vocabulary.deleteVocabulary(vocabularyIdValue, deletedAtValue);
  }

  async deleteAttempt(
    attemptIdValue: string,
    deletedAtValue: string,
  ): Promise<IdempotentWriteResult> {
    return this.#history.deleteAttempt(attemptIdValue, deletedAtValue);
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
    return this.#history.amendMistakeClassification(input);
  }

  async deleteProfileInsight(
    scopeValue: LearningScope,
    insightGroup: "strength" | "weakness",
    position: number,
  ): Promise<void> {
    return this.#history.deleteProfileInsight(scopeValue, insightGroup, position);
  }

  async listDueVocabulary(
    onDateValue: string,
    requestedScope?: LearningScope,
  ): Promise<readonly VocabularyEntry[]> {
    return this.#vocabulary.listDueVocabulary(onDateValue, requestedScope);
  }

  async createVocabularyReviewSession(
    onDateValue: string,
    sessionIdValue: string,
    maximumItems = 20,
  ): Promise<VocabularyReviewSession> {
    return this.#vocabulary.createVocabularyReviewSession(
      onDateValue,
      sessionIdValue,
      maximumItems,
    );
  }

  async readDevelopmentNotice(): Promise<boolean> {
    return this.#settings.readDevelopmentNotice();
  }

  async dismissDevelopmentNotice(): Promise<void> {
    return this.#settings.dismissDevelopmentNotice();
  }

  async recordActivityUse(activityIdValue: string, expectedGeneration: number) {
    return this.#activities.recordActivityUse(activityIdValue, expectedGeneration);
  }

  async readNinaContinue(contextValue: unknown) {
    return this.#history.readNinaContinue(contextValue);
  }

  async readDashboardSnapshot(onDateValue: string): Promise<DashboardSnapshot> {
    return this.#history.readDashboardSnapshot(onDateValue);
  }

  async readSuggestionLearningScope(contextValue: unknown): Promise<LearningScope | undefined> {
    return this.#history.readSuggestionLearningScope(contextValue);
  }

  async readSuggestionLearningContext(contextValue: unknown, requestedScope?: LearningScope) {
    return this.#history.readSuggestionLearningContext(contextValue, requestedScope);
  }

  async readCorrectionMistakeSample(
    maximumValue = 6,
    requestedScope?: LearningScope,
  ): Promise<readonly CorrectionMistakeSample[]> {
    return this.#history.readCorrectionMistakeSample(maximumValue, requestedScope);
  }

  async listMistakePatterns(
    filterValue: z.input<typeof mistakePatternFilterSchema> = {},
    requestedScope?: LearningScope,
  ): Promise<readonly MistakePatternRecord[]> {
    return this.#history.listMistakePatterns(filterValue, requestedScope);
  }

  async saveVoiceSummary(
    summaryValue: VoiceSummary,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    return this.#activities.saveVoiceSummary(summaryValue, idempotencyKey);
  }

  async savePlacementResult(
    resultValue: PlacementResult,
    idempotencyKeyValue: string,
  ): Promise<Readonly<{ historyEntryId: string; replayed: boolean }>> {
    return this.#activities.savePlacementResult(resultValue, idempotencyKeyValue);
  }

  async savePreparedActivity(
    activityValue: PreparedActivityRecord,
    idempotencyKey: string,
    capture:
      { source: "current-settings" } | { source: "captured"; context: CapturedTeachingContext },
  ): Promise<IdempotentWriteResult> {
    return this.#activities.savePreparedActivity(activityValue, idempotencyKey, capture);
  }

  async readPreparedActivity(activityIdValue: string): Promise<PreparedActivityRecord | undefined> {
    return this.#activities.readPreparedActivity(activityIdValue);
  }

  async readPreparedActivityContext(activityIdValue: string): Promise<CapturedTeachingContext> {
    return this.#activities.readPreparedActivityContext(activityIdValue);
  }

  async listPreparedActivities(filterValue: z.input<typeof activityLibraryFilterSchema> = {}) {
    return this.#activities.listPreparedActivities(filterValue);
  }

  async readLatestPreparedVoiceActivity(
    kind: "speaking" | "listening",
  ): Promise<PreparedActivityRecord | undefined> {
    return this.#activities.readLatestPreparedVoiceActivity(kind);
  }

  async deletePreparedActivity(activityIdValue: string): Promise<void> {
    return this.#activities.deletePreparedActivity(activityIdValue);
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
    return this.#activities.saveMcpAttemptFeedback(value);
  }

  async saveTargetedPracticeActivity(
    value: TargetedPracticeActivity,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    return this.#activities.saveTargetedPracticeActivity(value, idempotencyKey);
  }

  async saveGeneratedPracticeActivity(
    value: GeneratedPracticeActivity,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    return this.#exercises.saveGeneratedPracticeActivity(value, idempotencyKey);
  }

  async reuseGeneratedActivity(value: Extract<ActivityAction, { action: "reuse-exercises" }>) {
    return this.#exercises.reuseGeneratedActivity(value);
  }

  async saveGeneratedExerciseFeedback(
    activityIdValue: string,
    attemptIdValue: string,
    value: unknown,
  ) {
    return this.#exercises.saveGeneratedExerciseFeedback(activityIdValue, attemptIdValue, value);
  }

  async readGeneratedExerciseContext(activityIdValue: string, attemptIdValue?: string) {
    return this.#exercises.readGeneratedExerciseContext(activityIdValue, attemptIdValue);
  }

  async readGeneratedActivity(activityIdValue: string): Promise<GeneratedActivityRead | undefined> {
    return this.#exercises.readGeneratedActivity(activityIdValue);
  }

  async readPreparedActivityDeletionStatus(
    activityIdValue: string,
  ): Promise<"available" | "cascade" | "retained-data" | undefined> {
    return this.#activities.readPreparedActivityDeletionStatus(activityIdValue);
  }

  async readActiveGeneratedExerciseSet(
    activityIdValue: string,
  ): Promise<ActiveGeneratedExerciseSet | undefined> {
    return this.#exercises.readActiveGeneratedExerciseSet(activityIdValue);
  }

  async startGeneratedExerciseSet(value: GeneratedExerciseSetStart) {
    return this.#exercises.startGeneratedExerciseSet(value);
  }

  async saveGeneratedExerciseAnswer(value: GeneratedExerciseAnswerSave) {
    return this.#exercises.saveGeneratedExerciseAnswer(value);
  }

  async recordCourseHelperSupport(intent: "chat" | "translate", scope: LearningScope) {
    return this.#exercises.recordCourseHelperSupport(intent, scope);
  }

  async recordExerciseSupport(activityId: string, attemptId: string) {
    return this.#exercises.recordExerciseSupport(activityId, attemptId);
  }

  async completeGeneratedExerciseSet(value: GeneratedExerciseSetComplete): Promise<void> {
    return this.#exercises.completeGeneratedExerciseSet(value);
  }

  async abandonGeneratedExerciseSet(
    value: GeneratedExerciseSetAbandon,
  ): Promise<readonly AttemptId[]> {
    return this.#exercises.abandonGeneratedExerciseSet(value);
  }

  async readHistorySkillTotals() {
    return this.#history.readHistorySkillTotals();
  }

  async listHistory(filterValue: HistoryFilter = {}): Promise<HistoryPageRecord> {
    return this.#history.listHistory(filterValue);
  }

  async deleteHistoryEntry(historyEntryIdValue: string, deletedAtValue: string): Promise<void> {
    return this.#history.deleteHistoryEntry(historyEntryIdValue, deletedAtValue);
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
    return this.#activities.saveListeningResult(value);
  }
}
