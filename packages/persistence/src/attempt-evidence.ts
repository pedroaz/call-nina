import { originatingDevice as device } from "./originating-device.js";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  attemptOwnershipSchema,
  attemptEventSchema,
  attemptEvidenceSchema,
  type AttemptOwnership,
  type AttemptEvent,
  type AttemptEvidence,
} from "@call-nina/contracts";
import {
  attemptEvidenceBasis,
  attemptFeedbackSchema,
  startedExerciseSnapshotSchema,
} from "@call-nina/domain";
import {
  assertLocalLearningScope,
  requireLocalLearningScope,
  parseScopedActivityContext,
} from "./learning-context.js";

const identity = (prefix: string, key: string) =>
  `${prefix}_${createHash("sha256").update(key).digest("hex")}`;
export function appendAttemptEvent(
  connection: DatabaseSync,
  attemptId: string,
  key: string,
  occurredAt: string | null,
  detail: AttemptEvent["detail"],
  historic = false,
) {
  const event = attemptEventSchema.parse({
    eventId: identity("attempt-event", `${attemptId}:${key}`),
    attemptId,
    originatingDeviceId: historic ? null : device(connection),
    occurredAt,
    detail,
  });
  const existing = connection
    .prepare("SELECT event_json FROM learning_attempt_events WHERE event_id = ?")
    .get(event.eventId);
  if (existing) {
    // The native record owns chronology. Re-reading that record must not create a second event.
    const previous = attemptEventSchema.parse(JSON.parse(String(existing["event_json"])));
    if (
      JSON.stringify(previous.detail) !== JSON.stringify(event.detail) ||
      previous.attemptId !== event.attemptId
    )
      throw new Error("OD_ATTEMPT_EVENT_CONFLICT");
    return;
  }
  if (
    Number(
      connection
        .prepare("SELECT count(*) AS count FROM learning_attempt_events WHERE attempt_id = ?")
        .get(attemptId)?.["count"],
    ) >= 250
  )
    throw new Error("OD_ATTEMPT_EVENT_LIMIT");
  connection
    .prepare(
      "INSERT INTO learning_attempt_events(event_id, attempt_id, event_json) VALUES (?, ?, ?)",
    )
    .run(event.eventId, attemptId, JSON.stringify(event));
}
function saveOwnership(
  connection: DatabaseSync,
  sourceKind: string,
  sourceId: string,
  ownership: AttemptOwnership,
) {
  const parsed = attemptOwnershipSchema.parse(ownership);
  const previous = connection
    .prepare("SELECT ownership_json FROM learning_attempts WHERE attempt_id = ?")
    .get(parsed.attemptId);
  if (previous) {
    const stored = attemptOwnershipSchema.parse(JSON.parse(String(previous["ownership_json"])));
    if (
      JSON.stringify(stored.source) !== JSON.stringify(parsed.source) ||
      JSON.stringify(stored.learningScope) !== JSON.stringify(parsed.learningScope) ||
      stored.courseRevision !== parsed.courseRevision ||
      stored.startedAt !== parsed.startedAt
    )
      throw new Error("OD_ATTEMPT_REVISION_MISMATCH");
    return stored;
  }
  connection
    .prepare(
      "INSERT INTO learning_attempts(attempt_id, source_kind, source_id, ownership_json) VALUES (?, ?, ?, ?)",
    )
    .run(parsed.attemptId, sourceKind, sourceId, JSON.stringify(parsed));
  return parsed;
}
function activityOwnership(connection: DatabaseSync, activityId: string) {
  const row = connection
    .prepare("SELECT context_json FROM prepared_activities WHERE activity_id = ?")
    .get(activityId);
  const context = row
    ? parseScopedActivityContext(connection, JSON.parse(String(row["context_json"])))
    : undefined;
  const revision = connection
    .prepare(
      `SELECT c.revision_id, m.material_id, c.material_revision_id,
    coalesce(json_extract(g.output_json, '$.contentId'), json_extract(f.content_json, '$.contentId')) AS content_id
    FROM activity_content_revisions c JOIN material_revisions m ON m.revision_id = c.material_revision_id
    LEFT JOIN generated_activity_payloads g USING(activity_id) LEFT JOIN flashcard_decks f USING(activity_id) WHERE c.activity_id = ?`,
    )
    .get(activityId);
  return {
    learningScope: context?.learningScope ?? requireLocalLearningScope(connection),
    courseRevision: context?.learningPath?.version ?? null,
    content: revision
      ? { contentId: String(revision["content_id"]), revisionId: String(revision["revision_id"]) }
      : null,
    materials: revision
      ? [
          {
            materialId: String(revision["material_id"]),
            revisionId: String(revision["material_revision_id"]),
          },
        ]
      : [],
    context,
  };
}
export function captureExerciseAttempt(
  connection: DatabaseSync,
  attemptId: string,
  historic = false,
) {
  const row = connection
    .prepare(
      `SELECT a.*, e.activity_id FROM attempts a JOIN exercises e USING(exercise_id) WHERE a.attempt_id = ?`,
    )
    .get(attemptId);
  if (!row) throw new Error("OD_ATTEMPT_NOT_FOUND");
  const snapshot = startedExerciseSnapshotSchema.parse(
    JSON.parse(String(row["exercise_snapshot_json"])),
  );
  const activityId = String(row["activity_id"]);
  const source = activityOwnership(connection, activityId);
  const reference = snapshot.exercise.contentReference;
  const retainedRevision = connection
    .prepare("SELECT content_revision_id FROM attempt_content_revisions WHERE attempt_id = ?")
    .get(attemptId);
  if (source.content && retainedRevision?.["content_revision_id"] !== source.content.revisionId)
    throw new Error("OD_ATTEMPT_REVISION_MISMATCH");
  if (
    reference &&
    (reference.revisionId !== source.content?.revisionId ||
      reference.contentId !== source.content.contentId ||
      JSON.stringify(reference.materials) !== JSON.stringify(source.materials))
  )
    throw new Error("OD_ATTEMPT_REVISION_MISMATCH");
  saveOwnership(
    connection,
    "exercise",
    attemptId,
    attemptOwnershipSchema.parse({
      attemptId,
      originatingDeviceId: historic ? null : device(connection),
      learningScope: source.learningScope,
      courseRevision: source.courseRevision,
      startedAt: row["started_at"],
      source: {
        kind: "exercise",
        activityId,
        exerciseId: row["exercise_id"],
        content: source.content,
        exerciseRevision: reference?.exercise ?? null,
        materials: source.materials,
      },
    }),
  );
  const startedAt = String(row["started_at"]);
  const answers = connection
    .prepare(
      "SELECT position, submitted_after_previous_event_ms FROM answers WHERE attempt_id = ? ORDER BY position",
    )
    .all(attemptId);
  let time = Date.parse(startedAt);
  for (const answer of answers) {
    time += Number(answer["submitted_after_previous_event_ms"]);
    appendAttemptEvent(
      connection,
      attemptId,
      `answer:${String(answer["position"])}`,
      new Date(time).toISOString(),
      { kind: "submitted-answer", position: Number(answer["position"]) },
      historic,
    );
  }
  const support = connection
    .prepare(
      `SELECT max(hints_used) AS hints, max(helper_used) AS helper, max(translation_used) AS translation FROM
    (SELECT hints_used, helper_used, translation_used FROM exercise_support WHERE attempt_id = ? UNION ALL
    SELECT hints_used, helper_used, translation_used FROM course_activity_support WHERE activity_id = ?)`,
    )
    .get(attemptId, activityId);
  const supports: Array<Extract<AttemptEvent["detail"], { kind: "assistance" }>["support"]> = [];
  if (Number(support?.["hints"]) > 0) supports.push("hint");
  if (Number(support?.["helper"]) > 0) supports.push("helper");
  if (Number(support?.["translation"]) > 0) supports.push("translation");
  if (source.context?.courseTeaching?.priorFeedback) supports.push("model-answer");
  if (source.context?.courseTeaching?.purpose === "practice") supports.push("practice");
  if (
    connection
      .prepare(
        `SELECT 1 FROM attempts a JOIN exercises e USING(exercise_id) JOIN activity_content_revisions c ON c.activity_id = e.activity_id WHERE c.revision_id = (SELECT revision_id FROM activity_content_revisions WHERE activity_id = ?) AND a.started_at < ? LIMIT 1`,
      )
      .get(activityId, startedAt)
  )
    supports.push("repeat-attempt");
  for (const support of supports)
    appendAttemptEvent(
      connection,
      attemptId,
      `support:${support}`,
      historic ? null : new Date().toISOString(),
      { kind: "assistance", support },
      historic,
    );
  if (row["status"] === "completed") {
    const feedback = attemptFeedbackSchema.parse(JSON.parse(String(row["feedback_json"])));
    appendAttemptEvent(
      connection,
      attemptId,
      "evaluation",
      new Date(
        Date.parse(startedAt) + Number(row["terminal_after_previous_event_ms"]),
      ).toISOString(),
      feedback.source.kind === "deterministic"
        ? { kind: "local-evaluation" }
        : { kind: "feedback", source: "ai", recordId: attemptId },
      historic,
    );
  }
}
export function captureVocabularyReview(
  connection: DatabaseSync,
  reviewId: string,
  historic = false,
) {
  const row = connection
    .prepare("SELECT * FROM vocabulary_reviews WHERE review_id = ?")
    .get(reviewId);
  if (!row) throw new Error("OD_VOCABULARY_REVIEW_NOT_FOUND");
  const attemptId = identity("attempt", `vocabulary:${reviewId}`);
  const entry = connection
    .prepare(
      "SELECT lemma, meaning, lexeme_json, examples_json FROM vocabulary_entries WHERE vocabulary_id = ?",
    )
    .get(String(row["vocabulary_id"]));
  saveOwnership(
    connection,
    "vocabulary-review",
    reviewId,
    attemptOwnershipSchema.parse({
      attemptId,
      originatingDeviceId: historic ? null : device(connection),
      learningScope: requireLocalLearningScope(connection),
      courseRevision: null,
      startedAt: row["reviewed_at"],
      source: {
        kind: "vocabulary-review",
        vocabularyId: row["vocabulary_id"],
        revision: row["expected_revision"],
        snapshot: historic
          ? null
          : {
              lemma: entry?.["lemma"],
              meaning: entry?.["meaning"],
              lexeme: JSON.parse(String(entry?.["lexeme_json"])) as unknown,
              examples: JSON.parse(String(entry?.["examples_json"])) as unknown,
            },
      },
    }),
  );
  appendAttemptEvent(
    connection,
    attemptId,
    "self-assessment",
    String(row["reviewed_at"]),
    { kind: "self-assessment", grade: row["grade"] as "again" | "hard" | "good" | "easy" },
    historic,
  );
}
export function captureActivityAttempt(
  connection: DatabaseSync,
  input: {
    attemptId: string;
    activityId: string;
    occurredAt: string;
    sourceKind: "external" | "listening";
    targetAttemptId?: string | null;
  },
  historic = false,
) {
  const source = activityOwnership(connection, input.activityId);
  const attemptId = input.targetAttemptId ?? input.attemptId;
  if (input.targetAttemptId) {
    const owner = readAttemptEvidence(connection, attemptId)?.ownership;
    if (
      owner?.source.kind === "exercise" &&
      !connection
        .prepare("SELECT 1 FROM attempts WHERE attempt_id = ? AND status = 'completed'")
        .get(attemptId)
    )
      throw new Error("OD_ATTEMPT_NOT_COMPLETED");
    if (
      !owner ||
      owner.source.kind === "vocabulary-review" ||
      owner.source.activityId !== input.activityId
    )
      throw new Error("OD_ATTEMPT_REVISION_MISMATCH");
  } else
    saveOwnership(
      connection,
      input.sourceKind,
      input.attemptId,
      attemptOwnershipSchema.parse({
        attemptId,
        originatingDeviceId: historic ? null : device(connection),
        learningScope: source.learningScope,
        courseRevision: source.courseRevision,
        startedAt: input.occurredAt,
        source: {
          kind: "activity",
          activityId: input.activityId,
          revision: 1,
          content: source.content,
          materials: source.materials,
        },
      }),
    );
  if (!input.targetAttemptId)
    appendAttemptEvent(
      connection,
      attemptId,
      "participation",
      input.occurredAt,
      { kind: "participation" },
      historic,
    );
  appendAttemptEvent(
    connection,
    attemptId,
    `feedback:${input.attemptId}`,
    input.occurredAt,
    { kind: "feedback", source: "external", recordId: input.attemptId },
    historic,
  );
}
export function readAttemptEvidence(
  connection: DatabaseSync,
  attemptId: string,
): AttemptEvidence | null {
  const row = connection
    .prepare("SELECT ownership_json FROM learning_attempts WHERE attempt_id = ?")
    .get(attemptId);
  if (!row) return null;
  const ownership = attemptOwnershipSchema.parse(JSON.parse(String(row["ownership_json"])));
  if (ownership.attemptId !== attemptId) throw new Error("OD_ATTEMPT_IDENTITY_MISMATCH");
  assertLocalLearningScope(connection, ownership.learningScope);
  const events = connection
    .prepare("SELECT event_json FROM learning_attempt_events WHERE attempt_id = ? ORDER BY rowid")
    .all(attemptId)
    .map((row) => attemptEventSchema.parse(JSON.parse(String(row["event_json"]))));
  if (events.some((event) => event.attemptId !== attemptId))
    throw new Error("OD_ATTEMPT_IDENTITY_MISMATCH");
  return attemptEvidenceSchema.parse({
    ownership,
    events,
    basis: attemptEvidenceBasis(ownership, events),
  });
}
export function historyAttemptEvidence(
  connection: DatabaseSync,
  historyEntryId: string,
): AttemptEvidence | null {
  const row = connection
    .prepare(
      `SELECT h.entity_kind, h.entity_id, f.target_attempt_id FROM history_entries h LEFT JOIN mcp_attempt_feedback f ON f.attempt_id = h.entity_id WHERE h.history_entry_id = ?`,
    )
    .get(historyEntryId);
  if (!row) return null;
  return readAttemptEvidence(
    connection,
    row["entity_kind"] === "vocabulary-review"
      ? identity("attempt", `vocabulary:${String(row["entity_id"])}`)
      : String(row["target_attempt_id"] ?? row["entity_id"]),
  );
}
export function migrateAttemptEvidence(connection: DatabaseSync) {
  for (const row of connection.prepare("SELECT attempt_id FROM attempts").all())
    captureExerciseAttempt(connection, String(row["attempt_id"]), true);
  for (const row of connection.prepare("SELECT review_id FROM vocabulary_reviews").all())
    captureVocabularyReview(connection, String(row["review_id"]), true);
  for (const row of connection.prepare("SELECT * FROM mcp_attempt_feedback").all())
    captureActivityAttempt(
      connection,
      {
        attemptId: String(row["attempt_id"]),
        activityId: String(row["activity_id"]),
        occurredAt: String(row["saved_at"]),
        sourceKind: "external",
      },
      true,
    );
}
