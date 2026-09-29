import type { DatabaseSync } from "node:sqlite";
import { learnerProfileSchema } from "@call-nina/domain";

// Runs only in ledgered migration 30, before the old profile columns are retired.
export function migrateLanguageProfiles(connection: DatabaseSync) {
  const row = connection
    .prepare(
      `SELECT p.*, s.ui_locale, s.explanation_language, s.teaching_profile_id, s.correction_timing, s.correction_coverage, s.show_concise_explanation, s.show_natural_alternative FROM learner_profiles p JOIN learner_settings s USING(learner_id)`,
    )
    .get();
  if (!row) return;
  const learnerId = String(row["learner_id"]);
  const booleanFromSqlite = (value: unknown) => {
    if (value !== 0 && value !== 1) throw new Error("OD_LEARNER_SETTINGS_INVALID");
    return value === 1;
  };
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
    targetLanguage: "de",
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
    uiLocale: row["ui_locale"] === "en" ? "en-US" : row["ui_locale"],
    explanationLanguage:
      row["explanation_language"] === "en" ? "en-US" : row["explanation_language"],
    defaultTeachingProfileId: row["teaching_profile_id"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  });

  const scope = { learnerId, courseId: "german-foundations", targetLanguage: "de" };
  for (const row of connection
    .prepare("SELECT voice_session_id, summary_json FROM voice_summaries")
    .all()) {
    const old = JSON.parse(String(row["summary_json"])) as Record<string, unknown>;
    if (old["schemaVersion"] !== 1) throw new Error("OD_VOICE_SUMMARY_VERSION_UNSUPPORTED");
    connection
      .prepare("UPDATE voice_summaries SET summary_json = ? WHERE voice_session_id = ?")
      .run(JSON.stringify({ ...old, learningScope: scope }), String(row["voice_session_id"]));
  }
  for (const row of connection
    .prepare(
      "SELECT history_entry_id, entity_kind, reconstruction_json FROM history_entries WHERE entity_kind IN ('voice-summary', 'placement')",
    )
    .all()) {
    const old = JSON.parse(String(row["reconstruction_json"])) as Record<string, unknown>;
    connection
      .prepare("UPDATE history_entries SET reconstruction_json = ? WHERE history_entry_id = ?")
      .run(JSON.stringify({ ...old, learningScope: scope }), String(row["history_entry_id"]));
  }
  connection
    .prepare(
      "INSERT INTO language_profiles(target_language, learner_id, course_id, profile_json) VALUES ('de', ?, 'german-foundations', ?)",
    )
    .run(learnerId, JSON.stringify(profile));
}
