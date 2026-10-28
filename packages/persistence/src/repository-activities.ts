import { historyActivitySql } from "./history-activity.js";
import {
  activityIdSchema,
  activityLibraryFilterSchema,
  activityLibraryItemSchema,
  attemptFeedbackSaveInputSchema,
  attemptIdSchema,
  capturedTeachingContextSchema,
  historyEntryIdSchema,
  learningContextSchema,
  listeningResultSchema,
  maximumExerciseContentBytes,
  placementResultSchema,
  preparedActivitySchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
  type CapturedTeachingContext,
  type ListeningResult,
  type PlacementResult,
} from "@call-nina/contracts";
import { validateCourseEvidence, voiceSummarySchema, type VoiceSummary } from "@call-nina/domain";
import { createHash, randomUUID } from "node:crypto";
import { captureActivityAttempt } from "./attempt-evidence.js";
import { preparePortableContent } from "./content.js";
import { saveCapturedExerciseContext } from "./exercise-context.js";
import { claimIdempotentWrite, type IdempotentWriteResult } from "./idempotency.js";
import {
  activityLearningScope,
  assertActivityReferences,
  assertRegisteredLearningScope as assertLocalLearningScope,
  parseScopedActivityContext,
  requireLocalLearningScope,
} from "./learning-context.js";
import { saveCourseEvidence } from "./learning-path.js";
import { deletePreparedActivityAndOwnedMaterial, linkPortableContent } from "./materials.js";
import {
  type PreparedActivityRecord,
  type TargetedPracticeActivity,
  historyActivityTypeSchema,
  insertActivityVocabularyCandidates,
  parseJson,
  preparedActivityDeletionStatusSql,
  readLearnerSettingsFromConnection,
  stringifyBounded,
  targetedPracticeActivitySchema,
} from "./repository-support.js";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";

export class ActivitiesRepository {
  readonly #database: CallNinaDatabase;
  constructor(database: CallNinaDatabase) {
    this.#database = database;
  }

  /** Only exact-owner generated exercises can be offered for prepared reuse. */
  async readRecommendationPreparedActivities(contextValue: unknown) {
    const context = learningContextSchema.parse(contextValue);
    return withLeasedConnection(this.#database, (connection) => {
      const scope = requireLocalLearningScope(connection);
      if (
        scope.learnerId !== context.learnerId ||
        scope.targetLanguage !== context.targetLanguage ||
        scope.courseId !== context.courseId
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      return connection
        .prepare(
          `SELECT p.activity_id, p.activity_type, p.title,
            ${preparedActivityDeletionStatusSql} AS deletion_status
           FROM prepared_activities p
           JOIN generated_activity_payloads g ON g.activity_id = p.activity_id
           WHERE p.target_language = ? AND p.status IN ('prepared', 'completed')
             AND json_extract(p.context_json, '$.learningScope.learnerId') = ?
             AND json_extract(p.context_json, '$.learningScope.courseId') IS ?
             AND p.activity_type IN ('grammar', 'reading', 'writing', 'custom-lesson')
           ORDER BY p.prepared_at DESC, p.activity_id DESC LIMIT 40`,
        )
        .all(context.targetLanguage, context.learnerId, context.courseId)
        .map((row) => ({
          activityId: activityIdSchema.parse(row["activity_id"]),
          activityType: preparedActivitySchema.shape.activityType.parse(row["activity_type"]),
          title: preparedActivitySchema.shape.title.parse(row["title"]),
          deletionStatus: z
            .enum(["available", "cascade", "retained-data"])
            .parse(row["deletion_status"]),
        }));
    });
  }

