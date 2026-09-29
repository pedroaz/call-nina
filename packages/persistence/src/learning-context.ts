import type { DatabaseSync } from "node:sqlite";
import {
  preparedActivitySchema,
  normalizeVocabularyIdentity,
  learningScopeSchema,
  type LearningScope,
  type Language,
} from "@call-nina/contracts";

/** The active selection is a preference, never the owner of a referenced record. */
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
  return learningScopeSchema.parse(row);
}

export function requireLocalLearningScope(connection: DatabaseSync): LearningScope {
  const scope = readLocalLearningScope(connection);
  if (!scope) throw new Error("OD_LEARNING_CONTEXT_REQUIRED");
  return scope;
}

export function scopeForLanguage(connection: DatabaseSync, language: Language): LearningScope {
  const row = connection
    .prepare(
      `SELECT learner_id AS learnerId, course_id AS courseId,
    target_language AS targetLanguage FROM language_profiles WHERE target_language = ?`,
    )
    .get(language);
  if (!row) throw new Error("OD_LEARNING_CONTEXT_REQUIRED");
  return learningScopeSchema.parse(row);
}

export function assertLocalLearningScope(connection: DatabaseSync, value: LearningScope) {
  const actual = learningScopeSchema.parse({
    learnerId: value.learnerId,
    courseId: value.courseId,
    targetLanguage: value.targetLanguage,
  });
  const root = requireLocalLearningScope(connection);
  if (
    actual.learnerId !== root.learnerId ||
    (actual.courseId !== null &&
      (actual.targetLanguage !== "de" || actual.courseId !== "german-foundations"))
  )
    throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
}

export function activityLearningScope(connection: DatabaseSync, activityId: string): LearningScope {
  const row = connection
    .prepare("SELECT context_json FROM prepared_activities WHERE activity_id = ?")
    .get(activityId);
  if (row)
    return parseScopedActivityContext(connection, JSON.parse(String(row["context_json"])))
      .learningScope;
  const exercise = connection
    .prepare("SELECT learning_scope_json FROM exercises WHERE activity_id = ? LIMIT 1")
    .get(activityId);
  if (!exercise) throw new Error("OD_ACTIVITY_NOT_FOUND");
  const scope = learningScopeSchema.parse(JSON.parse(String(exercise["learning_scope_json"])));
  assertLocalLearningScope(connection, scope);
  return scope;
}

export function vocabularySearchPolicy(connection: DatabaseSync) {
  const scope = requireLocalLearningScope(connection);
  const normalize = (value: string) => normalizeVocabularyIdentity(value, scope.targetLanguage);
  connection.function("nina_vocabulary_normalize", { deterministic: true }, (value) =>
    normalize(String(value)),
  );
  return {
    normalize,
    fold: (column: "lemma" | "meaning") => `nina_vocabulary_normalize(${column})`,
  };
}

export function parseScopedActivityContext(connection: DatabaseSync, value: unknown) {
  const context = preparedActivitySchema.shape.context.parse(value);
  assertLocalLearningScope(connection, context.learningScope);
  if (
    context.learningPath &&
    (context.learningScope.targetLanguage !== "de" ||
      context.learningScope.courseId !== "german-foundations")
  )
    throw new Error("OD_COURSE_UNSUPPORTED");
  return context;
}

/** Current writes require an initialized owner; the root-only assertion also serves ledger migrations. */
export function assertRegisteredLearningScope(connection: DatabaseSync, scope: LearningScope) {
  assertLocalLearningScope(connection, scope);
  const owner = scopeForLanguage(connection, scope.targetLanguage);
  if (owner.learnerId !== scope.learnerId) throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
}

export function assertActivityReferences(
  connection: DatabaseSync,
  context: ReturnType<typeof preparedActivitySchema.parse>["context"],
) {
  parseScopedActivityContext(connection, context);
  assertRegisteredLearningScope(connection, context.learningScope);
  for (const [table, column, ids] of [
    ["mistakes", "mistake_id", context.mistakeIds],
    ["vocabulary_entries", "vocabulary_id", context.vocabularyIds],
  ] as const) {
    const statement = connection.prepare(
      `SELECT target_language FROM ${table} WHERE ${column} = ?`,
    );
    for (const id of ids) {
      if (statement.get(id)?.["target_language"] !== context.learningScope.targetLanguage)
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
    }
  }
}
