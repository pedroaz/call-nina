import type { DatabaseSync } from "node:sqlite";
import {
  preparedActivitySchema,
  learningScopeSchema,
  type LearningScope,
} from "@call-nina/contracts";
import { supportedCourse } from "@call-nina/domain";

/** One immutable learner/course scope owns all learning tables in a local root.
 * Descendants inherit that scope through their existing parent references.
 * Supporting a second enrollment requires scoped storage, not changing this binding.
 */
export function readLocalLearningScope(connection: DatabaseSync): LearningScope | undefined {
  const row = connection
    .prepare(
      `SELECT learner_id AS learnerId, course_id AS courseId,
    target_language AS targetLanguage FROM local_learning_scope WHERE singleton = 1`,
    )
    .get();
  if (!row) {
    if (connection.prepare("SELECT 1 FROM learner_profiles LIMIT 1").get())
      throw new Error("OD_LEARNING_CONTEXT_INVALID");
    return undefined;
  }
  const scope = learningScopeSchema.parse(row);
  if (scope.courseId !== supportedCourse.courseId)
    throw new Error("OD_LEARNING_CONTEXT_UNSUPPORTED");
  return scope;
}

export function requireLocalLearningScope(connection: DatabaseSync): LearningScope {
  const scope = readLocalLearningScope(connection);
  if (!scope) throw new Error("OD_LEARNING_CONTEXT_REQUIRED");
  return scope;
}

export function assertLocalLearningScope(connection: DatabaseSync, value: LearningScope) {
  const expected = requireLocalLearningScope(connection);
  const actual = learningScopeSchema.parse({
    learnerId: value.learnerId,
    courseId: value.courseId,
    targetLanguage: value.targetLanguage,
  });
  if (actual.learnerId !== expected.learnerId || actual.courseId !== expected.courseId)
    throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
}

export function vocabularySearchPolicy(connection: DatabaseSync) {
  requireLocalLearningScope(connection);
  return {
    normalize: (value: string) => value.trim().toLocaleLowerCase("de"),
    // SQLite lower() is ASCII-only. Column names are a closed app-owned union.
    fold: (column: "lemma" | "meaning") =>
      `lower(replace(replace(replace(replace(${column}, 'Ä', 'ä'), 'Ö', 'ö'), 'Ü', 'ü'), 'ẞ', 'ß'))`,
  };
}

export function parseScopedActivityContext(connection: DatabaseSync, value: unknown) {
  const context = preparedActivitySchema.shape.context.parse(value);
  assertLocalLearningScope(connection, context.learningScope);
  return context;
}