  async recordActivityUse(activityIdValue: string, expectedGeneration: number) {
    const activityId = activityIdSchema.parse(activityIdValue);
    if (expectedGeneration !== this.#database.rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
    await withLeasedTransaction(this.#database, (connection) => {
      // An older activity may be opened while another language is active. Its own scope remains authoritative.
      assertLocalLearningScope(connection, activityLearningScope(connection, activityId));
      const previous = connection
        .prepare("SELECT max(last_used_at) AS last_used_at FROM activity_usage")
        .get()?.["last_used_at"];
      const lastUsedAt = new Date(
        Math.max(Date.now(), previous ? Date.parse(utcInstantSchema.parse(previous)) + 1 : 0),
      ).toISOString();
      connection
        .prepare(
          `INSERT INTO activity_usage(activity_id, last_used_at) VALUES (?, ?)
        ON CONFLICT(activity_id) DO UPDATE SET last_used_at = excluded.last_used_at`,
        )
        .run(activityId, lastUsedAt);
    });
  }

  async saveVoiceSummary(
    summaryValue: VoiceSummary,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const summary = voiceSummarySchema.parse(summaryValue);
    return withLeasedTransaction(this.#database, (connection) => {
      const linked = summary.activity
        ? (connection
            .prepare("SELECT context_json FROM prepared_activities WHERE activity_id = ?")
            .get(summary.activity.activityId) as { context_json: string } | undefined)
        : undefined;
      const linkedContext = linked
        ? parseScopedActivityContext(connection, parseJson(linked.context_json))
        : undefined;
      if (summary.activity) {
        if (!linkedContext?.learningPath || !linkedContext.courseTeaching)
          throw new Error("OD_COURSE_EVIDENCE_INVALID");
        validateCourseEvidence(linkedContext.courseTeaching, summary.activity.objectiveResults);
      }
      assertLocalLearningScope(connection, summary.learningScope);
      if (
        linkedContext &&
        JSON.stringify(linkedContext.learningScope) !== JSON.stringify(summary.learningScope)
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      const skill = linkedContext?.voiceContext?.kind ?? "speaking";
      const claim = claimIdempotentWrite(connection, {
        operation: "voice-summary",
        idempotencyKey,
        request: summary,
        entityId: summary.voiceSessionId,
        recordedAt: summary.summarizedAt,
      });
      if (claim.replayed) return claim;
      connection
        .prepare(
          `INSERT INTO voice_summaries (target_language,
            voice_session_id, summarized_at, scenario_title, target_level, summary_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          summary.learningScope.targetLanguage,
          summary.voiceSessionId,
          summary.summarizedAt,
          summary.scenario.title,
          summary.scenario.targetLevel,
          stringifyBounded(summary),
        );
      const historyEntryId = historyEntryIdSchema.parse(
        `history-entry_${randomUUID().replaceAll("-", "")}`,
      );
      connection
        .prepare(
          `INSERT INTO history_entries (
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, 'voice-summary', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          historyEntryId,
          summary.voiceSessionId,
          skill,
          skill === "listening" ? "codex-listening" : "voice-speaking",
          summary.scenario.title,
          summary.summarizedAt,
          stringifyBounded(summary),
          this.#database.rootGeneration,
        );
      if (summary.activity) {
        saveCourseEvidence(connection, {
          activityId: summary.activity.activityId,
          historyEntryId,
          occurredAt: summary.summarizedAt,
          evidence: summary.activity.objectiveResults,
          ...(summary.activity.facts ? { facts: summary.activity.facts } : {}),
        });
        if (summary.activity.outcome === "completed")
          connection
            .prepare(
              "UPDATE prepared_activities SET status = 'completed', completed_at = ? WHERE activity_id = ?",
            )
            .run(summary.summarizedAt, summary.activity.activityId);
      }
      return claim;
    });
  }

  async savePlacementResult(
    resultValue: PlacementResult,
    idempotencyKeyValue: string,
  ): Promise<Readonly<{ historyEntryId: string; replayed: boolean }>> {
    const result = placementResultSchema.parse(resultValue);
    const idempotencyKey = z.string().min(8).max(128).parse(idempotencyKeyValue);
    const digest = createHash("sha256").update(idempotencyKey, "utf8").digest("hex").slice(0, 32);
    const entityId = `placement_${digest}`;
    const historyEntryId = historyEntryIdSchema.parse(`history-entry_${digest}`);
    return withLeasedTransaction(this.#database, (connection) => {
      assertLocalLearningScope(connection, result.learningScope);
      const existing = connection
        .prepare(
          `SELECT reconstruction_json FROM history_entries
           WHERE entity_kind = 'placement' AND entity_id = ?`,
        )
        .get(entityId) as { reconstruction_json: string } | undefined;
      if (existing) {
        if (
          JSON.stringify(placementResultSchema.parse(parseJson(existing.reconstruction_json))) !==
          JSON.stringify(result)
        ) {
          throw new Error("OD_PLACEMENT_RESULT_CONFLICT");
        }
        return { historyEntryId, replayed: true };
      }
      connection
        .prepare(
          `INSERT INTO history_entries (target_language,
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, ?, 'placement', ?, 'writing', 'placement', ?, ?, ?, ?)`,
        )
        .run(
          result.learningScope.targetLanguage,
          historyEntryId,
          entityId,
          "Optional diagnostic",
          `${result.completedOn}T12:00:00.000Z`,
          stringifyBounded(result),
          this.#database.rootGeneration,
        );
      return { historyEntryId, replayed: false };
    });
  }

