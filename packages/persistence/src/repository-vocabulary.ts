import {
  activityIdSchema,
  calendarDateSchema,
  curriculumTopicIdSchema,
  historyEntryIdSchema,
  reviewIdSchema,
  sessionIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  vocabularyBulkRequestSchema,
  vocabularyCountsSchema,
  vocabularyIdSchema,
  vocabularyLibraryFilterSchema,
  vocabularySummarySchema,
  z,
  type LearningScope,
} from "@call-nina/contracts";
import {
  scheduleVocabularyReview,
  vocabularyEntrySchema,
  vocabularyExampleSchema,
  vocabularyLessonSetRequestSchema,
  type VocabularyEntry,
  type VocabularyLessonSetRequest,
} from "@call-nina/domain";
import { createHash } from "node:crypto";
import { captureVocabularyReview } from "./attempt-evidence.js";
import { claimIdempotentWrite, type IdempotentWriteResult } from "./idempotency.js";
import {
  assertRegisteredLearningScope as assertLocalLearningScope,
  requireLocalLearningScope,
  scopeForLanguage,
  vocabularySearchPolicy,
} from "./learning-context.js";
import {
  type VocabularyLessonSetRecord,
  type VocabularyRecord,
  type VocabularyReviewSession,
  parseJson,
  stringifyBounded,
  vocabularyEntryFromRow,
  vocabularyLessonSetRecordSchema,
  vocabularyRecordFromRow,
  vocabularyReviewSessionSchema,
} from "./repository-support.js";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";

export class VocabularyRepository {
  readonly #database: CallNinaDatabase;
  constructor(database: CallNinaDatabase) {
    this.#database = database;
  }

