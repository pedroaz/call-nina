import { dataRootGenerationSchema, utcInstantSchema } from "./common.js";
import { z } from "./schema-system.js";

// This closed inventory is also the persistence reader's table allowlist.
export const personalDataGroups = {
  profile: [
    "learner_profiles",
    "learner_settings",
    "learner_interests",
    "learner_preferred_topics",
    "learner_profile_insights",
    "model_preference_defaults",
    "model_preference_overrides",
  ],
  practice: [
    "course_selection",
    "course_missions",
    "exercise_support",
    "course_activity_support",
    "course_marks",
    "course_results",
    "prepared_activities",
    "lessons",
    "exercises",
    "generated_activity_payloads",
    "material_revisions",
    "activity_content_revisions",
    "activity_owned_materials",
    "attempt_content_revisions",
    "activity_context_references",
    "targeted_practice_links",
  ],
  feedback: [
    "attempts",
    "learning_attempts",
    "learning_attempt_events",
    "answers",
    "corrections",
    "correction_changes",
    "mistakes",
    "mistake_occurrences",
    "mistake_amendments",
    "mcp_attempt_feedback",
  ],
  vocabulary: [
    "vocabulary_entries",
    "vocabulary_reviews",
    "course_vocabulary_links",
    "vocabulary_lesson_sets",
    "vocabulary_lesson_set_items",
  ],
  history: [
    "voice_summaries",
    "history_entries",
    "history_curriculum_topics",
    "history_mistake_categories",
    "attachment_metadata",
  ],
  system: [
    "privacy_acknowledgements",
    "idempotent_writes",
    "attempt_deletions",
    "mistake_deletions",
    "vocabulary_deletions",
  ],
} as const;

export const personalDataTables = Object.values(personalDataGroups).flat();
export const personalDataTableSchema = z.enum(personalDataTables);
export type PersonalDataTable = z.infer<typeof personalDataTableSchema>;
export const personalDataCleanupScopeSchema = z.enum(["practice", "vocabulary", "learning"]);
export type PersonalDataCleanupScope = z.infer<typeof personalDataCleanupScopeSchema>;
export const personalDataCleanupRequestSchema = z.strictObject({
  scope: personalDataCleanupScopeSchema,
  expectedGeneration: dataRootGenerationSchema,
  confirmed: z.literal(true),
});
export const personalDataCleanupResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("cleared"), scope: personalDataCleanupScopeSchema }),
  z.strictObject({
    status: z.literal("blocked"),
    reason: z.enum(["busy", "linked-vocabulary", "attachments"]),
  }),
]);

export const personalDataTableSummarySchema = z.strictObject({
  table: personalDataTableSchema,
  count: z.int().nonnegative(),
});

export const personalDataLocationIdSchema = z.enum([
  "database",
  "attachments",
  "bootstrap",
  "appConfig",
]);

export const personalDataOverviewSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  dataRoot: z.string().min(1).max(4_096),
  schemaVersion: z.int().positive(),
  refreshedAt: utcInstantSchema,
  tables: z.array(personalDataTableSummarySchema).max(64),
  locations: z
    .array(
      z.strictObject({
        id: personalDataLocationIdSchema,
        path: z.string().min(1).max(4_096),
        status: z.enum(["file", "directory", "missing", "unavailable"]),
        bytes: z.int().nonnegative().nullable(),
      }),
    )
    .max(20),
});
