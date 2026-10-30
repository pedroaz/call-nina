import { historyActivitySql } from "./history-activity.js";
import {
  activityIdSchema,
  attemptFeedbackSaveInputSchema,
  attemptIdSchema,
  calendarDateSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  historyEntryIdSchema,
  languageSchema,
  learningContextSchema,
  learningScopeSchema,
  listeningResultSchema,
  maximumExerciseContentBytes,
  maximumExerciseFeedbackBytes,
  maximumExerciseHistoryBytes,
  mistakeIdSchema,
  ninaContinueSchema,
  placementResultSchema,
  practiceSuggestionContextSchema,
  preparedActivitySchema,
  utcInstantSchema,
  vocabularyIdSchema,
  z,
  type LearningScope,
} from "@call-nina/contracts";
import {
  aiProvenanceSchema,
  attemptFeedbackSchema,
  correctionVocabularyCandidateSchema,
  exerciseAnswerSchema,
  mistakeCategorySchema,
  voiceSummarySchema,
  type MistakeCategory,
} from "@call-nina/domain";
import { historyAttemptEvidence, readAttemptEvidence } from "./attempt-evidence.js";
import { readStoredExerciseContent } from "./content.js";
import { type IdempotentWriteResult } from "./idempotency.js";
import {
  assertRegisteredLearningScope as assertLocalLearningScope,
  requireLocalLearningScope,
  scopeForLanguage,
} from "./learning-context.js";
import {
  type CorrectionMistakeSample,
  type DashboardSnapshot,
  type HistoryEntryRecord,
  type HistoryFilter,
  type HistoryPageRecord,
  type MistakePatternRecord,
  generatedExerciseHistorySchema,
  historyActivityTypeSchema,
  historyFilterSchema,
  mistakePatternFilterSchema,
  parseJson,
  preparedActivityDeletionStatusSql,
  readLearnerSettingsFromConnection,
  readStoredExerciseFeedback,
  storedExerciseFeedbackSchema,
  stringifyBounded,
  vocabularyEntryFromRow,
} from "./repository-support.js";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";

export class HistoryRepository {
  readonly #database: CallNinaDatabase;
  constructor(database: CallNinaDatabase) {
    this.#database = database;
  }

  async readRecentAttemptEvidence(maximum = 5) {
    const limit = z.int().min(1).max(20).parse(maximum);
    return withLeasedConnection(this.#database, (connection) =>
      connection
        .prepare(
          "SELECT attempt_id FROM learning_attempts WHERE json_extract(ownership_json, '$.learningScope.targetLanguage') = (SELECT target_language FROM local_learning_scope WHERE singleton = 1) ORDER BY rowid DESC LIMIT ?",
        )
        .all(limit)
        .map((row) => {
          const evidence = readAttemptEvidence(connection, String(row["attempt_id"]));
          if (!evidence) throw new Error("OD_ATTEMPT_NOT_FOUND");
          return evidence;
        }),
    );
  }