  async addVocabularyCandidate(
    entryValue: VocabularyEntry,
    createdAtValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const entry = vocabularyEntrySchema.parse(entryValue);
    const createdAt = utcInstantSchema.parse(createdAtValue);
    if (entry.state.status !== "candidate") throw new Error("OD_VOCABULARY_CANDIDATE_REQUIRED");
    return withLeasedTransaction(this.#database, (connection) => {
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-candidate",
        idempotencyKey,
        request: entry,
        entityId: entry.vocabularyId,
        recordedAt: createdAt,
      });
      if (claim.replayed) return claim;
      scopeForLanguage(connection, entry.targetLanguage);
      connection
        .prepare(
          `INSERT INTO vocabulary_entries (target_language,
            vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.targetLanguage,
          entry.vocabularyId,
          entry.lemma,
          entry.meaning,
          stringifyBounded(entry.lexeme),
          stringifyBounded(entry.examples),
          stringifyBounded(entry.source),
          createdAt,
          createdAt,
        );
      return claim;
    });
  }

  async saveVocabularyLessonSet(
    requestValue: VocabularyLessonSetRequest,
    entriesValue: readonly VocabularyEntry[],
    setIdValue: string,
    createdAtValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const request = vocabularyLessonSetRequestSchema.parse(requestValue);
    const entries = z.array(vocabularyEntrySchema).max(50).parse(entriesValue);
    const setId = activityIdSchema.parse(setIdValue);
    const createdAt = utcInstantSchema.parse(createdAtValue);
    if (entries.length === 0) throw new Error("OD_VOCABULARY_LESSON_SET_EMPTY");
    if (
      new Set(entries.map(({ vocabularyId }) => vocabularyId)).size !== entries.length ||
      entries.some(({ state }) => state.status !== "candidate") ||
      entries.some((entry) => entry.targetLanguage !== request.learningScope.targetLanguage)
    ) {
      throw new Error("OD_VOCABULARY_LESSON_SET_ENTRIES_INVALID");
    }
    return withLeasedTransaction(this.#database, (connection) => {
      assertLocalLearningScope(connection, request.learningScope);
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-candidate",
        idempotencyKey,
        request: { request, entries, setId },
        entityId: setId,
        recordedAt: createdAt,
      });
      if (claim.replayed) return claim;
      connection
        .prepare(
          `INSERT INTO vocabulary_lesson_sets (target_language,
            set_id, title, requested_from, natural_request, source_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.learningScope.targetLanguage,
          setId,
          request.title,
          request.requestedFrom,
          request.naturalRequest,
          stringifyBounded({
            goal: request.goal ?? null,
            topic: request.topic ?? null,
            curriculumTopicIds: request.curriculumTopicIds,
            mistakeCategories: request.mistakeCategories,
          }),
          createdAt,
        );
      const insertEntry = connection.prepare(
        `INSERT INTO vocabulary_entries (target_language,
          vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertItem = connection.prepare(
        `INSERT INTO vocabulary_lesson_set_items (set_id, position, vocabulary_id)
         VALUES (?, ?, ?)`,
      );
      for (const [position, entry] of entries.entries()) {
        const existing = connection
          .prepare(`SELECT status, lemma, meaning FROM vocabulary_entries WHERE vocabulary_id = ?`)
          .get(entry.vocabularyId) as Record<string, unknown> | undefined;
        if (existing === undefined) {
          insertEntry.run(
            entry.targetLanguage,
            entry.vocabularyId,
            entry.lemma,
            entry.meaning,
            stringifyBounded(entry.lexeme),
            stringifyBounded(entry.examples),
            stringifyBounded(entry.source),
            createdAt,
            createdAt,
          );
        } else if (
          existing["status"] !== "candidate" ||
          existing["lemma"] !== entry.lemma ||
          existing["meaning"] !== entry.meaning
        ) {
          throw new Error("OD_VOCABULARY_LESSON_SET_ENTRY_CONFLICT");
        }
        insertItem.run(setId, position, entry.vocabularyId);
      }
      return claim;
    });
  }

  async listVocabularyLessonSets(): Promise<readonly VocabularyLessonSetRecord[]> {
    return withLeasedConnection(this.#database, (connection) => {
      const sets = connection
        .prepare(
          `SELECT set_id, title, requested_from, natural_request, source_json, created_at
           FROM (SELECT * FROM vocabulary_lesson_sets WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) ORDER BY created_at DESC, set_id LIMIT 50`,
        )
        .all() as Record<string, unknown>[];
      return Object.freeze(
        sets.map((row) => {
          const items = connection
            .prepare(
              `SELECT position, vocabulary_id FROM vocabulary_lesson_set_items
               WHERE set_id = ? ORDER BY position`,
            )
            .all(z.string().parse(row["set_id"]))
            .map((item) => ({
              position: z.int().min(0).max(49).parse(item["position"]),
              vocabularyId: vocabularyIdSchema.parse(item["vocabulary_id"]),
            }));
          const source = strictBoundaryObject({
            goal: z.string().min(1).max(500).nullable(),
            topic: z.string().min(1).max(160).nullable(),
            curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
            mistakeCategories: z.array(z.string().min(1).max(120)).max(12),
          }).parse(parseJson(row["source_json"]));
          return vocabularyLessonSetRecordSchema.parse({
            setId: row["set_id"],
            title: row["title"],
            requestedFrom: row["requested_from"],
            naturalRequest: row["natural_request"],
            ...source,
            createdAt: row["created_at"],
            items,
          });
        }),
      );
    });
  }

  async reviewVocabularyCard(
    inputValue: Readonly<{
      vocabularyId: string;
      grade: "again" | "hard" | "good" | "easy";
      retrieval: "recognition" | "recall" | "use";
      reviewedAt: string;
      expectedRevision?: number;
      expectedUpdatedAt?: string;
      idempotencyKey: string;
    }>,
  ): Promise<IdempotentWriteResult & { dueOn: string }> {
    const input = z
      .strictObject({
        vocabularyId: vocabularyIdSchema,
        grade: z.enum(["again", "hard", "good", "easy"]),
        retrieval: z.enum(["recognition", "recall", "use"]),
        reviewedAt: utcInstantSchema,
        expectedRevision: z.int().nonnegative().optional(),
        expectedUpdatedAt: utcInstantSchema.optional(),
        idempotencyKey: z.string().min(8).max(128),
      })
      .parse(inputValue);
    const reviewId = reviewIdSchema.parse(
      `review_${createHash("sha256").update(input.idempotencyKey).digest("hex")}`,
    );
    const historyEntryId = historyEntryIdSchema.parse(
      `history-entry_${reviewId.slice("review_".length)}`,
    );
    const { reviewedAt, idempotencyKey, ...command } = input;
    const retrieval = input.retrieval;
    return withLeasedTransaction(this.#database, (connection) => {
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-review",
        idempotencyKey,
        request: command,
        entityId: reviewId,
        recordedAt: reviewedAt,
      });
      if (claim.replayed) {
        const saved = connection
          .prepare("SELECT next_due_on FROM vocabulary_reviews WHERE review_id = ?")
          .get(reviewId);
        if (!saved) throw new Error("OD_VOCABULARY_REVIEW_NOT_FOUND");
        return { ...claim, dueOn: calendarDateSchema.parse(saved["next_due_on"]) };
      }
      const entryRow = connection
        .prepare("SELECT * FROM vocabulary_entries WHERE vocabulary_id = ? AND status = 'active'")
        .get(input.vocabularyId);
      if (
        !entryRow ||
        (input.expectedRevision !== undefined &&
          (entryRow["revision"] !== input.expectedRevision ||
            entryRow["updated_at"] !== input.expectedUpdatedAt))
      )
        throw new Error("OD_VOCABULARY_REVIEW_STATE_CONFLICT");
      const entry = vocabularyEntryFromRow(entryRow);
      if (entry.state.status !== "active") throw new Error("OD_VOCABULARY_NOT_ACTIVE");
      const schedule = connection
        .prepare(
          "SELECT next_due_on, next_stage FROM vocabulary_reviews WHERE vocabulary_id = ? AND retrieval = ? ORDER BY expected_revision DESC LIMIT 1",
        )
        .get(input.vocabularyId, retrieval);
      if (
        String(schedule?.["next_due_on"] ?? entry.state.confirmedAt.slice(0, 10)) >
        reviewedAt.slice(0, 10)
      )
        throw new Error("OD_VOCABULARY_REVIEW_STATE_CONFLICT");
      const review = scheduleVocabularyReview({
        vocabularyId: input.vocabularyId,
        expectedActiveState: entry.state,
        reviewId,
        reviewedAt,
        grade: input.grade,
        retrievalStage: z
          .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
          .parse(schedule?.["next_stage"] ?? 1),
      });
      const expected = review.transition.expectedActiveState;
      const row = connection
        .prepare(
          `SELECT revision, confirmed_at, due_on, stage, last_review_id
           FROM vocabulary_entries WHERE vocabulary_id = ? AND status = 'active'`,
        )
        .get(review.vocabularyId) as Record<string, unknown> | undefined;
      const expectedLastReviewId =
        expected.schedule.status === "reviewed" ? expected.schedule.lastReview.reviewId : null;
      if (
        row === undefined ||
        (input.expectedRevision !== undefined && row["revision"] !== input.expectedRevision) ||
        row["confirmed_at"] !== expected.confirmedAt ||
        row["due_on"] !== expected.schedule.dueOn ||
        row["stage"] !== expected.schedule.stage ||
        row["last_review_id"] !== expectedLastReviewId ||
        !Number.isSafeInteger(row["revision"])
      ) {
        throw new Error("OD_VOCABULARY_REVIEW_STATE_CONFLICT");
      }
      const revision = row["revision"] as number;
      const result = review.transition.result;
      connection
        .prepare(
          `INSERT INTO vocabulary_reviews (
            review_id, vocabulary_id, expected_revision, reviewed_at, grade, next_due_on, next_stage, retrieval
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          result.reviewId,
          review.vocabularyId,
          revision,
          result.reviewedAt,
          result.grade,
          result.nextSchedule.dueOn,
          result.nextSchedule.stage,
          retrieval,
        );
      captureVocabularyReview(connection, result.reviewId);
      const titleRow = connection
        .prepare(`SELECT lemma FROM vocabulary_entries WHERE vocabulary_id = ?`)
        .get(review.vocabularyId) as { lemma: string } | undefined;
      if (!titleRow) throw new Error("OD_VOCABULARY_NOT_FOUND");
      connection
        .prepare(
          `INSERT INTO history_entries (
              history_entry_id, entity_kind, entity_id, skill, activity_type, title,
              occurred_at, reconstruction_json, root_generation
            ) VALUES (?, 'vocabulary-review', ?, 'reading', 'vocabulary-review', ?, ?, ?, ?)`,
        )
        .run(
          historyEntryId,
          result.reviewId,
          titleRow.lemma,
          result.reviewedAt,
          stringifyBounded({
            vocabularyId: review.vocabularyId,
            grade: result.grade,
            nextDueOn: result.nextSchedule.dueOn,
            nextStage: result.nextSchedule.stage,
          }),
          this.#database.rootGeneration,
        );

      return { ...claim, dueOn: review.transition.result.nextSchedule.dueOn };
    });
  }

  async confirmVocabulary(
    vocabularyId: string,
    confirmedAtValue: string,
    dueOnValue: string,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    vocabularyId = vocabularyIdSchema.parse(vocabularyId);
    const confirmedAt = utcInstantSchema.parse(confirmedAtValue);
    const dueOn = calendarDateSchema.parse(dueOnValue);
    if (dueOn < confirmedAt.slice(0, 10)) {
      throw new Error("OD_VOCABULARY_CONFIRM_DATE_INVALID");
    }
    return withLeasedTransaction(this.#database, (connection) => {
      const claim = claimIdempotentWrite(connection, {
        operation: "vocabulary-confirmation",
        idempotencyKey,
        request: { vocabularyId, confirmedAt, dueOn },
        entityId: vocabularyId,
        recordedAt: confirmedAt,
      });
      if (claim.replayed) return claim;
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET status = 'active', confirmed_at = ?, due_on = ?, stage = 1,
            updated_at = ? WHERE vocabulary_id = ? AND status = 'candidate'`,
        )
        .run(confirmedAt, dueOn, confirmedAt, vocabularyId);
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_CONFIRM_STATE_CONFLICT");
      return claim;
    });
  }

  async readVocabularyLibrary(
    input: z.input<typeof vocabularyLibraryFilterSchema>,
    todayValue: string,
  ) {
    const filter = vocabularyLibraryFilterSchema.parse(input);
    const today = calendarDateSchema.parse(todayValue);
    return withLeasedConnection(this.#database, (connection) => {
      const { fold, normalize } = vocabularySearchPolicy(connection);
      const search = normalize(filter.search);
      const where = `(? = '' OR instr(${fold("lemma")}, ?) > 0 OR instr(${fold("meaning")}, ?) > 0)
        AND (? = 'all' OR status = ? OR (? = 'due' AND status = 'active' AND due_on <= ?))`;
      const parameters = [
        search,
        search,
        search,
        filter.filter,
        filter.filter,
        filter.filter,
        today,
      ];
      const total = z
        .int()
        .nonnegative()
        .parse(
          connection
            .prepare(
              `SELECT COUNT(*) AS count FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) WHERE ${where}`,
            )
            .get(...parameters)?.["count"],
        );
      const page = Math.min(filter.page, Math.max(0, Math.ceil(total / 30) - 1));
      const order =
        filter.sort === "due"
          ? `due_on IS NULL, due_on, ${fold("lemma")}, vocabulary_id`
          : `${fold("lemma")}, vocabulary_id`;
      const entries = connection
        .prepare(
          `SELECT vocabulary_id, lemma, meaning, status, due_on, revision, updated_at
         FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) WHERE ${where} ORDER BY ${order} LIMIT 30 OFFSET ?`,
        )
        .all(...parameters, page * 30)
        .map((row) =>
          vocabularySummarySchema.parse({
            vocabularyId: row["vocabulary_id"],
            lemma: row["lemma"],
            meaning: row["meaning"],
            status: row["status"],
            dueOn: row["due_on"],
            revision: row["revision"],
            updatedAt: row["updated_at"],
          }),
        );
      const counts = vocabularyCountsSchema.parse(
        connection
          .prepare(
            `SELECT COUNT(*) AS "all",
        COUNT(CASE WHEN status = 'candidate' THEN 1 END) AS candidate,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS active,
        COUNT(CASE WHEN status = 'suspended' THEN 1 END) AS suspended,
        COUNT(CASE WHEN status = 'active' AND due_on <= ? THEN 1 END) AS due
        FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1))`,
          )
          .get(today),
      );
      return { entries, total, page, counts };
    });
  }

  async readVocabularyRecord(id: string): Promise<VocabularyRecord | undefined> {
    const vocabularyId = vocabularyIdSchema.parse(id);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare("SELECT * FROM vocabulary_entries WHERE vocabulary_id = ?")
        .get(vocabularyId);
      return row ? vocabularyRecordFromRow(row) : undefined;
    });
  }

  async readVocabularyRetrievalSchedules(id: string) {
    return withLeasedConnection(this.#database, (connection) => {
      const entry = connection
        .prepare(
          "SELECT confirmed_at FROM vocabulary_entries WHERE vocabulary_id = ? AND status = 'active'",
        )
        .get(id) as { confirmed_at: string } | undefined;
      if (!entry) throw new Error("OD_VOCABULARY_NOT_ACTIVE");
      return (["recognition", "recall", "use"] as const).map((retrieval) => {
        const row = connection
          .prepare(
            "SELECT next_due_on, next_stage FROM vocabulary_reviews WHERE vocabulary_id = ? AND retrieval = ? ORDER BY expected_revision DESC LIMIT 1",
          )
          .get(id, retrieval) as { next_due_on: string; next_stage: number } | undefined;
        return {
          retrieval,
          dueOn: row?.next_due_on ?? entry.confirmed_at.slice(0, 10),
          stage: z
            .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
            .parse(row?.next_stage ?? 1),
        };
      });
    });
  }

  async readVocabularyReviewQueue(todayValue: string): Promise<readonly VocabularyRecord[]> {
    const today = calendarDateSchema.parse(todayValue);
    return withLeasedConnection(this.#database, (connection) =>
      connection
        .prepare(
          "SELECT * FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) WHERE status = 'active' AND due_on <= ? ORDER BY due_on, vocabulary_id LIMIT 20",
        )
        .all(today)
        .map(vocabularyRecordFromRow),
    );
  }

  async mutateVocabularyBulk(
    input: z.infer<typeof vocabularyBulkRequestSchema>,
    atValue: string,
  ): Promise<void> {
    const { action, entries, rootGeneration } = vocabularyBulkRequestSchema.parse(input);
    const at = utcInstantSchema.parse(atValue);
    if (rootGeneration !== this.#database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
    await withLeasedTransaction(this.#database, (connection) => {
      const status =
        action === "confirm" ? "candidate" : action === "suspend" ? "active" : "suspended";
      const update =
        action === "confirm"
          ? "status = 'active', confirmed_at = ?, due_on = substr(?, 1, 10), stage = 1, revision = revision + 1"
          : action === "suspend"
            ? "status = 'suspended', suspended_at = ?, suspension_reason = 'learner-paused', revision = revision + 1"
            : "status = 'active', suspended_at = NULL, suspension_reason = NULL, revision = revision + 1";
      const statement = connection.prepare(`UPDATE vocabulary_entries SET ${update}, updated_at = ?
        WHERE vocabulary_id = ? AND status = ? AND revision = ? AND updated_at = ? AND updated_at < ?`);
      for (const entry of entries) {
        const dates = action === "confirm" ? [at, at] : action === "suspend" ? [at] : [];
        const result = statement.run(
          ...dates,
          at,
          entry.vocabularyId,
          status,
          entry.expectedRevision,
          entry.expectedUpdatedAt,
          at,
        );
        if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
      }
    });
  }

  async listVocabularyRecords(
    status?: "candidate" | "active" | "suspended",
  ): Promise<readonly VocabularyRecord[]> {
    return withLeasedConnection(this.#database, (connection) => {
      const rows = status
        ? connection
            .prepare(
              `SELECT * FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) WHERE status = ? ORDER BY lemma, vocabulary_id`,
            )
            .all(status)
        : connection
            .prepare(
              `SELECT * FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) ORDER BY lemma, vocabulary_id`,
            )
            .all();
      return rows.map((row) => {
        const record = row as Record<string, unknown>;
        return Object.freeze({
          entry: vocabularyEntryFromRow(record),
          revision: z.int().nonnegative().parse(record["revision"]),
          updatedAt: utcInstantSchema.parse(record["updated_at"]),
        });
      });
    });
  }

  async editVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      expectedUpdatedAt?: string;
      lemma: string;
      meaning: string;
      example: { text: string; meaning: string };
      updatedAt: string;
    }>,
  ): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(input.vocabularyId);
    const updatedAt = utcInstantSchema.parse(input.updatedAt);
    const lemma = z.string().min(1).max(160).regex(/\S/u).parse(input.lemma);
    const meaning = z.string().min(1).max(500).regex(/\S/u).parse(input.meaning);
    const examples = z.array(vocabularyExampleSchema).length(1).parse([input.example]);
    await withLeasedTransaction(this.#database, (connection) => {
      const existing = connection
        .prepare("SELECT examples_json FROM vocabulary_entries WHERE vocabulary_id = ?")
        .get(vocabularyId);
      if (!existing) throw new Error("OD_VOCABULARY_NOT_FOUND");
      const savedExamples = z
        .array(vocabularyExampleSchema)
        .min(1)
        .max(12)
        .parse(parseJson(existing["examples_json"]));
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET lemma = ?, meaning = ?, examples_json = ?,
            revision = CASE WHEN status = 'candidate' THEN 0 ELSE revision + 1 END, updated_at = ?
           WHERE vocabulary_id = ? AND revision = ? AND updated_at < ?
             AND (? IS NULL OR updated_at = ?)`,
        )
        .run(
          lemma,
          meaning,
          stringifyBounded([...examples, ...savedExamples.slice(1)]),
          updatedAt,
          vocabularyId,
          z.int().nonnegative().parse(input.expectedRevision),
          updatedAt,
          input.expectedUpdatedAt ? utcInstantSchema.parse(input.expectedUpdatedAt) : null,
          input.expectedUpdatedAt ?? null,
        );
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
    });
  }

  async suspendVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      suspendedAt: string;
      reason: "learner-paused" | "duplicate" | "not-useful" | "other";
    }>,
  ): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(input.vocabularyId);
    const suspendedAt = utcInstantSchema.parse(input.suspendedAt);
    await withLeasedTransaction(this.#database, (connection) => {
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET status = 'suspended', suspended_at = ?,
            suspension_reason = ?, revision = revision + 1, updated_at = ?
           WHERE vocabulary_id = ? AND status = 'active' AND revision = ?`,
        )
        .run(
          suspendedAt,
          input.reason,
          suspendedAt,
          vocabularyId,
          z.int().nonnegative().parse(input.expectedRevision),
        );
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
    });
  }

  async resumeVocabulary(
    input: Readonly<{
      vocabularyId: string;
      expectedRevision: number;
      resumedAt: string;
    }>,
  ): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(input.vocabularyId);
    const resumedAt = utcInstantSchema.parse(input.resumedAt);
    await withLeasedTransaction(this.#database, (connection) => {
      const result = connection
        .prepare(
          `UPDATE vocabulary_entries SET status = 'active', suspended_at = NULL,
            suspension_reason = NULL, revision = revision + 1, updated_at = ?
           WHERE vocabulary_id = ? AND status = 'suspended' AND revision = ?`,
        )
        .run(resumedAt, vocabularyId, z.int().nonnegative().parse(input.expectedRevision));
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_STATE_CONFLICT");
    });
  }

  async deleteVocabulary(vocabularyIdValue: string, deletedAtValue: string): Promise<void> {
    const vocabularyId = vocabularyIdSchema.parse(vocabularyIdValue);
    const deletedAt = utcInstantSchema.parse(deletedAtValue);
    await withLeasedTransaction(this.#database, (connection) => {
      connection
        .prepare(`INSERT INTO vocabulary_deletions (vocabulary_id, deleted_at) VALUES (?, ?)`)
        .run(vocabularyId, deletedAt);
      const result = connection
        .prepare(`DELETE FROM vocabulary_entries WHERE vocabulary_id = ?`)
        .run(vocabularyId);
      if (result.changes !== 1) throw new Error("OD_VOCABULARY_NOT_FOUND");
    });
  }

  async listDueVocabulary(
    onDateValue: string,
    requestedScope?: LearningScope,
  ): Promise<readonly VocabularyEntry[]> {
    const onDate = calendarDateSchema.parse(onDateValue);
    return withLeasedConnection(this.#database, (connection) => {
      const scope = requestedScope ?? requireLocalLearningScope(connection);
      assertLocalLearningScope(connection, scope);
      return connection
        .prepare(
          `SELECT * FROM vocabulary_entries
           WHERE target_language = ? AND status = 'active' AND due_on <= ? ORDER BY due_on, vocabulary_id LIMIT 500`,
        )
        .all(scope.targetLanguage, onDate)
        .map((row) => vocabularyEntryFromRow(row as Record<string, unknown>));
    });
  }

  async createVocabularyReviewSession(
    onDateValue: string,
    sessionIdValue: string,
    maximumItems = 20,
  ): Promise<VocabularyReviewSession> {
    const onDate = calendarDateSchema.parse(onDateValue);
    const sessionId = sessionIdSchema.parse(sessionIdValue);
    if (!Number.isInteger(maximumItems) || maximumItems < 1 || maximumItems > 50) {
      throw new Error("OD_VOCABULARY_SESSION_SIZE_INVALID");
    }
    const entries = await withLeasedConnection(this.#database, (connection) =>
      connection
        .prepare(
          `SELECT * FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1))
           WHERE status = 'active' AND due_on <= ? ORDER BY due_on, vocabulary_id LIMIT ?`,
        )
        .all(onDate, maximumItems)
        .map((row) => vocabularyEntryFromRow(row as Record<string, unknown>)),
    );
    return vocabularyReviewSessionSchema.parse({
      sessionId,
      onDate,
      items: entries.map((entry, index) => {
        if (entry.state.status !== "active") throw new Error("OD_VOCABULARY_SESSION_STATE_INVALID");
        const example = entry.examples[0];
        const recognition = index % 2 === 0;
        return {
          vocabularyId: entry.vocabularyId,
          direction: recognition ? "recognition" : "production",
          cue: recognition ? entry.lemma : entry.meaning,
          example,
          sourceContext: entry.source.context,
          expectedAnswer: recognition ? entry.meaning : entry.lemma,
          dueOn: entry.state.schedule.dueOn,
        };
      }),
    });
  }
}
