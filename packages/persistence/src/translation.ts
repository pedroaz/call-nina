import type { DatabaseSync } from "node:sqlite";
import {
  translationRequestSchema,
  translationRevealSchema,
  translationFieldKey,
  savedTranslationSchema,
  portableFlashcardContentSchema,
  exerciseFeedbackCandidateSchema,
  maximumFlashcardContentBytes,
  type PortableExerciseContent,
  type TranslationRequest,
  type TranslationReveal,
  type SavedTranslation,
} from "@call-nina/contracts";
import {
  startedExerciseSnapshotSchema,
  exerciseAnswerSchema,
  evaluateExerciseAnswer,
} from "@call-nina/domain";
import { readStoredExerciseContent } from "./content.js";
import { assertStoredContentRevision } from "./materials.js";
import { activityLearningScope, parseScopedActivityContext } from "./learning-context.js";
import { type CallNinaDatabase, withLeasedConnection, withLeasedTransaction } from "./sqlite.js";

function storedJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length > maximumFlashcardContentBytes)
    throw new Error("OD_TRANSLATION_SOURCE_INVALID");
  return JSON.parse(value) as unknown;
}
function flashcard(
  connection: DatabaseSync,
  request: Pick<TranslationRequest, "activityId" | "content">,
) {
  const row = connection
    .prepare(
      "SELECT content_json, position, revision, completed FROM flashcard_decks WHERE activity_id = ?",
    )
    .get(request.activityId);
  if (!row) throw new Error("OD_TRANSLATION_SOURCE_NOT_FOUND");
  const content = portableFlashcardContentSchema.parse(storedJson(row["content_json"]));
  assertStoredContentRevision(connection, request.activityId, content);
  if (
    content.contentId !== request.content.contentId ||
    content.revisionId !== request.content.revisionId
  )
    throw new Error("OD_TRANSLATION_REVISION_CONFLICT");
  return { row, content };
}
export async function validateTranslationReveal(
  database: CallNinaDatabase,
  value: TranslationReveal,
) {
  const request = translationRevealSchema.parse(value);
  if (request.rootGeneration !== database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
  await withLeasedConnection(database, (connection) => {
    const { row } = flashcard(connection, request);
    activityLearningScope(connection, request.activityId);
    if (
      row["position"] !== request.position ||
      row["revision"] !== request.progressRevision ||
      row["completed"] !== 0
    )
      throw new Error("OD_TRANSLATION_VISIBILITY_INVALID");
  });
}

function source(connection: DatabaseSync, request: TranslationRequest, reveal?: TranslationReveal) {
  const field = request.field;
  const learningScope = activityLearningScope(connection, request.activityId);
  let original: string | null | undefined;
  let hiddenAnswers: string[] = [];
  if (field.kind === "flashcard-meaning" || field.kind === "flashcard-example") {
    const { row, content } = flashcard(connection, request);
    if (
      !reveal ||
      !reveal.visible ||
      reveal.revealId !== field.revealId ||
      reveal.rootGeneration !== request.rootGeneration ||
      reveal.activityId !== request.activityId ||
      reveal.content.revisionId !== content.revisionId ||
      reveal.content.contentId !== content.contentId ||
      reveal.position !== field.position ||
      row["position"] !== field.position ||
      row["revision"] !== reveal.progressRevision ||
      row["completed"] !== 0
    )
      throw new Error("OD_TRANSLATION_VISIBILITY_INVALID");
    if (content.language !== learningScope.targetLanguage)
      throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
    const card = content.cards[field.position];
    original =
      field.kind === "flashcard-meaning" ? card?.meaning : card?.examples[field.index]?.meaning;
  } else {
    const row = connection
      .prepare(
        "SELECT g.output_json, p.context_json FROM generated_activity_payloads g JOIN prepared_activities p USING(activity_id) WHERE activity_id = ?",
      )
      .get(request.activityId);
    if (!row) throw new Error("OD_TRANSLATION_SOURCE_NOT_FOUND");
    const content = readStoredExerciseContent(
      connection,
      request.activityId,
      storedJson(row["output_json"]),
    );
    if (
      content.contentId !== request.content.contentId ||
      content.revisionId !== request.content.revisionId
    )
      throw new Error("OD_TRANSLATION_REVISION_CONFLICT");
    if (content.language !== learningScope.targetLanguage)
      throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
    if (
      field.kind === "lesson-explanation" ||
      field.kind === "lesson-section" ||
      field.kind === "lesson-vocabulary"
    ) {
      const context = parseScopedActivityContext(connection, storedJson(row["context_json"]));
      // Course players display mission facts in place of the generated lesson.
      if (context.courseTeaching) throw new Error("OD_TRANSLATION_VISIBILITY_INVALID");
      const lesson = content.payload.lesson;
      original =
        field.kind === "lesson-explanation"
          ? lesson?.explanation
          : field.kind === "lesson-section"
            ? lesson?.sections[field.index]?.content
            : lesson?.vocabularyFoundations[field.index]?.explanation;
    } else {
      const candidate = content.payload.exercises[field.position];
      const attempt = connection
        .prepare(
          `SELECT a.status, a.exercise_snapshot_json, ans.answer_json, f.feedback_json, coalesce(s.hints_used, 0) AS hints_used
        FROM attempts a JOIN attempt_content_revisions r USING(attempt_id)
        LEFT JOIN answers ans ON ans.attempt_id = a.attempt_id AND ans.position = 0
        LEFT JOIN exercise_attempt_feedback f ON f.attempt_id = a.attempt_id
        LEFT JOIN exercise_support s ON s.attempt_id = a.attempt_id
        WHERE a.attempt_id = ? AND r.activity_id = ? AND r.content_revision_id = ?`,
        )
        .get(field.attemptId, request.activityId, content.revisionId);
      if (!candidate || !attempt || attempt["status"] === "abandoned")
        throw new Error("OD_TRANSLATION_VISIBILITY_INVALID");
      const snapshot = startedExerciseSnapshotSchema.parse(
        storedJson(attempt["exercise_snapshot_json"]),
      );
      if (
        !snapshot.exercise.contentReference ||
        snapshot.exercise.contentReference.exercise.revisionId !==
          content.exercises[field.position]?.revisionId ||
        snapshot.exercise.contentReference.contentId !== content.contentId ||
        snapshot.exercise.contentReference.revisionId !== content.revisionId
      )
        throw new Error("OD_TRANSLATION_REVISION_CONFLICT");
      // A historical attempt cannot unlock a newer attempt's unrevealed feedback.
      const active = connection
        .prepare(
          `SELECT a.attempt_id FROM attempts a JOIN exercises e USING(exercise_id) WHERE e.activity_id = ? AND a.status = 'in-progress' AND json_extract(a.exercise_snapshot_json, '$.exercise.contentReference.exercise.revisionId') = ?`,
        )
        .get(request.activityId, content.exercises[field.position]?.revisionId ?? "");
      if (active && active["attempt_id"] !== field.attemptId)
        throw new Error("OD_TRANSLATION_VISIBILITY_INVALID");
      const feedbackValue = attempt["feedback_json"] ? storedJson(attempt["feedback_json"]) : null;
      const feedback =
        feedbackValue && typeof feedbackValue === "object" && "output" in feedbackValue
          ? exerciseFeedbackCandidateSchema.parse(feedbackValue.output)
          : null;
      const answer = attempt["answer_json"]
        ? exerciseAnswerSchema.parse(storedJson(attempt["answer_json"]))
        : null;
      const evaluated =
        answer &&
        (evaluateExerciseAnswer(snapshot.exercise, answer, content.language).status !==
          "requires-ai" ||
          feedback);
      if (field.kind === "exercise-hint") {
        if (Number(attempt["hints_used"]) <= field.index)
          throw new Error("OD_TRANSLATION_VISIBILITY_INVALID");
        original = candidate.hints[field.index];
        hiddenAnswers =
          "acceptedAnswers" in candidate
            ? candidate.acceptedAnswers
            : candidate.kind === "fill-in-the-blank"
              ? candidate.blanks.flatMap((blank) => blank.acceptedAnswers)
              : candidate.kind === "multiple-choice"
                ? [candidate.options[candidate.correctOptionPosition] ?? ""]
                : [];
      } else {
        if (!evaluated) throw new Error("OD_TRANSLATION_VISIBILITY_INVALID");
        original =
          field.kind === "exercise-explanation"
            ? candidate.explanation
            : field.kind === "feedback-summary"
              ? feedback?.summary
              : field.kind === "feedback-strength"
                ? feedback?.strengths[field.index]
                : feedback?.improvements[field.index];
      }
    }
  }
  if (!original || !/\S/u.test(original)) throw new Error("OD_TRANSLATION_SOURCE_NOT_FOUND");
  return { original, learningScope, fieldKey: translationFieldKey(field), hiddenAnswers };
}
function readSaved(
  connection: DatabaseSync,
  request: TranslationRequest,
  current: ReturnType<typeof source>,
) {
  return connection
    .prepare(
      "SELECT language, translation_json FROM saved_supporting_translations WHERE activity_id = ? AND content_revision_id = ? AND field_key = ? ORDER BY language",
    )
    .all(request.activityId, request.content.revisionId, current.fieldKey)
    .map((row) => {
      const saved = savedTranslationSchema.parse(storedJson(row["translation_json"]));
      if (
        saved.language !== row["language"] ||
        saved.activityId !== request.activityId ||
        saved.content.contentId !== request.content.contentId ||
        saved.content.revisionId !== request.content.revisionId ||
        saved.fieldKey !== current.fieldKey ||
        saved.original !== current.original ||
        JSON.stringify(saved.learningScope) !== JSON.stringify(current.learningScope)
      )
        throw new Error("OD_TRANSLATION_SOURCE_INVALID");
      return saved;
    });
}
export async function readSavedTranslations(
  database: CallNinaDatabase,
  value: TranslationRequest,
  reveal?: TranslationReveal,
) {
  const request = translationRequestSchema.parse(value);
  if (request.rootGeneration !== database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
  return withLeasedConnection(database, (connection) => {
    const current = source(connection, request, reveal);
    return { ...current, translations: readSaved(connection, request, current) };
  });
}
export async function saveSupportingTranslation(
  database: CallNinaDatabase,
  value: TranslationRequest,
  savedValue: SavedTranslation,
  reveal?: TranslationReveal,
) {
  const request = translationRequestSchema.parse(value);
  const saved = savedTranslationSchema.parse(savedValue);
  if (request.rootGeneration !== database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
  return withLeasedTransaction(database, (connection) => {
    const current = source(connection, request, reveal);
    if (
      saved.activityId !== request.activityId ||
      saved.content.contentId !== request.content.contentId ||
      saved.content.revisionId !== request.content.revisionId ||
      saved.original !== current.original ||
      saved.fieldKey !== current.fieldKey ||
      JSON.stringify(saved.learningScope) !== JSON.stringify(current.learningScope)
    )
      throw new Error("OD_TRANSLATION_SOURCE_INVALID");
    // Never persist a newly revealed answer as a hint translation, even if the
    // provider expands rather than faithfully translating the source hint.
    const words = (text: string) =>
      text
        .normalize("NFKC")
        .toLocaleLowerCase(current.learningScope.targetLanguage)
        .match(/[\p{L}\p{N}]+/gu)
        ?.join(" ") ?? "";
    const translated = ` ${words(saved.text)} `;
    if (
      current.hiddenAnswers.some(
        (answer) => words(answer) && translated.includes(` ${words(answer)} `),
      )
    )
      throw new Error("OD_TRANSLATION_ANSWER_LEAK");
    const existing = readSaved(connection, request, current).find(
      (item) => item.language === saved.language,
    );
    if (existing) return existing;
    connection
      .prepare(
        `INSERT INTO saved_supporting_translations(activity_id, content_revision_id, field_key, language, feedback_attempt_id, translation_json) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.activityId,
        request.content.revisionId,
        current.fieldKey,
        saved.language,
        request.field.kind.startsWith("feedback-") && "attemptId" in request.field
          ? request.field.attemptId
          : null,
        JSON.stringify(saved),
      );
    return saved;
  });
}

/** Retain existing derived text when an entry point reuses the exact content.
 * Each copy has the new activity's deletion lifetime; feedback keeps its attempt owner.
 */
export function copySupportingTranslations(
  connection: DatabaseSync,
  sourceActivityId: string,
  targetActivityId: string,
  content: PortableExerciseContent,
) {
  assertStoredContentRevision(connection, sourceActivityId, content);
  assertStoredContentRevision(connection, targetActivityId, content);
  const sourceScope = activityLearningScope(connection, sourceActivityId);
  const targetScope = activityLearningScope(connection, targetActivityId);
  if (JSON.stringify(sourceScope) !== JSON.stringify(targetScope))
    throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
  const rows = connection
    .prepare(
      `SELECT field_key, language, translation_json FROM saved_supporting_translations WHERE activity_id = ? AND content_revision_id = ? AND feedback_attempt_id IS NULL`,
    )
    .all(sourceActivityId, content.revisionId);
  for (const row of rows) {
    const saved = savedTranslationSchema.parse(storedJson(row["translation_json"]));
    if (
      saved.activityId !== sourceActivityId ||
      saved.content.contentId !== content.contentId ||
      saved.content.revisionId !== content.revisionId ||
      saved.fieldKey !== row["field_key"] ||
      saved.language !== row["language"] ||
      saved.fieldKey.startsWith("feedback-") ||
      JSON.stringify(saved.learningScope) !== JSON.stringify(sourceScope)
    )
      throw new Error("OD_TRANSLATION_SOURCE_INVALID");
    connection
      .prepare(
        `INSERT INTO saved_supporting_translations(activity_id, content_revision_id, field_key, language, feedback_attempt_id, translation_json) VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        targetActivityId,
        content.revisionId,
        saved.fieldKey,
        saved.language,
        JSON.stringify({ ...saved, activityId: targetActivityId }),
      );
  }
}