  async deleteAttempt(
    attemptIdValue: string,
    deletedAtValue: string,
  ): Promise<IdempotentWriteResult> {
    const attemptId = attemptIdSchema.parse(attemptIdValue);
    const deletedAt = utcInstantSchema.parse(deletedAtValue);
    return withLeasedTransaction(this.#database, (connection) => {
      const prior = connection
        .prepare(`SELECT deleted_at FROM attempt_deletions WHERE attempt_id = ?`)
        .get(attemptId);
      if (prior !== undefined) return Object.freeze({ replayed: true });
      connection
        .prepare(`INSERT INTO attempt_deletions (attempt_id, deleted_at) VALUES (?, ?) `)
        .run(attemptId, deletedAt);
      const result = connection.prepare(`DELETE FROM attempts WHERE attempt_id = ?`).run(attemptId);
      if (result.changes !== 1) throw new Error("OD_ATTEMPT_NOT_FOUND");
      return Object.freeze({ replayed: false });
    });
  }

  async amendMistakeClassification(
    input: Readonly<{
      amendmentId: string;
      mistakeId: string;
      effectiveCategory: MistakeCategory;
      note?: string;
      amendedAt: string;
    }>,
  ): Promise<void> {
    if (!/^amendment_[0-9a-z]{16,64}$/u.test(input.amendmentId)) {
      throw new Error("OD_MISTAKE_AMENDMENT_ID_INVALID");
    }
    const mistakeId = mistakeIdSchema.parse(input.mistakeId);
    const amendedAt = utcInstantSchema.parse(input.amendedAt);
    const parsedCategory = mistakeCategorySchema.safeParse(input.effectiveCategory);
    if (!parsedCategory.success) throw new Error("OD_MISTAKE_CATEGORY_INVALID");
    const nextCategory = stringifyBounded(parsedCategory.data, 16_384);
    if (input.note !== undefined && (input.note.trim().length === 0 || input.note.length > 500)) {
      throw new Error("OD_MISTAKE_AMENDMENT_NOTE_INVALID");
    }
    await withLeasedTransaction(this.#database, (connection) => {
      const current = connection
        .prepare(`SELECT effective_category_json FROM mistakes WHERE mistake_id = ?`)
        .get(mistakeId) as { effective_category_json: string } | undefined;
      if (current === undefined) throw new Error("OD_MISTAKE_NOT_FOUND");
      const currentCategory = mistakeCategorySchema.safeParse(
        parseJson(current.effective_category_json),
      );
      if (!currentCategory.success) throw new Error("OD_MISTAKE_CATEGORY_INVALID");
      if (stringifyBounded(currentCategory.data, 16_384) === nextCategory) {
        throw new Error("OD_MISTAKE_AMENDMENT_NO_CHANGE");
      }
      connection
        .prepare(
          `INSERT INTO mistake_amendments (
            amendment_id, mistake_id, previous_category_json, amended_category_json, note, amended_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.amendmentId,
          mistakeId,
          current.effective_category_json,
          nextCategory,
          input.note ?? null,
          amendedAt,
        );
      connection
        .prepare(
          `UPDATE mistakes SET effective_category_json = ?, classification_source = 'learner-amended',
            learner_amended_at = ?, learner_amendment_note = ? WHERE mistake_id = ?`,
        )
        .run(nextCategory, amendedAt, input.note ?? null, mistakeId);
    });
  }

  async deleteProfileInsight(
    scopeValue: LearningScope,
    insightGroup: "strength" | "weakness",
    position: number,
  ): Promise<void> {
    const scope = learningScopeSchema.parse(scopeValue);
    const learnerId = scope.learnerId;
    if (!Number.isInteger(position) || position < 0 || position > 49) {
      throw new Error("OD_PROFILE_INSIGHT_POSITION_INVALID");
    }
    await withLeasedTransaction(this.#database, (connection) => {
      const settings = readLearnerSettingsFromConnection(connection, learnerId, scope);
      if (!settings) throw new Error("OD_LEARNER_SETTINGS_NOT_FOUND");
      const key = insightGroup === "strength" ? "inferredStrengths" : "inferredWeaknesses";
      if (!settings.profile[key][position]) throw new Error("OD_PROFILE_INSIGHT_NOT_FOUND");
      settings.profile[key].splice(position, 1);
      connection
        .prepare(
          "UPDATE language_profiles SET profile_json = ? WHERE target_language = ? AND learner_id = ?",
        )
        .run(stringifyBounded(settings.profile), settings.profile.targetLanguage, learnerId);
    });
  }

  async readNinaContinue(contextValue: unknown) {
    const context = learningContextSchema.parse(contextValue);
    return withLeasedConnection(this.#database, (connection) => {
      assertLocalLearningScope(connection, context);
      const row = connection
        .prepare(
          `SELECT p.activity_id, p.title, u.last_used_at
        FROM activity_usage u JOIN prepared_activities p USING(activity_id)
        LEFT JOIN flashcard_decks f USING(activity_id)
        WHERE p.status = 'prepared' AND p.target_language = ?
          AND json_extract(p.context_json, '$.learningScope.learnerId') = ?
          AND (json_extract(p.context_json, '$.learningScope.courseId') IS ?
            OR json_extract(p.context_json, '$.learningScope.courseId') IS NULL)
          AND (f.completed = 0 OR EXISTS (
            SELECT 1 FROM generated_activity_payloads g WHERE g.activity_id = p.activity_id
          ) OR json_type(p.context_json, '$.voiceContext') = 'object')
          AND NOT (p.activity_type = 'codex-listening'
            AND json_extract(p.context_json, '$.learningPath.mode') = 'course'
            AND EXISTS (
              SELECT 1 FROM course_marks m WHERE m.target_language = p.target_language
                AND m.version = json_extract(p.context_json, '$.learningPath.version')
                AND m.unit_id = json_extract(p.context_json, '$.learningPath.unitId')
                AND m.activity_key = json_extract(p.context_json, '$.learningPath.activityKey')
                AND m.status IN ('completed', 'skipped')
            ))
        ORDER BY u.last_used_at DESC, p.activity_id DESC LIMIT 1`,
        )
        .get(context.targetLanguage, context.learnerId, context.courseId);
      return row
        ? ninaContinueSchema.parse({
            activityId: row["activity_id"],
            title: row["title"],
            lastUsedAt: row["last_used_at"],
          })
        : null;
    });
  }

  async readDashboardSnapshot(onDateValue: string): Promise<DashboardSnapshot> {
    const onDate = calendarDateSchema.parse(onDateValue);
    return withLeasedConnection(this.#database, (connection) => {
      const preparedActivities = connection
        .prepare(
          `SELECT p.activity_id, p.activity_type, p.title, p.origin_surface, p.prepared_at,
             ${preparedActivityDeletionStatusSql} AS deletion_status
           FROM (SELECT * FROM prepared_activities WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) p
           WHERE p.status = 'prepared'
           ORDER BY prepared_at DESC, activity_id
           LIMIT 20`,
        )
        .all()
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            activityId: activityIdSchema.parse(row["activity_id"]),
            activityType: preparedActivitySchema.shape.activityType.parse(row["activity_type"]),
            title: preparedActivitySchema.shape.title.parse(row["title"]),
            originSurface: preparedActivitySchema.shape.originSurface.parse(row["origin_surface"]),
            preparedAt: utcInstantSchema.parse(row["prepared_at"]),
            deletionStatus: z
              .enum(["available", "cascade", "retained-data"])
              .parse(row["deletion_status"]),
          });
        });

      const dueVocabulary = connection
        .prepare(
          `SELECT vocabulary_id, lemma, meaning, due_on, stage
           FROM (SELECT * FROM vocabulary_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1))
           WHERE status = 'active' AND due_on <= ?
           ORDER BY due_on, vocabulary_id
           LIMIT 20`,
        )
        .all(onDate)
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            vocabularyId: vocabularyIdSchema.parse(row["vocabulary_id"]),
            lemma: z.string().min(1).max(160).parse(row["lemma"]),
            meaning: z.string().min(1).max(500).parse(row["meaning"]),
            dueOn: calendarDateSchema.parse(row["due_on"]),
            stage: z.int().min(1).max(12).parse(row["stage"]),
          });
        });

      const recentCorrections = connection
        .prepare(
          `SELECT c.correction_id, c.created_at,
            SUM(CASE WHEN cc.kind = 'unchanged' THEN 0 ELSE 1 END) AS changed_segment_count
           FROM corrections c JOIN attempts owner_attempt ON owner_attempt.attempt_id = c.attempt_id JOIN exercises owner_exercise ON owner_exercise.exercise_id = owner_attempt.exercise_id AND owner_exercise.target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)
           JOIN correction_changes cc ON cc.correction_id = c.correction_id
           WHERE c.state = 'final'
           GROUP BY c.correction_id, c.created_at
           ORDER BY c.created_at DESC, c.correction_id
           LIMIT 10`,
        )
        .all()
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            correctionId: correctionIdSchema.parse(row["correction_id"]),
            createdAt: utcInstantSchema.parse(row["created_at"]),
            changedSegmentCount: z.int().min(0).max(500).parse(row["changed_segment_count"]),
          });
        });

      const recurringMistakes = connection
        .prepare(
          `SELECT m.mistake_id, m.effective_category_json, COUNT(*) AS occurrence_count,
            MAX(o.observed_on) AS last_observed_on
           FROM (SELECT * FROM mistakes WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) m
           JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
           WHERE m.disposition = 'active'
           GROUP BY m.mistake_id, m.effective_category_json
           HAVING COUNT(*) >= 2
           ORDER BY last_observed_on DESC, m.mistake_id
           LIMIT 10`,
        )
        .all()
        .map((rawRow) => {
          const row = rawRow as Record<string, unknown>;
          return Object.freeze({
            mistakeId: mistakeIdSchema.parse(row["mistake_id"]),
            category: mistakeCategorySchema.parse(parseJson(row["effective_category_json"])),
            occurrenceCount: z.int().min(2).max(100).parse(row["occurrence_count"]),
            lastObservedOn: calendarDateSchema.parse(row["last_observed_on"]),
          });
        });

      return Object.freeze({
        rootGeneration: this.#database.rootGeneration,
        preparedActivities: Object.freeze(preparedActivities),
        dueVocabulary: Object.freeze(dueVocabulary),
        recentCorrections: Object.freeze(recentCorrections),
        recurringMistakes: Object.freeze(recurringMistakes),
      });
    });
  }

  async readSuggestionLearningScope(contextValue: unknown): Promise<LearningScope | undefined> {
    const context = practiceSuggestionContextSchema.parse(contextValue);
    return withLeasedConnection(this.#database, (connection) => {
      let scope: LearningScope | undefined;
      for (const [table, column, ids] of [
        ["mistakes", "mistake_id", context.mistakeIds],
        ["vocabulary_entries", "vocabulary_id", context.vocabularyIds],
      ] as const) {
        const statement = connection.prepare(
          `SELECT target_language FROM ${table} WHERE ${column} = ?`,
        );
        for (const id of ids) {
          const row = statement.get(id);
          if (!row) throw new Error("OD_PRACTICE_SUGGESTION_NOT_FOUND");
          const language = languageSchema.parse(row["target_language"]);
          if (scope && scope.targetLanguage !== language)
            throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
          scope = { ...scopeForLanguage(connection, language), courseId: null };
          assertLocalLearningScope(connection, scope);
        }
      }
      return scope;
    });
  }

  async readSuggestionLearningContext(contextValue: unknown, requestedScope?: LearningScope) {
    const context = practiceSuggestionContextSchema.parse(contextValue);
    return withLeasedConnection(this.#database, (connection) => {
      const scope = requestedScope ?? requireLocalLearningScope(connection);
      assertLocalLearningScope(connection, scope);
      const mistakes = connection
        .prepare(
          `SELECT m.mistake_id, m.effective_category_json, COUNT(*) AS occurrence_count,
          MAX(o.observed_on) AS last_observed_on
         FROM (SELECT * FROM mistakes WHERE target_language = ?) m JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
         WHERE m.disposition = 'active'
           AND m.mistake_id IN (SELECT value FROM json_each(?))
         GROUP BY m.mistake_id ORDER BY last_observed_on DESC, m.mistake_id LIMIT 12`,
        )
        .all(scope.targetLanguage, JSON.stringify(context.mistakeIds))
        .map((raw) => {
          const row = raw as Record<string, unknown>;
          const category = mistakeCategorySchema.parse(parseJson(row["effective_category_json"]));
          return {
            mistakeId: mistakeIdSchema.parse(row["mistake_id"]),
            summary: {
              kind: category.kind,
              categoryKey: category.categoryKey,
              ...(category.kind === "vocabulary" ? { lemma: category.lemma } : {}),
              occurrenceCount: z.int().min(1).max(100).parse(row["occurrence_count"]),
              lastObservedOn: calendarDateSchema.parse(row["last_observed_on"]),
            },
          };
        });
      const vocabulary = connection
        .prepare(
          `SELECT * FROM (SELECT * FROM vocabulary_entries WHERE target_language = ?) WHERE status = 'active'
         AND vocabulary_id IN (SELECT value FROM json_each(?))
         ORDER BY due_on, vocabulary_id LIMIT 24`,
        )
        .all(scope.targetLanguage, JSON.stringify(context.vocabularyIds))
        .map((row) => vocabularyEntryFromRow(row as Record<string, unknown>));
      return {
        relevantMistakes: mistakes
          .filter(({ summary }) => summary.occurrenceCount >= 2)
          .slice(0, 6)
          .map(({ summary }) => summary),
        relevantMistakeIds: mistakes.map(({ mistakeId }) => mistakeId),
        relevantVocabularyIds: vocabulary.map(({ vocabularyId }) => vocabularyId),
        vocabularyToReview: vocabulary.slice(0, 12).map((entry) => ({
          vocabularyId: entry.vocabularyId,
          lemma: entry.lemma,
          meaning: entry.meaning,
          ...(entry.examples[0] ? { example: entry.examples[0].text } : {}),
        })),
      };
    });
  }

  async readCorrectionMistakeSample(
    maximumValue = 6,
    requestedScope?: LearningScope,
  ): Promise<readonly CorrectionMistakeSample[]> {
    const maximum = z.int().min(0).max(6).parse(maximumValue);
    if (maximum === 0) return Object.freeze([]);
    return withLeasedConnection(this.#database, (connection) => {
      const scope = requestedScope ?? requireLocalLearningScope(connection);
      assertLocalLearningScope(connection, scope);
      return Object.freeze(
        connection
          .prepare(
            `SELECT m.effective_category_json, COUNT(*) AS occurrence_count,
              MAX(o.observed_on) AS last_observed_on
             FROM (SELECT * FROM mistakes WHERE target_language = ?) m
             JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
             WHERE m.disposition = 'active'
             GROUP BY m.mistake_id, m.effective_category_json
             HAVING COUNT(*) >= 2
             ORDER BY last_observed_on DESC, m.mistake_id
             LIMIT ?`,
          )
          .all(scope.targetLanguage, maximum)
          .map((rawRow) => {
            const row = rawRow as Record<string, unknown>;
            const category = mistakeCategorySchema.parse(parseJson(row["effective_category_json"]));
            const shared = {
              kind: category.kind,
              categoryKey: category.categoryKey,
              occurrenceCount: z.int().min(2).max(100).parse(row["occurrence_count"]),
              lastObservedOn: calendarDateSchema.parse(row["last_observed_on"]),
            } as const;
            return Object.freeze(
              category.kind === "vocabulary"
                ? { ...shared, kind: "vocabulary" as const, lemma: category.lemma }
                : { ...shared, kind: "grammar" as const },
            );
          }),
      );
    });
  }

  async listMistakePatterns(
    filterValue: z.input<typeof mistakePatternFilterSchema> = {},
    requestedScope?: LearningScope,
  ): Promise<readonly MistakePatternRecord[]> {
    const filter = mistakePatternFilterSchema.parse(filterValue);
    if (filter.fromDate && filter.toDate && filter.fromDate > filter.toDate) {
      throw new Error("OD_HISTORY_DATE_RANGE_INVALID");
    }
    return withLeasedConnection(this.#database, (connection) => {
      const scope = requestedScope ?? requireLocalLearningScope(connection);
      assertLocalLearningScope(connection, scope);
      const clauses = ["m.disposition = 'active'"];
      const parameters: string[] = [];
      if (filter.fromDate) {
        clauses.push("o.observed_on >= ?");
        parameters.push(filter.fromDate);
      }
      if (filter.toDate) {
        clauses.push("o.observed_on <= ?");
        parameters.push(filter.toDate);
      }
      if (filter.curriculumTopicId) {
        clauses.push(
          "EXISTS (SELECT 1 FROM json_each(m.effective_category_json, '$.curriculumTopicIds') WHERE value = ?)",
        );
        parameters.push(filter.curriculumTopicId);
      }
      if (filter.mistakeCategory) {
        clauses.push("json_extract(m.effective_category_json, '$.categoryKey') = ?");
        parameters.push(filter.mistakeCategory);
      }
      const rows = connection
        .prepare(
          `WITH ranked AS (
             SELECT m.mistake_id, m.effective_category_json, m.classification_source,
               o.observed_on, o.before_context, o.evidence_text, o.after_context, o.explanation,
               (SELECT l.activity_id FROM targeted_practice_links l
                 WHERE l.category_json = m.effective_category_json
                 ORDER BY l.created_at DESC, l.activity_id DESC LIMIT 1) AS targeted_activity_id,
               (SELECT l.created_at FROM targeted_practice_links l
                 WHERE l.category_json = m.effective_category_json
                 ORDER BY l.created_at DESC, l.activity_id DESC LIMIT 1) AS targeted_activity_created_at,
               COUNT(*) OVER (PARTITION BY m.effective_category_json) AS occurrence_count,
               MAX(o.observed_on) OVER (PARTITION BY m.effective_category_json) AS last_observed_on,
               ROW_NUMBER() OVER (
                 PARTITION BY m.effective_category_json
                 ORDER BY o.observed_on DESC, m.mistake_id, o.correction_id,
                   o.alignment_segment_position
               ) AS occurrence_position
             FROM (SELECT * FROM mistakes WHERE target_language = ?) m
             JOIN mistake_occurrences o ON o.mistake_id = m.mistake_id
             WHERE ${clauses.join(" AND ")}
           ), selected_categories AS (
             SELECT effective_category_json, last_observed_on
             FROM ranked
             GROUP BY effective_category_json, last_observed_on
             ORDER BY last_observed_on DESC, effective_category_json
             LIMIT ?
           )
           SELECT r.* FROM ranked r
           JOIN selected_categories s USING (effective_category_json, last_observed_on)
           WHERE r.occurrence_position <= 100
           ORDER BY r.last_observed_on DESC, r.effective_category_json,
             r.observed_on DESC, r.mistake_id, r.occurrence_position`,
        )
        .all(scope.targetLanguage, ...parameters, filter.maximum) as Record<string, unknown>[];
      const groups = new Map<
        string,
        {
          category: MistakeCategory;
          occurrenceCount: number;
          occurrences: Array<MistakePatternRecord["occurrences"][number]>;
          sources: Set<"inferred" | "learner-amended">;
          targetedPractice: MistakePatternRecord["targetedPractice"];
        }
      >();
      for (const row of rows) {
        const categoryJson = z.string().parse(row["effective_category_json"]);
        const classificationSource = z
          .enum(["inferred", "learner-amended"])
          .parse(row["classification_source"]);
        const group = groups.get(categoryJson) ?? {
          category: mistakeCategorySchema.parse(parseJson(categoryJson)),
          occurrenceCount: z.int().min(1).parse(row["occurrence_count"]),
          occurrences: [],
          sources: new Set<"inferred" | "learner-amended">(),
          targetedPractice:
            row["targeted_activity_id"] === null
              ? Object.freeze({ status: "not-created" as const })
              : Object.freeze({
                  status: "created" as const,
                  activityId: activityIdSchema.parse(row["targeted_activity_id"]),
                  createdAt: utcInstantSchema.parse(row["targeted_activity_created_at"]),
                }),
        };
        group.sources.add(classificationSource);
        group.occurrences.push(
          Object.freeze({
            mistakeId: mistakeIdSchema.parse(row["mistake_id"]),
            observedOn: calendarDateSchema.parse(row["observed_on"]),
            evidence: Object.freeze({
              beforeContext: z.string().max(500).parse(row["before_context"]),
              evidenceText: z.string().min(1).max(1_000).parse(row["evidence_text"]),
              afterContext: z.string().max(500).parse(row["after_context"]),
            }),
            explanation: z.string().min(1).max(800).parse(row["explanation"]),
            classificationSource,
          }),
        );
        groups.set(categoryJson, group);
      }
      return Object.freeze(
        [...groups.values()].map((group) => {
          const classificationSource: MistakePatternRecord["classificationSource"] =
            group.sources.size === 2
              ? "mixed"
              : (group.sources.values().next().value ?? "inferred");
          return Object.freeze({
            category: group.category,
            status: group.occurrenceCount >= 2 ? "recurring" : "single-occurrence",
            occurrenceCount: group.occurrenceCount,
            classificationSource,
            occurrences: Object.freeze(group.occurrences),
            targetedPractice: group.targetedPractice,
          });
        }),
      );
    });
  }

  async readHistorySkillTotals() {
    return withLeasedConnection(this.#database, (connection) => {
      const totals = { writing: 0, reading: 0, listening: 0, speaking: 0 };
      for (const row of connection
        .prepare(
          "SELECT skill, COUNT(*) AS count FROM (SELECT * FROM history_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) h WHERE NOT EXISTS (SELECT 1 FROM mcp_attempt_feedback f WHERE f.attempt_id = h.entity_id AND f.target_attempt_id IS NOT NULL) GROUP BY skill",
        )
        .all()) {
        const skill = z.enum(["writing", "reading", "listening", "speaking"]).parse(row["skill"]);
        totals[skill] = z.int().nonnegative().parse(row["count"]);
      }
      return totals;
    });
  }

  async listHistory(filterValue: HistoryFilter = {}): Promise<HistoryPageRecord> {
    const filter = historyFilterSchema.parse(filterValue);
    if (filter.fromDate && filter.toDate && filter.fromDate > filter.toDate) {
      throw new Error("OD_HISTORY_DATE_RANGE_INVALID");
    }
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (filter.skill !== undefined) {
      clauses.push("skill = ?");
      parameters.push(filter.skill);
    }
    if (filter.activityType !== undefined) {
      clauses.push("activity_type = ?");
      parameters.push(filter.activityType);
    }
    if (filter.fromDate !== undefined) {
      clauses.push("substr(occurred_at, 1, 10) >= ?");
      parameters.push(filter.fromDate);
    }
    if (filter.toDate !== undefined) {
      clauses.push("substr(occurred_at, 1, 10) <= ?");
      parameters.push(filter.toDate);
    }
    if (filter.curriculumTopicId !== undefined) {
      clauses.push(
        "EXISTS (SELECT 1 FROM history_curriculum_topics t WHERE t.history_entry_id = history_entries.history_entry_id AND t.curriculum_topic_id = ?)",
      );
      parameters.push(filter.curriculumTopicId);
    }
    if (filter.mistakeCategory !== undefined) {
      clauses.push(
        "EXISTS (SELECT 1 FROM history_mistake_categories m WHERE m.history_entry_id = history_entries.history_entry_id AND m.category = ?)",
      );
      parameters.push(filter.mistakeCategory);
    }
    if (filter.historyEntryIds) {
      clauses.push(`history_entry_id IN (${filter.historyEntryIds.map(() => "?").join(",")})`);
      parameters.push(...filter.historyEntryIds);
    }
    if (filter.search) {
      clauses.push("instr(lower(title), lower(?)) > 0");
      parameters.push(filter.search);
    }
    if (filter.activityId) {
      clauses.push(`${historyActivitySql("history_entries")} = ?`);
      parameters.push(filter.activityId);
    }
    if (filter.correctionId) {
      clauses.push(
        "EXISTS (SELECT 1 FROM corrections c WHERE c.correction_id = ? AND (c.attempt_id = history_entries.entity_id OR c.correction_id = history_entries.entity_id))",
      );
      parameters.push(filter.correctionId);
    }
    if (filter.cursor) {
      clauses.push("(occurred_at < ? OR (occurred_at = ? AND history_entry_id > ?))");
      parameters.push(
        filter.cursor.occurredAt,
        filter.cursor.occurredAt,
        filter.cursor.historyEntryId,
      );
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    return withLeasedConnection(this.#database, (connection) => {
      const entries = connection
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM prepared_activities p WHERE p.activity_id = ${historyActivitySql("history_entries")} AND p.target_language = history_entries.target_language) AS activity_available, target_language, history_entry_id, entity_kind, entity_id, skill, activity_type, title,
            occurred_at, reconstruction_json, root_generation
           FROM (SELECT * FROM history_entries WHERE target_language = (SELECT target_language FROM local_learning_scope WHERE singleton = 1)) history_entries ${where} ORDER BY occurred_at DESC, history_entry_id ASC LIMIT ?`,
        )
        .all(...parameters, filter.maximum + 1)
        .map((row) => {
          const record = row as Record<string, unknown>;
          const historyEntryId = historyEntryIdSchema.parse(record["history_entry_id"]);
          const curriculumTopicIds = connection
            .prepare(
              `SELECT curriculum_topic_id FROM history_curriculum_topics
               WHERE history_entry_id = ? ORDER BY curriculum_topic_id`,
            )
            .all(historyEntryId)
            .map((entry) => curriculumTopicIdSchema.parse(entry["curriculum_topic_id"]));
          const mistakeCategories = connection
            .prepare(
              `SELECT category FROM history_mistake_categories
               WHERE history_entry_id = ? ORDER BY category`,
            )
            .all(historyEntryId)
            .map((entry) => z.string().min(1).max(120).parse(entry["category"]));
          let detail: HistoryEntryRecord["detail"] = { kind: "reference" };
          const external = connection
            .prepare(
              "SELECT feedback_json, target_attempt_id FROM mcp_attempt_feedback WHERE attempt_id = ?",
            )
            .get(String(record["entity_id"]));
          if (external)
            detail = {
              kind: "attempt-feedback",
              feedback: attemptFeedbackSaveInputSchema.shape.feedback.parse(
                parseJson(external["feedback_json"]),
              ),
              later: external["target_attempt_id"] !== null,
            };
          else if (record["entity_kind"] === "attempt" && record["activity_type"] === "writing") {
            const entityId = attemptIdSchema.parse(record["entity_id"]);
            const writing = connection
              .prepare(
                `SELECT a.feedback_json, ans.answer_json, c.original_text, c.corrected_text,
                  c.ai_provenance_json, c.vocabulary_candidates_json, c.correction_id
                 FROM attempts a
                 JOIN answers ans ON ans.attempt_id = a.attempt_id AND ans.position = 0
                 JOIN corrections c ON c.attempt_id = a.attempt_id AND c.state = 'final'
                 WHERE a.attempt_id = ? AND a.status = 'completed'`,
              )
              .get(entityId) as Record<string, unknown> | undefined;
            if (writing) {
              const answer = exerciseAnswerSchema.parse(parseJson(writing["answer_json"]));
              if (answer.kind !== "free-writing") throw new Error("OD_HISTORY_WRITING_INVALID");
              const correctionId = correctionIdSchema.parse(writing["correction_id"]);
              const changes = connection
                .prepare(
                  `SELECT category, explanation FROM correction_changes
                   WHERE correction_id = ? AND kind <> 'unchanged' ORDER BY position`,
                )
                .all(correctionId)
                .map((entry) => ({
                  category: z.string().min(1).max(80).parse(entry["category"]),
                  explanation: z.string().min(1).max(800).parse(entry["explanation"]),
                }));
              detail = Object.freeze({
                kind: "writing-correction" as const,
                learnerText: answer.text,
                correctedText: z.string().min(1).max(12_000).parse(writing["corrected_text"]),
                feedback: attemptFeedbackSchema.parse(parseJson(writing["feedback_json"])),
                aiProvenance: aiProvenanceSchema.parse(parseJson(writing["ai_provenance_json"])),
                vocabularyCandidates: Object.freeze(
                  z
                    .array(correctionVocabularyCandidateSchema)
                    .max(50)
                    .parse(parseJson(writing["vocabulary_candidates_json"])),
                ),
                changes: Object.freeze(changes),
              });
            }
          } else if (record["entity_kind"] === "voice-summary") {
            const summary = voiceSummarySchema.parse(parseJson(record["reconstruction_json"]));
            detail = Object.freeze({
              kind: "voice-summary" as const,
              scenario: summary.scenario,
              duration: summary.duration,
              observedIssues: summary.observedIssues,
              vocabulary: summary.vocabulary,
              feedback: summary.feedback,
              nextSteps: summary.nextSteps,
            });
          } else if (record["entity_kind"] === "placement") {
            detail = Object.freeze({
              kind: "placement" as const,
              ...placementResultSchema.parse(parseJson(record["reconstruction_json"])),
            });
          } else if (
            record["entity_kind"] === "attempt" &&
            record["activity_type"] === "codex-listening"
          ) {
            detail = Object.freeze({
              kind: "listening" as const,
              ...listeningResultSchema.parse(parseJson(record["reconstruction_json"])),
            });
          }
          if (detail.kind === "reference" && record["entity_kind"] === "attempt") {
            const attemptId = attemptIdSchema.parse(record["entity_id"]);
            const reconstructed = generatedExerciseHistorySchema.safeParse(
              parseJson(record["reconstruction_json"], maximumExerciseHistoryBytes),
            );
            const source = connection
              .prepare(
                `SELECT e.activity_id, f.feedback_json, f.provenance_json FROM attempts a
                 JOIN exercises e ON e.exercise_id = a.exercise_id
                 LEFT JOIN exercise_attempt_feedback f ON f.attempt_id = a.attempt_id
                 WHERE a.attempt_id = ?`,
              )
              .get(attemptId) as Record<string, unknown> | undefined;
            if (reconstructed.success && source) {
              const activityId = activityIdSchema.parse(source["activity_id"]);
              const reference = reconstructed.data.snapshot.exercise.contentReference;
              let translation: Extract<
                HistoryEntryRecord["detail"],
                { kind: "exercise-attempt" }
              >["translation"];
              const translationSource = reference
                ? connection
                    .prepare(
                      `SELECT a.status, r.content_revision_id, g.output_json, f.feedback_json FROM attempts a
                       JOIN attempt_content_revisions r ON r.attempt_id = a.attempt_id AND r.activity_id = ?
                       JOIN generated_activity_payloads g ON g.activity_id = r.activity_id
                       LEFT JOIN exercise_attempt_feedback f ON f.attempt_id = a.attempt_id
                       WHERE a.attempt_id = ?`,
                    )
                    .get(activityId, attemptId)
                : undefined;
              if (
                translationSource?.["status"] === "completed" &&
                translationSource["feedback_json"] &&
                reference
              ) {
                // Historic reconstruction predates saved translations. Resolve its position
                // against the retained current content; never infer it from a new attempt.
                try {
                  const content = readStoredExerciseContent(
                    connection,
                    activityId,
                    parseJson(translationSource["output_json"], maximumExerciseContentBytes),
                  );
                  const feedback = storedExerciseFeedbackSchema.parse(
                    parseJson(translationSource["feedback_json"], maximumExerciseFeedbackBytes),
                  ).output;
                  const fields = {
                    summary: feedback.summary === reconstructed.data.feedback.summary,
                    strengths: reconstructed.data.feedback.strengths.flatMap((value, index) =>
                      feedback.strengths[index] === value ? [index] : [],
                    ),
                    improvements: reconstructed.data.feedback.improvements.flatMap(
                      (value, index) => (feedback.improvements[index] === value ? [index] : []),
                    ),
                  };
                  const position = content.exercises.findIndex(
                    (exercise) =>
                      exercise.exerciseId === reference.exercise.exerciseId &&
                      exercise.revisionId === reference.exercise.revisionId,
                  );
                  const active =
                    position >= 0
                      ? connection
                          .prepare(
                            `SELECT a.attempt_id FROM attempts a JOIN exercises e USING(exercise_id)
                             WHERE e.activity_id = ? AND a.status = 'in-progress'
                               AND json_extract(a.exercise_snapshot_json, '$.exercise.contentReference.exercise.revisionId') = ?`,
                          )
                          .get(activityId, content.exercises[position]?.revisionId ?? "")
                      : undefined;
                  if (
                    content.contentId === reference.contentId &&
                    content.revisionId === reference.revisionId &&
                    translationSource["content_revision_id"] === reference.revisionId &&
                    position >= 0 &&
                    !active &&
                    (fields.summary ||
                      fields.strengths.length > 0 ||
                      fields.improvements.length > 0)
                  ) {
                    translation = {
                      content: { contentId: content.contentId, revisionId: content.revisionId },
                      position,
                      attemptId,
                      fields,
                    };
                  }
                } catch {
                  // Older history remains readable when its source content is unavailable.
                }
              }
              detail = Object.freeze({
                ...reconstructed.data,
                activityId,
                feedbackProvenance: readStoredExerciseFeedback(source)?.provenance ?? null,
                ...(translation ? { translation } : {}),
              });
            }
          }
          return Object.freeze({
            activityAvailable: record["activity_available"] === 1,
            targetLanguage: languageSchema.parse(record["target_language"]),
            historyEntryId,
            evidence: historyAttemptEvidence(connection, historyEntryId),
            entityKind: z
              .enum(["attempt", "correction", "vocabulary-review", "voice-summary", "placement"])
              .parse(record["entity_kind"]),
            entityId: z.string().min(18).max(96).parse(record["entity_id"]),
            skill: z.enum(["writing", "reading", "listening", "speaking"]).parse(record["skill"]),
            activityType: historyActivityTypeSchema.parse(record["activity_type"]),
            title: z.string().min(1).max(160).parse(record["title"]),
            occurredAt: utcInstantSchema.parse(record["occurred_at"]),
            curriculumTopicIds: Object.freeze(curriculumTopicIds),
            mistakeCategories: Object.freeze(mistakeCategories),
            detail,
            rootGeneration: z.int().positive().parse(record["root_generation"]),
          }) satisfies HistoryEntryRecord;
        });
      const page = entries.slice(0, filter.maximum);
      const last = page.at(-1);
      return {
        entries: page,
        nextCursor:
          entries.length > filter.maximum && last
            ? { occurredAt: last.occurredAt, historyEntryId: last.historyEntryId }
            : null,
      };
    });
  }

  async deleteHistoryEntry(historyEntryIdValue: string, deletedAtValue: string): Promise<void> {
    const historyEntryId = historyEntryIdSchema.parse(historyEntryIdValue);
    const deletedAt = utcInstantSchema.parse(deletedAtValue);
    await withLeasedTransaction(this.#database, (connection) => {
      const entry = connection
        .prepare(
          `SELECT entity_kind, entity_id, activity_type, reconstruction_json FROM history_entries WHERE history_entry_id = ?`,
        )
        .get(historyEntryId) as
        | {
            entity_kind: string;
            entity_id: string;
            activity_type: string;
            reconstruction_json: string;
          }
        | undefined;
      if (!entry) throw new Error("OD_HISTORY_NOT_FOUND");
      if (entry.entity_kind === "voice-summary") {
        const voiceSessionId = z.string().min(18).max(96).parse(entry.entity_id);
        connection
          .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
          .run(historyEntryId);
        const result = connection
          .prepare(`DELETE FROM voice_summaries WHERE voice_session_id = ?`)
          .run(voiceSessionId);
        if (result.changes !== 1) throw new Error("OD_VOICE_SUMMARY_NOT_FOUND");
        return;
      }
      if (entry.entity_kind === "placement" || entry.entity_kind === "vocabulary-review") {
        // Removing a review from History must not rewind the word's review schedule.
        const result = connection
          .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
          .run(historyEntryId);
        if (result.changes !== 1) throw new Error("OD_HISTORY_NOT_FOUND");
        return;
      }
      if (
        entry.entity_kind === "attempt" &&
        connection
          .prepare("SELECT 1 FROM mcp_attempt_feedback WHERE attempt_id = ?")
          .get(entry.entity_id)
      ) {
        connection
          .prepare("DELETE FROM mcp_attempt_feedback WHERE attempt_id = ?")
          .run(entry.entity_id);
        return;
      }
      if (entry.entity_kind === "attempt" && entry.activity_type === "codex-listening") {
        const result = connection
          .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
          .run(historyEntryId);
        if (result.changes !== 1) throw new Error("OD_HISTORY_NOT_FOUND");
        return;
      }
      if (entry.entity_kind !== "attempt") throw new Error("OD_HISTORY_DELETE_UNSUPPORTED");
      const attemptId = attemptIdSchema.parse(entry.entity_id);
      connection
        .prepare(`DELETE FROM history_entries WHERE history_entry_id = ?`)
        .run(historyEntryId);
      connection
        .prepare(`INSERT INTO attempt_deletions (attempt_id, deleted_at) VALUES (?, ?)`)
        .run(attemptId, deletedAt);
      const result = connection.prepare(`DELETE FROM attempts WHERE attempt_id = ?`).run(attemptId);
      if (result.changes !== 1) throw new Error("OD_ATTEMPT_NOT_FOUND");
    });
  }
}
