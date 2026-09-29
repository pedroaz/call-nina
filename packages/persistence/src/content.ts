import { migrateExerciseFields } from "./teaching-migration.js";
import { migrateFlashcardContent } from "./flashcards.js";
import { assertLocalLearningScope } from "./learning-context.js";
import type { DatabaseSync } from "node:sqlite";
import {
  generationProvenanceSchema,
  type GenerationProvenance,
  type exerciseGenerationCandidateSchema,
  type learningGoalSchema,
  materialDraftSchema,
  materialReferenceSchema,
  parsePortableExerciseContent,
  preparedActivitySchema,
  contentEvaluation,
  type PortableExerciseContent,
  type z,
} from "@call-nina/contracts";
import { aiProvenanceSchema } from "@call-nina/domain";
import {
  contentIdentity,
  assertStoredContentRevision,
  linkPortableContent,
  readMaterialRevisionInTransaction,
  saveMaterialInTransaction,
} from "./materials.js";

export const contentMaterialInputSchema = materialDraftSchema.or(materialReferenceSchema);

export function preparePortableContent(
  connection: DatabaseSync,
  input: {
    activity: z.infer<typeof preparedActivitySchema>;
    output: z.infer<typeof exerciseGenerationCandidateSchema>;
    generationProvenance: GenerationProvenance;
    material: z.infer<typeof contentMaterialInputSchema>;
    learnerGoal: z.infer<typeof learningGoalSchema> | null;
  },
): PortableExerciseContent {
  const { activity, output } = input;
  const material =
    "revisionId" in input.material
      ? readMaterialRevisionInTransaction(connection, input.material)
      : saveMaterialInTransaction(connection, input.material, activity.preparedAt);
  if (material.language !== activity.context.learningScope.targetLanguage)
    throw new Error("OD_MATERIAL_LANGUAGE_MISMATCH");
  if (material.kind === "pasted-text" && output.readingMaterial?.passage !== material.text)
    throw new Error("OD_CONTENT_MATERIAL_MISMATCH");
  return parsePortableExerciseContent({
    schemaVersion: 1,
    kind: "exercise-set",
    contentId: contentIdentity("content"),
    revisionId: contentIdentity("content-revision"),
    title: activity.title,
    language: activity.context.learningScope.targetLanguage,
    createdAt: activity.preparedAt,
    goal: {
      learnerGoal: input.learnerGoal,
      courseId: activity.context.learningScope.courseId,
      request: activity.context.naturalRequest,
      curriculumTopicIds: activity.context.curriculumTopicIds,
    },
    materials: [material],
    provenance: generationProvenanceSchema.parse(input.generationProvenance),
    assets: [],
    exercises: output.exercises.map((exercise) => ({
      exerciseId: contentIdentity("content-exercise"),
      revisionId: contentIdentity("exercise-revision"),
      evaluation: contentEvaluation(exercise.kind),
    })),
    payload: output,
  });
}

/** One-time preserving conversion, inside migration 25's transaction. No old-format read fallback. */
export function migrateVersionedContent(connection: DatabaseSync) {
  // Current material writers bind language explicitly, including this old-format conversion.
  connection.exec(
    "ALTER TABLE material_revisions ADD COLUMN target_language TEXT NOT NULL DEFAULT 'de' CHECK(target_language IN ('en-US','pt-BR','es','de'))",
  );
  const rows = connection
    .prepare(
      `SELECT p.*, a.activity_type, a.title, a.origin_surface, a.context_json, a.prepared_at
    FROM generated_activity_payloads p JOIN prepared_activities a ON a.activity_id = p.activity_id`,
    )
    .all();
  for (const row of rows) {
    const activity = preparedActivitySchema.parse({
      activityId: row["activity_id"],
      activityType: row["activity_type"],
      title: row["title"],
      originSurface: row["origin_surface"],
      context: JSON.parse(String(row["context_json"])) as unknown,
      preparedAt: row["prepared_at"],
    });
    assertLocalLearningScope(connection, activity.context.learningScope);
    const aiProvenance = aiProvenanceSchema.parse({
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
    if (aiProvenance.modelSelection.availability !== "reported")
      throw new Error("OD_CONTENT_PROVENANCE_INVALID");
    const content = preparePortableContent(connection, {
      activity,
      generationProvenance: {
        producer: "codex",
        modelId: aiProvenance.modelSelection.modelId,
        effortId: aiProvenance.modelSelection.effortId,
      },
      learnerGoal: null,
      output: migrateExerciseFields(JSON.parse(String(row["output_json"]))),
      // Only the request survived older storage; do not invent a pasted source or historic profile goal.
      material: {
        kind: "topic",
        title: activity.title,
        language: activity.context.learningScope.targetLanguage,
        text: activity.context.naturalRequest,
      },
    });
    connection
      .prepare("UPDATE generated_activity_payloads SET output_json = ? WHERE activity_id = ?")
      .run(JSON.stringify(content), activity.activityId);
    linkPortableContent(connection, activity.activityId, content, "reused-or-historic");
  }
  migrateFlashcardContent(connection);
  connection.exec(`INSERT INTO attempt_content_revisions(attempt_id, content_revision_id)
    SELECT a.attempt_id, c.revision_id FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
    JOIN activity_content_revisions c ON c.activity_id = e.activity_id;
    CREATE TRIGGER generated_activity_payload_immutable BEFORE UPDATE ON generated_activity_payloads
      BEGIN SELECT RAISE(ABORT, 'OD_GENERATED_ACTIVITY_IMMUTABLE'); END;`);
}

export function readStoredExerciseContent(
  connection: DatabaseSync,
  activityId: string,
  value: unknown,
) {
  const content = parsePortableExerciseContent(value);
  assertStoredContentRevision(connection, activityId, content);
  return content;
}
