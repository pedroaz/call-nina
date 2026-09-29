import {
  mistakeIdSchema,
  personalDataCleanupRequestSchema,
  personalDataCleanupResultSchema,
  personalDataTables,
  personalDataTableSummarySchema,
  utcInstantSchema,
  type z,
} from "@call-nina/contracts";

import { type CallNinaDatabase, withLeasedConnection, withLeasedTransaction } from "./sqlite.js";

export async function readPersonalDataInventory(database: CallNinaDatabase) {
  return withLeasedConnection(database, (connection) =>
    personalDataTables.map((table) =>
      personalDataTableSummarySchema.parse({
        table,
        count: connection.prepare(`SELECT count(*) AS count FROM "${table}"`).get()?.["count"],
      }),
    ),
  );
}

export async function clearPersonalData(
  database: CallNinaDatabase,
  input: z.input<typeof personalDataCleanupRequestSchema>,
) {
  const { scope, expectedGeneration } = personalDataCleanupRequestSchema.parse(input);
  if (expectedGeneration !== database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
  const deletedAt = utcInstantSchema.parse(new Date().toISOString());
  return withLeasedTransaction(database, (connection) => {
    const practice = scope === "practice" || scope === "learning";
    const vocabulary = scope === "vocabulary" || scope === "learning";
    // Files are deliberately outside this operation. Do not orphan their ownership records.
    const attachedRecords = connection
      .prepare(
        `
      SELECT 1 FROM attachment_metadata a
      LEFT JOIN history_entries h ON a.owner_kind = 'history' AND h.history_entry_id = a.owner_id
      WHERE ? = 1 OR (? = 1 AND a.owner_kind = 'activity')
        OR (a.owner_kind = 'history' AND (
          (? = 1 AND h.entity_kind <> 'vocabulary-review')
          OR (? = 1 AND h.entity_kind = 'vocabulary-review')
        )) LIMIT 1
    `,
      )
      .get(Number(scope === "learning"), Number(practice), Number(practice), Number(vocabulary));
    if (attachedRecords) {
      return personalDataCleanupResultSchema.parse({ status: "blocked", reason: "attachments" });
    }
    if (
      practice &&
      !vocabulary &&
      connection
        .prepare(
          `SELECT 1 FROM vocabulary_entries
       WHERE json_extract(source_json, '$.kind') IN ('activity', 'correction') LIMIT 1`,
        )
        .get()
    ) {
      return personalDataCleanupResultSchema.parse({
        status: "blocked",
        reason: "linked-vocabulary",
      });
    }
    // These are semantic cleanup operations, not a generic table-deletion API.
    // Keep foreign keys, immutable-record triggers and deletion tombstones in force.
    if (vocabulary) {
      connection
        .prepare(
          `INSERT INTO vocabulary_deletions (vocabulary_id, deleted_at)
        SELECT vocabulary_id, ? FROM vocabulary_entries`,
        )
        .run(deletedAt);
      connection.prepare(`DELETE FROM vocabulary_lesson_sets`).run();
      connection.prepare(`DELETE FROM vocabulary_entries`).run();
      connection
        .prepare(`DELETE FROM history_entries WHERE entity_kind = 'vocabulary-review'`)
        .run();
      connection
        .prepare(`DELETE FROM activity_context_references WHERE reference_kind = 'vocabulary'`)
        .run();
    }
    if (practice) {
      connection.prepare("DELETE FROM course_marks").run();
      connection.prepare("DELETE FROM course_selection").run();
      connection.prepare("DELETE FROM course_missions").run();
      connection
        .prepare(
          `INSERT INTO attempt_deletions (attempt_id, deleted_at)
        SELECT attempt_id, ? FROM attempts`,
        )
        .run(deletedAt);
      connection
        .prepare(`DELETE FROM history_entries WHERE entity_kind <> 'vocabulary-review'`)
        .run();
      connection.prepare(`DELETE FROM mcp_attempt_feedback`).run();
      connection.prepare(`DELETE FROM attempts`).run();
      connection.prepare(`DELETE FROM exercises`).run();
      connection.prepare(`DELETE FROM lessons`).run();
      connection.prepare(`DELETE FROM prepared_activities`).run();
      connection.prepare("DELETE FROM material_revisions").run();
      // The mistake-deletion trigger requires the record to be absent before its marker.
      const removedMistakes = connection.prepare(`DELETE FROM mistakes RETURNING mistake_id`).all();
      const markMistake = connection.prepare(
        `INSERT INTO mistake_deletions (mistake_id, deleted_at) VALUES (?, ?)`,
      );
      for (const row of removedMistakes) {
        markMistake.run(mistakeIdSchema.parse(row["mistake_id"]), deletedAt);
      }
      connection.prepare(`DELETE FROM voice_summaries`).run();
      connection.prepare(`DELETE FROM learner_profile_insights`).run();
    }
    return personalDataCleanupResultSchema.parse({ status: "cleared", scope });
  });
}
