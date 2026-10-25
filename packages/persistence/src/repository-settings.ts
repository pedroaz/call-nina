import {
  languageSchema,
  utcInstantSchema,
  type z,
  type Language,
  type LearningScope,
} from "@call-nina/contracts";
import { learnerProfileSchema } from "@call-nina/domain";
import {
  assertRegisteredLearningScope as assertLocalLearningScope,
  readLocalLearningScope,
  requireLocalLearningScope,
} from "./learning-context.js";
import {
  type LearnerSettingsRecord,
  type LearnerSettingsUpdate,
  learnerSettingsInputSchema,
  learnerSettingsUpdateSchema,
  readLearnerSettingsFromConnection,
  stringifyBounded,
} from "./repository-support.js";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";

export class SettingsRepository {
  readonly #database: CallNinaDatabase;
  constructor(database: CallNinaDatabase) {
    this.#database = database;
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

  async readLearnerSettingsForScope(scope: LearningScope) {
    return withLeasedConnection(this.#database, (connection) => {
      assertLocalLearningScope(connection, scope);
      const settings = readLearnerSettingsFromConnection(connection, scope.learnerId, scope);
      if (!settings) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      return settings;
    });
  }

  async createLearnerSettings(
    settingsValue: z.infer<typeof learnerSettingsInputSchema>,
  ): Promise<LearnerSettingsRecord> {
    const settings = learnerSettingsInputSchema.parse(settingsValue);
    const profile = settings.profile;
    return withLeasedTransaction(this.#database, (connection) => {
      connection
        .prepare("INSERT INTO learner_profiles(learner_id, created_at) VALUES (?, ?)")
        .run(profile.learnerId, profile.createdAt);
      connection
        .prepare("INSERT INTO learner_settings(learner_id, ui_locale, updated_at) VALUES (?, ?, ?)")
        .run(profile.learnerId, profile.uiLocale, profile.updatedAt);
      connection
        .prepare(
          `INSERT INTO local_learning_scope
        (singleton, learner_id, course_id, target_language) VALUES (1, ?, ?, ?)`,
        )
        .run(profile.learnerId, null, profile.targetLanguage);
      connection
        .prepare(
          "INSERT INTO language_profiles(target_language, learner_id, course_id, profile_json) VALUES (?, ?, ?, ?)",
        )
        .run(profile.targetLanguage, profile.learnerId, null, stringifyBounded(profile));
      const stored = readLearnerSettingsFromConnection(connection, profile.learnerId);
      if (!stored) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      return stored;
    });
  }

  async selectLearningLanguage(languageValue: Language): Promise<LearnerSettingsRecord> {
    const language = languageSchema.parse(languageValue);
    return withLeasedTransaction(this.#database, (connection) => {
      const current = requireLocalLearningScope(connection);
      const settings = readLearnerSettingsFromConnection(connection, current.learnerId);
      if (!settings) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      const now = new Date().toISOString();
      const profile = learnerProfileSchema.parse({
        ...settings.profile,
        targetLanguage: language,
        levelEstimate: {
          currentLevel: "a1",
          targetLevel: "a1",
          basis: "self-reported",
          updatedAt: now,
        },
        everydayLifeGoal: "Everyday communication",
        motivation: "Everyday communication",
        interests: [],
        preferredTopics: [],
        inferredStrengths: [],
        inferredWeaknesses: [],
        createdAt: now,
        updatedAt: now,
      });
      if (current.learnerId !== profile.learnerId) throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      connection
        .prepare(
          "INSERT OR IGNORE INTO language_profiles(target_language, learner_id, course_id, profile_json) VALUES (?, ?, NULL, ?)",
        )
        .run(profile.targetLanguage, profile.learnerId, stringifyBounded(profile));
      connection
        .prepare(
          `UPDATE local_learning_scope SET target_language = ?, course_id =
        (SELECT course_id FROM language_profiles WHERE target_language = ?) WHERE singleton = 1`,
        )
        .run(profile.targetLanguage, profile.targetLanguage);
      const selected = readLearnerSettingsFromConnection(connection, profile.learnerId);
      if (!selected) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      return selected;
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
      if (
        profile.learnerId !== update.settings.learningContext.learnerId ||
        profile.targetLanguage !== update.settings.learningContext.targetLanguage
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      const result = connection
        .prepare(
          `UPDATE language_profiles SET profile_json = ?, course_id = ?
        WHERE target_language = ? AND learner_id = ? AND json_extract(profile_json, '$.createdAt') = ? AND json_extract(profile_json, '$.updatedAt') = ?`,
        )
        .run(
          stringifyBounded(profile),
          update.settings.learningContext.courseId,
          profile.targetLanguage,
          profile.learnerId,
          profile.createdAt,
          update.expectedUpdatedAt,
        );
      if (result.changes !== 1) throw new Error("OD_LEARNER_SETTINGS_CONFLICT");
      connection
        .prepare("UPDATE learner_settings SET ui_locale = ?, updated_at = ? WHERE learner_id = ?")
        .run(profile.uiLocale, profile.updatedAt, profile.learnerId);
      connection
        .prepare("UPDATE local_learning_scope SET course_id = ? WHERE target_language = ?")
        .run(update.settings.learningContext.courseId, profile.targetLanguage);
      const stored = readLearnerSettingsFromConnection(connection, profile.learnerId);
      if (!stored) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      return stored;
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
}
