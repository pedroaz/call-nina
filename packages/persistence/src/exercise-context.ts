import type { DatabaseSync } from "node:sqlite";
import {
  capturedTeachingContextSchema,
  type CapturedTeachingContext,
  type PortableExerciseContent,
} from "@call-nina/contracts";
import { activityLearningScope } from "./learning-context.js";
import { assertStoredContentRevision } from "./materials.js";

function validateContext(
  connection: DatabaseSync,
  activityId: string,
  content: PortableExerciseContent,
  value: unknown,
): CapturedTeachingContext {
  assertStoredContentRevision(connection, activityId, content);
  const scope = activityLearningScope(connection, activityId);
  const parsed = capturedTeachingContextSchema.safeParse(value);
  if (!parsed.success) throw new Error("OD_EXERCISE_CONTEXT_INVALID");
  const { learningContext } = parsed.data;
  if (
    learningContext.learnerId !== scope.learnerId ||
    learningContext.courseId !== scope.courseId ||
    learningContext.targetLanguage !== scope.targetLanguage ||
    learningContext.targetLanguage !== content.language ||
    learningContext.courseId !== content.goal.courseId ||
    JSON.stringify(learningContext.goal) !== JSON.stringify(content.goal.learnerGoal)
  )
    throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
  return parsed.data;
}

export function saveCapturedExerciseContext(
  connection: DatabaseSync,
  activityId: string,
  content: PortableExerciseContent,
  value: CapturedTeachingContext,
) {
  const context = validateContext(connection, activityId, content, value);
  connection
    .prepare(
      `INSERT INTO captured_exercise_contexts(activity_id, content_revision_id, context_json)
       VALUES (?, ?, ?)`,
    )
    .run(activityId, content.revisionId, JSON.stringify(context));
}

export function readCapturedExerciseContext(
  connection: DatabaseSync,
  activityId: string,
  content: PortableExerciseContent,
): CapturedTeachingContext {
  const row = connection
    .prepare(
      `SELECT context_json FROM captured_exercise_contexts
       WHERE activity_id = ? AND content_revision_id = ?`,
    )
    .get(activityId, content.revisionId);
  if (!row) throw new Error("OD_EXERCISE_CONTEXT_MISSING");
  const json = row["context_json"];
  if (typeof json !== "string" || json.length > 32_768)
    throw new Error("OD_EXERCISE_CONTEXT_INVALID");
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("OD_EXERCISE_CONTEXT_INVALID");
  }
  return validateContext(connection, activityId, content, value);
}

export function copyCapturedExerciseContext(
  connection: DatabaseSync,
  sourceActivityId: string,
  activityId: string,
  content: PortableExerciseContent,
) {
  const exists = connection
    .prepare(
      `SELECT 1 FROM captured_exercise_contexts
       WHERE activity_id = ? AND content_revision_id = ?`,
    )
    .get(sourceActivityId, content.revisionId);
  // Reusing old local content remains possible without inventing its missing context.
  if (!exists) return;
  saveCapturedExerciseContext(
    connection,
    activityId,
    content,
    readCapturedExerciseContext(connection, sourceActivityId, content),
  );
}
