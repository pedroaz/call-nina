import {
  contentIdentity,
  saveMaterialInTransaction,
  linkPortableContent,
  assertStoredContentRevision,
} from "./materials.js";
import {
  scopeForLanguage,
  assertLocalLearningScope,
  assertActivityReferences,
} from "./learning-context.js";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type Language,
  generationProvenanceSchema,
  activityIdSchema,
  targetLanguageSchema,
  portableFlashcardContentSchema,
  type PortableFlashcardContent,
  type learningGoalSchema,
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
    content: readFlashcardContent(row["content_json"]),
    progress: {
      position: row["position"],
      completed: row["completed"] === 1,
      revision: row["revision"],
    },
    vocabulary,
  });
  assertStoredContentRevision(connection, activityId, deck.content);
  if ((deck.source === "generated") !== "modelId" in deck.content.provenance)
    throw new Error("OD_CONTENT_PROVENANCE_INVALID");
  if (
    deck.progress.position >= deck.content.cards.length ||
    (deck.progress.completed && deck.progress.position !== deck.content.cards.length - 1)
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
  contentGoal: { learnerGoal: z.infer<typeof learningGoalSchema> | null; topic: string },
  idempotencyRequest?: unknown,
) {
  const activity = preparedActivitySchema.parse(activityValue);
  assertActivityReferences(connection, activity.context);
  if (activity.activityType !== "flashcards") throw new Error("OD_FLASHCARD_ACTIVITY_INVALID");
  const cards = z.array(flashcardSchema).min(3).max(30).parse(cardsValue);
  const claim = claimIdempotentWrite(connection, {
    operation: "prepared-activity",
    idempotencyKey: key,
    request: idempotencyRequest ?? { activity, cards, source, provenance, contentGoal },
    entityId: activity.activityId,
    recordedAt: activity.preparedAt,
  });
  if (!claim.replayed) {
    const content = prepareFlashcardContent(
      connection,
      activity,
      source,
      cards,
      provenance,
      contentGoal,
    );
    connection
      .prepare(
        `INSERT INTO prepared_activities(target_language, activity_id, activity_type, title, origin_surface, context_json, prepared_at, root_generation) VALUES (?, ?, 'flashcards', ?, ?, ?, ?, ?)`,
      )
      .run(
        activity.context.learningScope.targetLanguage,
        activity.activityId,
        activity.title,
        activity.originSurface,
        JSON.stringify(activity.context),
        activity.preparedAt,
        database.rootGeneration,
      );
    connection
      .prepare(`INSERT INTO flashcard_decks(activity_id, source, content_json) VALUES (?, ?, ?)`)
      .run(activity.activityId, source, JSON.stringify(content));
    linkPortableContent(connection, activity.activityId, content, "inline-created");
  }
  return activity.activityId;
}
export async function saveGeneratedFlashcards(
  database: CallNinaDatabase,
  activity: unknown,
  cards: unknown,
  provenance: unknown,
  contentGoal: { learnerGoal: z.infer<typeof learningGoalSchema>; topic: string },
  key: string,
) {
  return withLeasedTransaction(database, (connection) =>
    insert(connection, database, activity, "generated", cards, provenance, key, contentGoal),
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
    let sourceLanguage: Language | undefined;
    const cards: Flashcard[] = request.entries.map((entry) => {
      const row = connection
        .prepare(
          "SELECT * FROM vocabulary_entries WHERE vocabulary_id = ? AND revision = ? AND updated_at = ?",
        )
        .get(entry.vocabularyId, entry.expectedRevision, entry.expectedUpdatedAt) as
        Record<string, unknown> | undefined;
      if (!row) throw new Error("OD_VOCABULARY_CONFLICT");
      const language = targetLanguageSchema.parse(row["target_language"]);
      if (sourceLanguage && sourceLanguage !== language)
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      sourceLanguage = language;
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
          learningScope: {
            ...scopeForLanguage(connection, targetLanguageSchema.parse(sourceLanguage)),
            courseId: null,
          },
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
      { learnerGoal: null, topic: request.title },
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
      request.position >= deck.content.cards.length ||
      (request.completed && request.position !== deck.content.cards.length - 1)
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
        "SELECT vocabulary_id, lemma, meaning, lexeme_json FROM vocabulary_entries WHERE target_language = ? ORDER BY created_at, vocabulary_id",
      )
      .all(deck.content.language) as {
      vocabulary_id: string;
      lemma: string;
      meaning: string;
      lexeme_json: string;
    }[];
    const identities = new Map<string, string>();
    for (const row of rows) {
      const lexeme = flashcardSchema.shape.lexeme.parse(JSON.parse(row.lexeme_json) as unknown);
      const identity = vocabularyIdentity({ lemma: row.lemma, meaning: row.meaning, lexeme });
      if (!identities.has(identity)) identities.set(identity, row.vocabulary_id);
    }
    for (const position of request.positions) {
      const card = deck.content.cards[position];
      if (!card) throw new Error("OD_FLASHCARD_POSITION_INVALID");
      const linked = deck.vocabulary.find((entry) => entry.position === position);
      let vocabularyId = linked?.vocabularyId ?? identities.get(vocabularyIdentity(card));
      if (!vocabularyId) {
        vocabularyId = vocabularyIdSchema.parse(`vocabulary_${randomUUID().replaceAll("-", "")}`);
        // Explicitly saved words belong to the learner, so deleting a deck cannot delete them.
        connection
          .prepare(
            `INSERT INTO vocabulary_entries(target_language, vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            deck.content.language,
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

function readFlashcardContent(value: unknown): PortableFlashcardContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value)) as unknown;
  } catch {
    throw new Error("OD_CONTENT_INVALID");
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    parsed.schemaVersion !== 1
  )
    throw new Error("OD_CONTENT_VERSION_UNSUPPORTED");
  const result = portableFlashcardContentSchema.safeParse(parsed);
  if (!result.success) throw new Error("OD_CONTENT_INVALID");
  return result.data;
}

function prepareFlashcardContent(
  connection: DatabaseSync,
  activity: z.infer<typeof preparedActivitySchema>,
  source: "generated" | "vocabulary",
  cards: Flashcard[],
  provenanceValue: unknown,
  goal: { learnerGoal: z.infer<typeof learningGoalSchema> | null; topic: string },
): PortableFlashcardContent {
  const ai = provenanceValue === null ? null : generationProvenanceSchema.parse(provenanceValue);
  if ((source === "generated" && ai === null) || (source === "vocabulary" && ai !== null))
    throw new Error("OD_CONTENT_PROVENANCE_INVALID");
  const material = saveMaterialInTransaction(
    connection,
    {
      kind: "topic",
      title: activity.title,
      language: activity.context.learningScope.targetLanguage,
      text: goal.topic,
    },
    activity.preparedAt,
  );
  return portableFlashcardContentSchema.parse({
    schemaVersion: 1,
    kind: "flashcard-deck",
    contentId: contentIdentity("content"),
    revisionId: contentIdentity("content-revision"),
    title: activity.title,
    language: activity.context.learningScope.targetLanguage,
    createdAt: activity.preparedAt,
    goal: {
      learnerGoal: goal.learnerGoal,
      courseId: activity.context.learningScope.courseId,
      request: activity.context.naturalRequest,
      curriculumTopicIds: activity.context.curriculumTopicIds,
    },
    materials: [material],
    assets: [],
    provenance: ai ?? { producer: "local-vocabulary" },
    evaluation: "self-assessment",
    cardRevisions: cards.map(() => ({
      cardId: contentIdentity("content-card"),
      revisionId: contentIdentity("card-revision"),
    })),
    cards,
  });
}

/** Migration 25 only: preserve immutable cards and all mutable progress/link rows. */
export function migrateFlashcardContent(connection: DatabaseSync) {
  const rows = connection
    .prepare(
      `SELECT d.*, p.title, p.origin_surface, p.context_json, p.prepared_at
    FROM flashcard_decks d JOIN prepared_activities p USING(activity_id)`,
    )
    .all();
  for (const row of rows) {
    const activity = preparedActivitySchema.parse({
      activityId: row["activity_id"],
      activityType: "flashcards",
      title: row["title"],
      originSurface: row["origin_surface"],
      context: JSON.parse(String(row["context_json"])) as unknown,
      preparedAt: row["prepared_at"],
    });
    assertLocalLearningScope(connection, activity.context.learningScope);
    const cards = z
      .array(flashcardSchema)
      .min(3)
      .max(30)
      .parse(JSON.parse(String(row["content_json"])));
    const position = z
      .int()
      .min(0)
      .max(cards.length - 1)
      .parse(row["position"]);
    if (row["completed"] === 1 && position !== cards.length - 1)
      throw new Error("OD_FLASHCARD_PROGRESS_INVALID");
    const legacyProvenance =
      row["provenance_json"] === null
        ? null
        : aiProvenanceSchema.parse(JSON.parse(String(row["provenance_json"])) as unknown);
    if (legacyProvenance && legacyProvenance.modelSelection.availability !== "reported")
      throw new Error("OD_CONTENT_PROVENANCE_INVALID");
    const content = prepareFlashcardContent(
      connection,
      activity,
      z.enum(["generated", "vocabulary"]).parse(row["source"]),
      cards,
      legacyProvenance?.modelSelection.availability === "reported"
        ? {
            producer: "codex",
            modelId: legacyProvenance.modelSelection.modelId,
            effortId: legacyProvenance.modelSelection.effortId,
          }
        : null,
      { learnerGoal: null, topic: activity.context.naturalRequest },
    );
    connection
      .prepare("UPDATE flashcard_decks SET content_json = ? WHERE activity_id = ?")
      .run(JSON.stringify(content), activity.activityId);
    linkPortableContent(connection, activity.activityId, content, "reused-or-historic");
  }
  connection.exec(`ALTER TABLE flashcard_decks DROP COLUMN provenance_json;
    CREATE TRIGGER flashcard_content_immutable BEFORE UPDATE OF activity_id, source, content_json ON flashcard_decks
    BEGIN SELECT RAISE(ABORT, 'OD_CONTENT_REVISION_IMMUTABLE'); END;`);
}
