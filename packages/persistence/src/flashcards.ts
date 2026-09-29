import { requireLocalLearningScope, assertLocalLearningScope } from "./learning-context.js";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  activityIdSchema,
  flashcardSchema,
  flashcardDeckSchema,
  flashcardCreateRequestSchema,
  flashcardReadRequestSchema,
  flashcardProgressRequestSchema,
  flashcardSaveRequestSchema,
  preparedActivitySchema,
  vocabularyIdentity,
  vocabularyLemma,
  vocabularyIdSchema,
  z,
  type Flashcard,
  type FlashcardDeck,
} from "@call-nina/contracts";
import { aiProvenanceSchema } from "@call-nina/domain";
import { type CallNinaDatabase, withLeasedConnection, withLeasedTransaction } from "./sqlite.js";
import { claimIdempotentWrite } from "./idempotency.js";

function read(
  connection: DatabaseSync,
  database: CallNinaDatabase,
  activityId: string,
): FlashcardDeck {
  const row = connection
    .prepare(
      `SELECT d.*, p.title FROM flashcard_decks d JOIN prepared_activities p USING(activity_id) WHERE activity_id = ?`,
    )
    .get(activityId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("OD_FLASHCARD_NOT_FOUND");
  const vocabulary = connection
    .prepare(
      `SELECT l.position, l.vocabulary_id AS vocabularyId, v.status FROM flashcard_vocabulary_links l JOIN vocabulary_entries v USING(vocabulary_id) WHERE l.activity_id = ? ORDER BY l.position`,
    )
    .all(activityId);
  const deck = flashcardDeckSchema.parse({
    activityId,
    rootGeneration: database.rootGeneration,
    title: row["title"],
    source: row["source"],
    cards: JSON.parse(String(row["cards_json"])) as unknown,
    progress: {
      position: row["position"],
      completed: row["completed"] === 1,
      revision: row["revision"],
    },
    vocabulary,
  });
  if (
    deck.progress.position >= deck.cards.length ||
    (deck.progress.completed && deck.progress.position !== deck.cards.length - 1)
  )
    throw new Error("OD_FLASHCARD_PROGRESS_INVALID");
  return deck;
}
function assertRoot(database: CallNinaDatabase, root: number) {
  if (root !== database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
}
function insert(
  connection: DatabaseSync,
  database: CallNinaDatabase,
  activityValue: unknown,
  source: "generated" | "vocabulary",
  cardsValue: unknown,
  provenance: unknown,
  key: string,
  idempotencyRequest?: unknown,
) {
  const activity = preparedActivitySchema.parse(activityValue);
  assertLocalLearningScope(connection, activity.context.learningScope);
  if (activity.activityType !== "flashcards") throw new Error("OD_FLASHCARD_ACTIVITY_INVALID");
  const cards = z.array(flashcardSchema).min(3).max(30).parse(cardsValue);
  const claim = claimIdempotentWrite(connection, {
    operation: "prepared-activity",
    idempotencyKey: key,
    request: idempotencyRequest ?? { activity, cards, source, provenance },
    entityId: activity.activityId,
    recordedAt: activity.preparedAt,
  });
  if (!claim.replayed) {
    connection
      .prepare(
        `INSERT INTO prepared_activities(activity_id, activity_type, title, origin_surface, context_json, prepared_at, root_generation) VALUES (?, 'flashcards', ?, ?, ?, ?, ?)`,
      )
      .run(
        activity.activityId,
        activity.title,
        activity.originSurface,
        JSON.stringify(activity.context),
        activity.preparedAt,
        database.rootGeneration,
      );
    connection
      .prepare(
        `INSERT INTO flashcard_decks(activity_id, source, cards_json, provenance_json) VALUES (?, ?, ?, ?)`,
      )
      .run(
        activity.activityId,
        source,
        JSON.stringify(cards),
        provenance === null ? null : JSON.stringify(aiProvenanceSchema.parse(provenance)),
      );
  }
  return activity.activityId;
}
export async function saveGeneratedFlashcards(
  database: CallNinaDatabase,
  activity: unknown,
  cards: unknown,
  provenance: unknown,
  key: string,
) {
  return withLeasedTransaction(database, (connection) =>
    insert(connection, database, activity, "generated", cards, provenance, key),
  );
}
export async function readFlashcards(database: CallNinaDatabase, value: unknown) {
  const request = flashcardReadRequestSchema.parse(value);
  assertRoot(database, request.rootGeneration);
  return withLeasedConnection(database, (connection) =>
    read(connection, database, request.activityId),
  );
}
export async function createVocabularyFlashcards(
  database: CallNinaDatabase,
  value: unknown,
  key: string,
) {
  const request = flashcardCreateRequestSchema.parse(value);
  assertRoot(database, request.rootGeneration);
  const activityId = activityIdSchema.parse(
    `activity_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
  );
  return withLeasedTransaction(database, (connection) => {
    const existing = connection
      .prepare("SELECT 1 FROM flashcard_decks WHERE activity_id = ?")
      .get(activityId);
    if (existing) {
      claimIdempotentWrite(connection, {
        operation: "prepared-activity",
        idempotencyKey: key,
        request,
        entityId: activityId,
        recordedAt: new Date().toISOString(),
      });
      return read(connection, database, activityId);
    }
    const cards: Flashcard[] = request.entries.map((entry) => {
      const row = connection
        .prepare(
          "SELECT * FROM vocabulary_entries WHERE vocabulary_id = ? AND revision = ? AND updated_at = ?",
        )
        .get(entry.vocabularyId, entry.expectedRevision, entry.expectedUpdatedAt) as
        Record<string, unknown> | undefined;
      if (!row) throw new Error("OD_VOCABULARY_CONFLICT");
      return flashcardSchema.parse({
        lemma: row["lemma"],
        meaning: row["meaning"],
        lexeme: JSON.parse(String(row["lexeme_json"])) as unknown,
        examples: JSON.parse(String(row["examples_json"])) as unknown,
      });
    });
    insert(
      connection,
      database,
      {
        activityId,
        activityType: "flashcards",
        title: request.title,
        originSurface: "desktop",
        preparedAt: new Date().toISOString(),
        context: {
          learningScope: requireLocalLearningScope(connection),
          naturalRequest: request.title,
          curriculumTopicIds: [],
          mistakeIds: [],
          vocabularyIds: [],
        },
      },
      "vocabulary",
      cards,
      null,
      key,
      request,
    );
    request.entries.forEach((entry, position) =>
      connection
        .prepare("INSERT INTO flashcard_vocabulary_links VALUES (?, ?, ?)")
        .run(activityId, position, entry.vocabularyId),
    );
    return read(connection, database, activityId);
  });
}
export async function updateFlashcardProgress(database: CallNinaDatabase, value: unknown) {
  const request = flashcardProgressRequestSchema.parse(value);
  assertRoot(database, request.rootGeneration);
  return withLeasedTransaction(database, (connection) => {
    const deck = read(connection, database, request.activityId);
    if (
      request.position >= deck.cards.length ||
      (request.completed && request.position !== deck.cards.length - 1)
    )
      throw new Error("OD_FLASHCARD_PROGRESS_INVALID");
    if (
      deck.progress.position === request.position &&
      deck.progress.completed === request.completed &&
      deck.progress.revision === request.expectedRevision + 1
    )
      return deck;
    const result = connection
      .prepare(
        "UPDATE flashcard_decks SET position = ?, completed = ?, revision = revision + 1 WHERE activity_id = ? AND revision = ?",
      )
      .run(
        request.position,
        Number(request.completed),
        request.activityId,
        request.expectedRevision,
      );
    if (result.changes !== 1) throw new Error("OD_FLASHCARD_CONFLICT");
    return read(connection, database, request.activityId);
  });
}
export async function saveFlashcardVocabulary(
  database: CallNinaDatabase,
  value: unknown,
  key: string,
) {
  const request = flashcardSaveRequestSchema.parse(value);
  assertRoot(database, request.rootGeneration);
  return withLeasedTransaction(database, (connection) => {
    const deck = read(connection, database, request.activityId);
    if (deck.source !== "generated") throw new Error("OD_FLASHCARD_SOURCE_INVALID");
    const now = new Date().toISOString();
    const claim = claimIdempotentWrite(connection, {
      operation: "vocabulary-candidate",
      idempotencyKey: `flashcards:${key}`,
      request,
      entityId: request.activityId,
      recordedAt: now,
    });
    if (claim.replayed) return deck;
    const rows = connection
      .prepare(
        "SELECT vocabulary_id, lemma, meaning, lexeme_json FROM vocabulary_entries ORDER BY created_at, vocabulary_id",
      )
      .all() as { vocabulary_id: string; lemma: string; meaning: string; lexeme_json: string }[];
    const identities = new Map<string, string>();
    for (const row of rows) {
      const lexeme = flashcardSchema.shape.lexeme.parse(JSON.parse(row.lexeme_json) as unknown);
      const identity = vocabularyIdentity({ lemma: row.lemma, meaning: row.meaning, lexeme });
      if (!identities.has(identity)) identities.set(identity, row.vocabulary_id);
    }
    for (const position of request.positions) {
      const card = deck.cards[position];
      if (!card) throw new Error("OD_FLASHCARD_POSITION_INVALID");
      const linked = deck.vocabulary.find((entry) => entry.position === position);
      let vocabularyId = linked?.vocabularyId ?? identities.get(vocabularyIdentity(card));
      if (!vocabularyId) {
        vocabularyId = vocabularyIdSchema.parse(`vocabulary_${randomUUID().replaceAll("-", "")}`);
        // Explicitly saved words belong to the learner, so deleting a deck cannot delete them.
        connection
          .prepare(
            `INSERT INTO vocabulary_entries(vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            vocabularyId,
            vocabularyLemma(card),
            card.meaning,
            JSON.stringify(card.lexeme),
            JSON.stringify(card.examples),
            JSON.stringify({ kind: "learner", context: deck.title }),
            now,
            now,
          );
        identities.set(vocabularyIdentity(card), vocabularyId);
      }
      connection
        .prepare(
          `UPDATE vocabulary_entries SET status = 'active', confirmed_at = ?, due_on = ?, stage = 1, updated_at = ? WHERE vocabulary_id = ? AND status = 'candidate'`,
        )
        .run(now, now.slice(0, 10), now, vocabularyId);
      connection
        .prepare(
          `INSERT INTO flashcard_vocabulary_links VALUES (?, ?, ?) ON CONFLICT(activity_id, position) DO UPDATE SET vocabulary_id = excluded.vocabulary_id`,
        )
        .run(request.activityId, position, vocabularyId);
    }
    return read(connection, database, request.activityId);
  });
}