  async savePreparedActivity(
    activityValue: PreparedActivityRecord,
    idempotencyKey: string,
    capture:
      { source: "current-settings" } | { source: "captured"; context: CapturedTeachingContext },
  ): Promise<IdempotentWriteResult> {
    const activity = preparedActivitySchema.parse(activityValue);
    return withLeasedTransaction(this.#database, (connection) => {
      assertActivityReferences(connection, activity.context);
      const claim = claimIdempotentWrite(connection, {
        operation: "prepared-activity",
        idempotencyKey,
        request: { ...activity, preparedAt: null, capture },
        entityId: activity.activityId,
        recordedAt: activity.preparedAt,
      });
      if (claim.replayed) return claim;
      const settings =
        capture.source === "current-settings"
          ? readLearnerSettingsFromConnection(
              connection,
              activity.context.learningScope.learnerId,
              activity.context.learningScope,
            )
          : undefined;
      if (capture.source === "current-settings" && !settings)
        throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      const capturedContext = capturedTeachingContextSchema.parse(
        capture.source === "captured"
          ? capture.context
          : settings && {
              learningContext: settings.learningContext,
              calibration: {
                explanationLanguage: settings.learningContext.explanationLanguage,
                approximateLevel: { a1: "A1", a2: "A2", b1: "B1", b2: "B2" }[
                  settings.profile.levelEstimate.currentLevel
                ],
                teachingProfile: settings.profile.defaultTeachingProfileId,
              },
            },
      );
      const scope = activity.context.learningScope;
      if (
        capturedContext.learningContext.learnerId !== scope.learnerId ||
        capturedContext.learningContext.courseId !== scope.courseId ||
        capturedContext.learningContext.targetLanguage !== scope.targetLanguage
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      connection
        .prepare(
          `INSERT INTO prepared_activities (target_language,
            activity_id, activity_type, title, origin_surface, context_json,
            prepared_at, root_generation
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          activity.context.learningScope.targetLanguage,
          activity.activityId,
          activity.activityType,
          activity.title,
          activity.originSurface,
          stringifyBounded(activity.context),
          activity.preparedAt,
          this.#database.rootGeneration,
        );
      connection
        .prepare(
          `INSERT INTO captured_activity_contexts(activity_id, activity_revision, context_json)
         VALUES (?, 1, ?)`,
        )
        .run(activity.activityId, stringifyBounded(capturedContext));
      return claim;
    });
  }

  async readPreparedActivity(activityIdValue: string): Promise<PreparedActivityRecord | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT activity_id, activity_type, title, origin_surface, context_json, prepared_at
           FROM prepared_activities
           WHERE activity_id = ? AND status IN ('prepared', 'completed')`,
        )
        .get(activityId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return preparedActivitySchema.parse({
        activityId: row["activity_id"],
        activityType: row["activity_type"],
        title: row["title"],
        originSurface: row["origin_surface"],
        context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
        preparedAt: row["prepared_at"],
      });
    });
  }

  async readPreparedActivityContext(activityIdValue: string): Promise<CapturedTeachingContext> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const scope = activityLearningScope(connection, activityId);
      const row = connection
        .prepare(
          "SELECT context_json FROM captured_activity_contexts WHERE activity_id = ? AND activity_revision = 1",
        )
        .get(activityId);
      if (!row) throw new Error("OD_EXERCISE_CONTEXT_MISSING");
      const captured = capturedTeachingContextSchema.parse(parseJson(row["context_json"]));
      if (
        captured.learningContext.learnerId !== scope.learnerId ||
        captured.learningContext.courseId !== scope.courseId ||
        captured.learningContext.targetLanguage !== scope.targetLanguage
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      return captured;
    });
  }

  async listPreparedActivities(filterValue: z.input<typeof activityLibraryFilterSchema> = {}) {
    const filter = activityLibraryFilterSchema.parse(filterValue);
    return withLeasedConnection(this.#database, (connection) => {
      const clauses = ["p.status IN ('prepared', 'completed')"];
      const parameters: Array<string | number> = [];
      if (filter.activityTypes.length > 0) {
        clauses.push(`p.activity_type IN (${filter.activityTypes.map(() => "?").join(", ")})`);
        parameters.push(...filter.activityTypes);
      }
      if (filter.search) {
        clauses.push("instr(lower(p.title), lower(?)) > 0");
        parameters.push(filter.search);
      }
      if (filter.material) {
        clauses.push(`p.activity_type IN ('reading', 'vocabulary-review') AND EXISTS (
          SELECT 1 FROM activity_content_revisions c JOIN material_revisions m
          ON m.revision_id = c.material_revision_id
          WHERE c.activity_id = p.activity_id AND m.material_id = ? AND m.revision_id = ?
        )`);
        parameters.push(filter.material.materialId, filter.material.revisionId);
      }
      if (filter.cursor) {
        clauses.push("(p.prepared_at < ? OR (p.prepared_at = ? AND p.activity_id > ?))");
        parameters.push(
          filter.cursor.preparedAt,
          filter.cursor.preparedAt,
          filter.cursor.activityId,
        );
      }
      const rows = connection
        .prepare(
          `
        SELECT p.*, (SELECT count(*) FROM history_entries h WHERE h.target_language = p.target_language
          AND ${historyActivitySql("h")} = p.activity_id) AS result_count,
          EXISTS (SELECT 1 FROM generated_activity_payloads g
          WHERE g.activity_id = p.activity_id) AS generated,
          ${preparedActivityDeletionStatusSql} AS deletion_status
        FROM (SELECT * FROM prepared_activities WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) p WHERE ${clauses.join(" AND ")}
        ORDER BY p.prepared_at DESC, p.activity_id LIMIT ?
      `,
        )
        .all(...parameters, filter.maximum + 1) as Record<string, unknown>[];
      const entries = rows.slice(0, filter.maximum).map((row) =>
        activityLibraryItemSchema.parse({
          activityId: row["activity_id"],
          activityType: row["activity_type"],
          title: row["title"],
          originSurface: row["origin_surface"],
          preparedAt: row["prepared_at"],
          generated: row["generated"] === 1,
          resultCount: Number(row["result_count"]),
          deletionStatus: row["deletion_status"],
        }),
      );
      const last = entries.at(-1);
      return {
        rootGeneration: this.#database.rootGeneration,
        learningScope: requireLocalLearningScope(connection),
        entries,
        nextCursor:
          rows.length > filter.maximum && last
            ? { preparedAt: last.preparedAt, activityId: last.activityId }
            : null,
      };
    });
  }

  async readLatestPreparedVoiceActivity(
    kind: "speaking" | "listening",
  ): Promise<PreparedActivityRecord | undefined> {
    const activityType = kind === "speaking" ? "voice-speaking" : "codex-listening";
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT activity_id, activity_type, title, origin_surface, context_json, prepared_at
           FROM (SELECT * FROM prepared_activities WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1))
           WHERE activity_type = ? AND status = 'prepared'
           ORDER BY prepared_at DESC, activity_id DESC
           LIMIT 1`,
        )
        .get(activityType) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return preparedActivitySchema.parse({
        activityId: row["activity_id"],
        activityType: row["activity_type"],
        title: row["title"],
        originSurface: row["origin_surface"],
        context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
        preparedAt: row["prepared_at"],
      });
    });
  }

  async deletePreparedActivity(activityIdValue: string): Promise<void> {
    const activityId = activityIdSchema.parse(activityIdValue);
    const deletedAt = utcInstantSchema.parse(new Date().toISOString());
    await withLeasedTransaction(this.#database, (connection) => {
      const activity = connection
        .prepare(
          `SELECT p.context_json, ${preparedActivityDeletionStatusSql} AS deletion_status
           FROM prepared_activities p WHERE p.activity_id = ?`,
        )
        .get(activityId) as { context_json: string; deletion_status: string } | undefined;
      if (!activity) throw new Error("OD_PREPARED_ACTIVITY_NOT_FOUND");
      const courseMissionId = parseScopedActivityContext(
        connection,
        parseJson(activity.context_json),
      ).courseTeaching?.mission.id;
      if (activity.deletion_status === "retained-data") {
        throw new Error("OD_PREPARED_ACTIVITY_DELETE_BLOCKED");
      }
      const courseVoice = connection
        .prepare(
          `SELECT h.entity_id FROM course_results r JOIN history_entries h ON h.history_entry_id = r.history_entry_id WHERE r.activity_id = ? AND h.entity_kind = 'voice-summary'`,
        )
        .all(activityId) as { entity_id: string }[];
      connection
        .prepare(
          "DELETE FROM history_entries WHERE history_entry_id IN (SELECT history_entry_id FROM course_results WHERE activity_id = ?)",
        )
        .run(activityId);
      for (const row of courseVoice)
        connection
          .prepare("DELETE FROM voice_summaries WHERE voice_session_id = ?")
          .run(row.entity_id);
      connection
        .prepare(
          `DELETE FROM history_entries
           WHERE entity_kind = 'attempt'
             AND EXISTS (
               SELECT 1 FROM attempts a
               JOIN exercises e ON e.exercise_id = a.exercise_id
               WHERE a.attempt_id = history_entries.entity_id
                 AND e.activity_id = ?
             )`,
        )
        .run(activityId);
      connection.prepare(`DELETE FROM mcp_attempt_feedback WHERE activity_id = ?`).run(activityId);
      connection
        .prepare(
          `INSERT INTO attempt_deletions (attempt_id, deleted_at)
           SELECT a.attempt_id, ?
           FROM attempts a
           JOIN exercises e ON e.exercise_id = a.exercise_id
           WHERE e.activity_id = ?`,
        )
        .run(deletedAt, activityId);
      connection
        .prepare(
          `DELETE FROM attempts
           WHERE exercise_id IN (
             SELECT exercise_id FROM exercises WHERE activity_id = ?
           )`,
        )
        .run(activityId);
      connection.prepare(`DELETE FROM exercises WHERE activity_id = ?`).run(activityId);
      connection
        .prepare(
          `INSERT INTO vocabulary_deletions (vocabulary_id, deleted_at)
           SELECT vocabulary_id, ?
           FROM vocabulary_entries
           WHERE status = 'candidate'
             AND json_extract(source_json, '$.kind') = 'activity'
             AND json_extract(source_json, '$.activityId') = ?`,
        )
        .run(deletedAt, activityId);
      connection
        .prepare(
          `DELETE FROM vocabulary_entries
           WHERE status = 'candidate'
             AND json_extract(source_json, '$.kind') = 'activity'
             AND json_extract(source_json, '$.activityId') = ?`,
        )
        .run(activityId);
      deletePreparedActivityAndOwnedMaterial(connection, activityId);
      if (courseMissionId)
        connection
          .prepare(
            "DELETE FROM course_missions WHERE mission_id = ? AND NOT EXISTS (SELECT 1 FROM prepared_activities WHERE json_extract(context_json, '$.courseTeaching.mission.id') = ?)",
          )
          .run(courseMissionId, courseMissionId);
    });
  }

  async saveMcpAttemptFeedback(
    value: Omit<
      z.input<typeof attemptFeedbackSaveInputSchema>,
      "dataRootGeneration" | "idempotencyKey"
    > & {
      attemptId: string;
      savedAt: string;
      idempotencyKey: string;
    },
  ): Promise<IdempotentWriteResult> {
    const record = strictBoundaryObject({
      attemptId: attemptIdSchema,
      activityId: activityIdSchema,
      targetAttemptId: attemptIdSchema.nullable(),
      expectedActivityRevision: z.int().positive(),
      feedback: attemptFeedbackSaveInputSchema.shape.feedback,
      savedAt: utcInstantSchema,
      idempotencyKey: z.string().min(16).max(128),
    }).parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      let activity = connection
        .prepare(
          `SELECT title, activity_type, status FROM prepared_activities
           WHERE activity_id = ?`,
        )
        .get(record.activityId) as
        { title: string; activity_type: string; status: "prepared" | "completed" } | undefined;
      if (!activity && record.targetAttemptId) {
        activity = connection
          .prepare(
            `SELECT h.title, h.activity_type, 'completed' AS status FROM attempts a
          JOIN exercises e USING(exercise_id) JOIN history_entries h ON h.entity_id = a.attempt_id AND h.entity_kind = 'attempt'
          WHERE a.attempt_id = ? AND e.activity_id = ? AND a.status = 'completed'`,
          )
          .get(record.targetAttemptId, record.activityId) as typeof activity;
      }
      if (!activity) throw new Error("OD_MCP_ACTIVITY_NOT_FOUND");
      const claim = claimIdempotentWrite(connection, {
        operation: "attempt-completion",
        idempotencyKey: record.idempotencyKey,
        request: {
          attemptId: record.attemptId,
          activityId: record.activityId,
          expectedActivityRevision: record.expectedActivityRevision,
          feedback: record.feedback,
          targetAttemptId: record.targetAttemptId,
        },
        entityId: record.attemptId,
        recordedAt: record.savedAt,
      });
      if (claim.replayed) return claim;
      if (
        record.expectedActivityRevision !== 1 ||
        (!record.targetAttemptId && activity.status === "completed")
      ) {
        throw new Error("OD_MCP_ACTIVITY_REVISION_CONFLICT");
      }
      captureActivityAttempt(connection, {
        attemptId: record.attemptId,
        activityId: record.activityId,
        occurredAt: record.savedAt,
        sourceKind: "external",
        targetAttemptId: record.targetAttemptId,
      });
      connection
        .prepare(
          `INSERT INTO mcp_attempt_feedback (
            attempt_id, activity_id, expected_activity_revision, feedback_json,
            saved_at, root_generation, target_attempt_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.attemptId,
          record.activityId,
          record.expectedActivityRevision,
          stringifyBounded(record.feedback),
          record.savedAt,
          this.#database.rootGeneration,
          record.targetAttemptId,
        );
      const historyEntryId = historyEntryIdSchema.parse(
        `history-entry_${randomUUID().replaceAll("-", "")}`,
      );
      const activityType = historyActivityTypeSchema.parse(activity.activity_type);
      const skill =
        activityType === "reading"
          ? "reading"
          : activityType === "codex-listening"
            ? "listening"
            : activityType === "voice-speaking"
              ? "speaking"
              : "writing";
      connection
        .prepare(
          `INSERT INTO history_entries (
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, 'attempt', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          historyEntryId,
          record.attemptId,
          skill,
          activityType,
          activity.title,
          record.savedAt,
          stringifyBounded({ kind: "reference" }),
          this.#database.rootGeneration,
        );
      if (!record.targetAttemptId && record.feedback.outcome === "completed") {
        connection
          .prepare(
            `UPDATE prepared_activities SET status = 'completed', completed_at = ?
             WHERE activity_id = ? AND status = 'prepared'`,
          )
          .run(record.savedAt, record.activityId);
      }
      return claim;
    });
  }

  async saveTargetedPracticeActivity(
    value: TargetedPracticeActivity,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const record = targetedPracticeActivitySchema.parse(value);
    if (
      record.activity.activityType !== "grammar" ||
      record.activity.context.mistakeIds.length < 1
    ) {
      throw new Error("OD_TARGETED_PRACTICE_ACTIVITY_INVALID");
    }
    if (record.aiProvenance.producer !== "desktop-app-server") {
      throw new Error("OD_TARGETED_PRACTICE_PROVENANCE_INVALID");
    }
    const modelSelection = record.aiProvenance.modelSelection;
    const categoryJson = stringifyBounded(record.category, 16_384);
    return withLeasedTransaction(this.#database, (connection) => {
      const placeholders = record.activity.context.mistakeIds.map(() => "?").join(", ");
      const mistakes = connection
        .prepare(
          `SELECT mistake_id, effective_category_json FROM mistakes
           WHERE target_language = ? AND disposition = 'active' AND mistake_id IN (${placeholders})`,
        )
        .all(
          record.activity.context.learningScope.targetLanguage,
          ...record.activity.context.mistakeIds,
        ) as Record<string, unknown>[];
      if (
        mistakes.length !== record.activity.context.mistakeIds.length ||
        mistakes.some(({ effective_category_json }) => effective_category_json !== categoryJson)
      ) {
        throw new Error("OD_TARGETED_PRACTICE_PATTERN_STALE");
      }
      assertActivityReferences(connection, record.activity.context);
      const claim = claimIdempotentWrite(connection, {
        operation: "prepared-activity",
        idempotencyKey,
        request: record,
        entityId: record.activity.activityId,
        recordedAt: record.activity.preparedAt,
      });
      if (claim.replayed) return claim;
      const content = preparePortableContent(connection, record);
      connection
        .prepare(
          `INSERT INTO prepared_activities (target_language,
            activity_id, activity_type, title, origin_surface, context_json,
            prepared_at, root_generation
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.activity.context.learningScope.targetLanguage,
          record.activity.activityId,
          record.activity.activityType,
          record.activity.title,
          record.activity.originSurface,
          stringifyBounded(record.activity.context),
          record.activity.preparedAt,
          this.#database.rootGeneration,
        );
      connection
        .prepare(
          `INSERT INTO generated_activity_payloads (
            activity_id, workload, model_request_id, model_id, effort_id, generated_at, output_json
          ) VALUES (?, 'exercise-generation', ?, ?, ?, ?, ?)`,
        )
        .run(
          record.activity.activityId,
          record.aiProvenance.modelRequestId,
          modelSelection.modelId,
          modelSelection.effortId,
          record.aiProvenance.generatedAt,
          stringifyBounded(content, maximumExerciseContentBytes),
        );
      linkPortableContent(
        connection,
        record.activity.activityId,
        content,
        "revisionId" in record.material ? "reused-or-historic" : "inline-created",
      );
      saveCapturedExerciseContext(
        connection,
        record.activity.activityId,
        content,
        record.capturedContext,
      );
      const insertReference = connection.prepare(
        `INSERT INTO activity_context_references (activity_id, reference_kind, reference_id)
         VALUES (?, ?, ?)`,
      );
      const insertLink = connection.prepare(
        `INSERT INTO targeted_practice_links (activity_id, mistake_id, category_json, created_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const mistakeId of record.activity.context.mistakeIds) {
        insertReference.run(record.activity.activityId, "mistake", mistakeId);
        insertLink.run(
          record.activity.activityId,
          mistakeId,
          categoryJson,
          record.activity.preparedAt,
        );
      }
      for (const topicId of record.activity.context.curriculumTopicIds) {
        insertReference.run(record.activity.activityId, "curriculum-topic", topicId);
      }
      insertActivityVocabularyCandidates(
        connection,
        record.vocabularyEntries,
        record.activity.activityId,
        record.activity.preparedAt,
      );
      return claim;
    });
  }

  async readPreparedActivityDeletionStatus(
    activityIdValue: string,
  ): Promise<"available" | "cascade" | "retained-data" | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT ${preparedActivityDeletionStatusSql} AS deletion_status
           FROM prepared_activities p
           WHERE p.activity_id = ?`,
        )
        .get(activityId) as { deletion_status: unknown } | undefined;
      return row === undefined
        ? undefined
        : z.enum(["available", "cascade", "retained-data"]).parse(row.deletion_status);
    });
  }

  async saveListeningResult(
    value: Readonly<{
      attemptId: string;
      activityId: string;
      expectedActivityRevision: number;
      result: ListeningResult;
      occurredAt: string;
      idempotencyKey: string;
    }>,
  ): Promise<Readonly<{ historyEntryId: string; replayed: boolean }>> {
    const record = strictBoundaryObject({
      attemptId: attemptIdSchema,
      activityId: activityIdSchema,
      expectedActivityRevision: z.int().nonnegative(),
      result: listeningResultSchema,
      occurredAt: utcInstantSchema,
      idempotencyKey: z.string().min(16).max(128),
    }).parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const activity = connection
        .prepare(
          `SELECT title, activity_type, status FROM prepared_activities
           WHERE activity_id = ?`,
        )
        .get(record.activityId) as
        { title: string; activity_type: string; status: "prepared" | "completed" } | undefined;
      if (!activity) throw new Error("OD_MCP_ACTIVITY_NOT_FOUND");
      if (activity.activity_type !== "codex-listening") {
        throw new Error("OD_MCP_LISTENING_ACTIVITY_INVALID");
      }
      const historyEntryId = historyEntryIdSchema.parse(
        `history-entry_${record.attemptId.slice("attempt_".length)}`,
      );
      const claim = claimIdempotentWrite(connection, {
        operation: "attempt-completion",
        idempotencyKey: record.idempotencyKey,
        request: record,
        entityId: record.attemptId,
        recordedAt: record.occurredAt,
      });
      if (claim.replayed) return { historyEntryId, replayed: true };
      if (record.expectedActivityRevision !== 1 || activity.status === "completed") {
        throw new Error("OD_MCP_ACTIVITY_REVISION_CONFLICT");
      }
      connection
        .prepare(
          `INSERT INTO history_entries (target_language,
            history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
          ) VALUES (?, ?, 'attempt', ?, 'listening', 'codex-listening', ?, ?, ?, ?)`,
        )
        .run(
          activityLearningScope(connection, record.activityId).targetLanguage,
          historyEntryId,
          record.attemptId,
          activity.title,
          record.occurredAt,
          stringifyBounded(record.result),
          this.#database.rootGeneration,
        );
      connection
        .prepare(
          `UPDATE prepared_activities SET status = 'completed', completed_at = ?
           WHERE activity_id = ? AND status = 'prepared'`,
        )
        .run(record.occurredAt, record.activityId);
      captureActivityAttempt(connection, {
        attemptId: record.attemptId,
        activityId: record.activityId,
        occurredAt: record.occurredAt,
        sourceKind: "listening",
      });
      return { historyEntryId, replayed: false };
    });
  }
}
