import {
  activityIdSchema,
  attemptIdSchema,
  maximumExerciseContentBytes,
  maximumExerciseFeedbackBytes,
  maximumExerciseHistoryBytes,
  maximumExerciseSnapshotBytes,
  maximumMaterializedExerciseBytes,
  preparedActivitySchema,
  reuseExerciseActionSchema,
  utcInstantSchema,
  z,
  type ActivityAction,
  type AttemptId,
  type CourseEvidence,
  type LearningScope,
} from "@call-nina/contracts";
import {
  aiProvenanceSchema,
  assertSharedExerciseActivity,
  attemptFeedbackSchema,
  evaluateExerciseAnswer,
  exerciseAnswerSchema,
  materializeContentExercises,
  sameExerciseCourse,
  startedExerciseSnapshotSchema,
} from "@call-nina/domain";
import { createHash } from "node:crypto";
import { captureExerciseAttempt } from "./attempt-evidence.js";
import { preparePortableContent, readStoredExerciseContent } from "./content.js";
import {
  copyCapturedExerciseContext,
  readCapturedExerciseContext,
  saveCapturedExerciseContext,
} from "./exercise-context.js";
import { claimIdempotentWrite, type IdempotentWriteResult } from "./idempotency.js";
import {
  activityLearningScope,
  assertActivityReferences,
  assertRegisteredLearningScope as assertLocalLearningScope,
  parseScopedActivityContext,
} from "./learning-context.js";
import { saveCourseEvidence } from "./learning-path.js";
import { linkPortableContent } from "./materials.js";
import {
  type ActiveGeneratedExerciseSet,
  type GeneratedActivityRead,
  type GeneratedExerciseAnswerSave,
  type GeneratedExerciseSetAbandon,
  type GeneratedExerciseSetComplete,
  type GeneratedExerciseSetStart,
  type GeneratedPracticeActivity,
  activeGeneratedExerciseSetSchema,
  generatedActivityReadSchema,
  generatedExerciseAnswerSaveSchema,
  generatedExerciseFeedbackSaveSchema,
  generatedExerciseHistorySchema,
  generatedExerciseSetAbandonSchema,
  generatedExerciseSetCompleteSchema,
  generatedExerciseSetStartSchema,
  generatedPracticeActivitySchema,
  historyActivityTypeSchema,
  insertActivityVocabularyCandidates,
  parseJson,
  readGeneratedExerciseAttempt,
  readStoredExerciseFeedback,
  stringifyBounded,
} from "./repository-support.js";
import { withLeasedConnection, withLeasedTransaction, type CallNinaDatabase } from "./sqlite.js";
import { copySupportingTranslations } from "./translation.js";

export class ExercisesRepository {
  readonly #database: CallNinaDatabase;
  constructor(database: CallNinaDatabase) {
    this.#database = database;
  }

  async saveGeneratedPracticeActivity(
    value: GeneratedPracticeActivity,
    idempotencyKey: string,
  ): Promise<IdempotentWriteResult> {
    const record = generatedPracticeActivitySchema.parse(value);
    if (record.aiProvenance.producer !== "desktop-app-server") {
      throw new Error("OD_GENERATED_PRACTICE_PROVENANCE_INVALID");
    }
    const modelSelection = record.aiProvenance.modelSelection;
    return withLeasedTransaction(this.#database, (connection) => {
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
      for (const topicId of record.activity.context.curriculumTopicIds) {
        insertReference.run(record.activity.activityId, "curriculum-topic", topicId);
      }
      for (const mistakeId of record.activity.context.mistakeIds) {
        insertReference.run(record.activity.activityId, "mistake", mistakeId);
      }
      for (const vocabularyId of record.activity.context.vocabularyIds) {
        insertReference.run(record.activity.activityId, "vocabulary", vocabularyId);
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

  /** Reuse the exact immutable payload, with fresh ownership supplied by this entry point. */
  async reuseGeneratedActivity(value: Extract<ActivityAction, { action: "reuse-exercises" }>) {
    const action = reuseExerciseActionSchema.parse(value);
    if (action.expectedGeneration !== this.#database.rootGeneration)
      throw new Error("OD_DATA_ROOT_STALE");
    const activityId = activityIdSchema.parse(
      `activity_${createHash("sha256").update(action.launchId).digest("hex").slice(0, 32)}`,
    );
    return withLeasedTransaction(this.#database, (connection) => {
      const now = utcInstantSchema.parse(new Date().toISOString());
      const claim = claimIdempotentWrite(connection, {
        operation: "prepared-activity",
        idempotencyKey: action.launchId,
        request: action,
        entityId: activityId,
        recordedAt: now,
      });
      if (claim.replayed) return { activityId };
      const row = connection
        .prepare(
          `SELECT a.*, p.output_json FROM prepared_activities a
        JOIN generated_activity_payloads p USING(activity_id) WHERE a.activity_id = ?`,
        )
        .get(action.activityId);
      if (!row) throw new Error("OD_ACTIVITY_NOT_FOUND");
      const source = assertSharedExerciseActivity({
        activityId: row["activity_id"],
        activityType: row["activity_type"],
        title: row["title"],
        originSurface: row["origin_surface"],
        preparedAt: row["prepared_at"],
        context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
      });
      const content = readStoredExerciseContent(
        connection,
        source.activityId,
        parseJson(row["output_json"], maximumExerciseContentBytes),
      );
      if (
        content.contentId !== action.content.contentId ||
        content.revisionId !== action.content.revisionId
      )
        throw new Error("OD_ATTEMPT_REVISION_MISMATCH");
      if (
        action.context.origin === "learning-path" &&
        (!source.context.learningPath ||
          !sameExerciseCourse(action.context.reference, source.context.learningPath))
      )
        throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
      if (
        action.context.origin === "materials" &&
        !["reading", "vocabulary-review"].includes(source.activityType)
      )
        throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
      // Teaching facts and criteria belong to the reused exercise; only the
      // learning-path reference authorizes course attribution and progress.
      const { learningPath, ...context } = source.context;
      const activity = preparedActivitySchema.parse({
        ...source,
        activityId,
        originSurface: "desktop",
        preparedAt: now,
        context: {
          ...context,
          entry: action.context,
          ...(action.context.origin === "learning-path" ? { learningPath } : {}),
        },
      });
      assertLocalLearningScope(connection, activity.context.learningScope);
      connection
        .prepare(
          `INSERT INTO prepared_activities(target_language, activity_id, activity_type, title, origin_surface, context_json, prepared_at, root_generation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          activity.context.learningScope.targetLanguage,
          activityId,
          activity.activityType,
          activity.title,
          activity.originSurface,
          stringifyBounded(activity.context),
          now,
          this.#database.rootGeneration,
        );
      connection
        .prepare(
          `INSERT INTO generated_activity_payloads(activity_id, workload, model_request_id, model_id, effort_id, generated_at, output_json)
        SELECT ?, workload, model_request_id, model_id, effort_id, generated_at, output_json FROM generated_activity_payloads WHERE activity_id = ?`,
        )
        .run(activityId, source.activityId);
      linkPortableContent(connection, activityId, content, "reused-or-historic");
      copyCapturedExerciseContext(connection, source.activityId, activityId, content);
      copySupportingTranslations(connection, source.activityId, activityId, content);
      connection
        .prepare(
          `INSERT INTO activity_context_references(activity_id, reference_kind, reference_id)
        SELECT ?, reference_kind, reference_id FROM activity_context_references WHERE activity_id = ?`,
        )
        .run(activityId, source.activityId);
      return { activityId };
    });
  }

  async saveGeneratedExerciseFeedback(
    activityIdValue: string,
    attemptIdValue: string,
    value: unknown,
  ) {
    const activityId = activityIdSchema.parse(activityIdValue);
    const attemptId = attemptIdSchema.parse(attemptIdValue);
    const feedback = generatedExerciseFeedbackSaveSchema.parse(value);
    await withLeasedTransaction(this.#database, (connection) => {
      const {
        snapshot,
        answer,
        feedback: existing,
      } = readGeneratedExerciseAttempt(connection, activityId, attemptId);
      if (!answer) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      const evaluation = evaluateExerciseAnswer(
        snapshot.exercise,
        answer,
        activityLearningScope(connection, activityId).targetLanguage,
      );
      if (
        evaluation.status !== "requires-ai" ||
        feedback.output.objectiveEvaluations.length !== snapshot.exercise.objectives.length
      )
        throw new Error("OD_EXERCISE_AI_FEEDBACK_INVALID");
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(feedback))
          throw new Error("OD_EXERCISE_FEEDBACK_IMMUTABLE");
        return;
      }
      connection
        .prepare(
          "INSERT INTO exercise_attempt_feedback(attempt_id, feedback_json, provenance_json) VALUES (?, ?, ?)",
        )
        .run(
          attemptId,
          stringifyBounded(
            { modelRequestId: feedback.modelRequestId, output: feedback.output },
            maximumExerciseFeedbackBytes,
          ),
          stringifyBounded(feedback.provenance),
        );
    });
  }

  async readGeneratedExerciseContext(activityIdValue: string, attemptIdValue?: string) {
    const activityId = activityIdSchema.parse(activityIdValue);
    const attemptId =
      attemptIdValue === undefined ? undefined : attemptIdSchema.parse(attemptIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      if (attemptId) {
        const { content } = readGeneratedExerciseAttempt(connection, activityId, attemptId);
        return readCapturedExerciseContext(connection, activityId, content);
      }
      const row = connection
        .prepare("SELECT output_json FROM generated_activity_payloads WHERE activity_id = ?")
        .get(activityId);
      if (!row) throw new Error("OD_EXERCISE_CONTEXT_MISSING");
      const content = readStoredExerciseContent(
        connection,
        activityId,
        parseJson(row["output_json"], maximumExerciseContentBytes),
      );
      return readCapturedExerciseContext(connection, activityId, content);
    });
  }

  async readGeneratedActivity(activityIdValue: string): Promise<GeneratedActivityRead | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT a.activity_id, a.title, a.context_json, p.model_request_id,
            p.model_id, p.effort_id, p.generated_at, p.output_json
           FROM prepared_activities a
           JOIN generated_activity_payloads p ON p.activity_id = a.activity_id
           WHERE a.activity_id = ? AND a.status IN ('prepared', 'completed')`,
        )
        .get(activityId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return generatedActivityReadSchema.parse({
        activityId: row["activity_id"],
        title: row["title"],
        context: parseScopedActivityContext(connection, parseJson(row["context_json"])),
        aiProvenance: {
          source: "ai",
          producer: "desktop-app-server",
          modelRequestId: row["model_request_id"],
          generatedAt: row["generated_at"],
          modelSelection: {
            availability: "reported",
            modelId: row["model_id"],
            effortId: row["effort_id"],
          },
        },
        content: readStoredExerciseContent(
          connection,
          activityId,
          parseJson(row["output_json"], maximumExerciseContentBytes),
        ),
      });
    });
  }

  async readActiveGeneratedExerciseSet(
    activityIdValue: string,
  ): Promise<ActiveGeneratedExerciseSet | undefined> {
    const activityId = activityIdSchema.parse(activityIdValue);
    return withLeasedConnection(this.#database, (connection) => {
      const rows = connection
        .prepare(
          `SELECT a.attempt_id, a.started_at, ans.answer_json, f.feedback_json, f.provenance_json, coalesce(s.hints_used, 0) AS hints_used FROM attempts a
           JOIN exercises e ON e.exercise_id = a.exercise_id
           LEFT JOIN answers ans ON ans.attempt_id = a.attempt_id AND ans.position = 0
           LEFT JOIN exercise_attempt_feedback f ON f.attempt_id = a.attempt_id
           LEFT JOIN exercise_support s ON s.attempt_id = a.attempt_id
           WHERE e.activity_id = ? AND a.status = 'in-progress'
           ORDER BY e.rowid`,
        )
        .all(activityId) as Record<string, unknown>[];
      if (rows.length === 0) return undefined;
      const startedAt = utcInstantSchema.parse(rows[0]?.["started_at"]);
      if (rows.some((row) => row["started_at"] !== startedAt)) {
        throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      }
      return activeGeneratedExerciseSetSchema.parse({
        startedAt,
        attemptIds: rows.map((row) => attemptIdSchema.parse(row["attempt_id"])),
        progress: rows.map((row) => {
          const feedback = readStoredExerciseFeedback(row);
          return {
            answer: row["answer_json"]
              ? exerciseAnswerSchema.parse(parseJson(row["answer_json"]))
              : null,
            feedback: feedback?.output ?? null,
            feedbackProvenance: feedback?.provenance ?? null,
            hintsUsed: row["hints_used"],
          };
        }),
      });
    });
  }

  async startGeneratedExerciseSet(value: GeneratedExerciseSetStart) {
    const record = generatedExerciseSetStartSchema.parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const row = connection
        .prepare(
          `SELECT a.context_json, p.model_request_id, p.model_id, p.effort_id,
            p.generated_at, p.output_json
           FROM prepared_activities a
           JOIN generated_activity_payloads p ON p.activity_id = a.activity_id
           WHERE a.activity_id = ? AND a.status IN ('prepared', 'completed')`,
        )
        .get(record.activityId) as Record<string, unknown> | undefined;
      if (!row) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
      const first = record.exercises[0];
      if (!first) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      const replay = connection
        .prepare(
          `SELECT a.started_at, e.activity_id FROM attempts a JOIN exercises e USING(exercise_id) WHERE a.attempt_id = ?`,
        )
        .get(first.attemptId);
      if (replay) {
        for (const item of record.exercises) {
          const attempt = connection
            .prepare(
              `SELECT a.started_at, e.activity_id, a.exercise_id FROM attempts a JOIN exercises e USING(exercise_id) WHERE a.attempt_id = ?`,
            )
            .get(item.attemptId);
          if (
            !attempt ||
            attempt["activity_id"] !== record.activityId ||
            attempt["started_at"] !== replay["started_at"] ||
            attempt["exercise_id"] !== item.snapshot.exercise.exerciseId
          )
            throw new Error("OD_IDEMPOTENCY_CONFLICT");
        }
        return {
          startedAt: utcInstantSchema.parse(replay["started_at"]),
          attemptIds: record.exercises.map((item) => item.attemptId),
        };
      }
      const active = connection
        .prepare(
          `SELECT a.attempt_id, a.started_at FROM attempts a JOIN exercises e USING(exercise_id) WHERE e.activity_id = ? AND a.status = 'in-progress'`,
        )
        .all(record.activityId);
      const activeIds = active.map((item) => String(item["attempt_id"])).sort();
      if (JSON.stringify(activeIds) !== JSON.stringify([...record.replaces].sort()))
        throw new Error("OD_EXERCISE_ATTEMPT_SET_ACTIVE");
      // End the explicitly replaced set and create its successor in the same transaction.
      for (const attempt of active)
        connection
          .prepare(
            `UPDATE attempts SET status = 'abandoned', terminal_after_previous_event_ms = ? WHERE attempt_id = ?`,
          )
          .run(
            Math.max(0, Date.parse(record.startedAt) - Date.parse(String(attempt["started_at"]))),
            String(attempt["attempt_id"]),
          );
      connection
        .prepare(
          "UPDATE prepared_activities SET status = 'prepared', completed_at = NULL WHERE activity_id = ?",
        )
        .run(record.activityId);
      const context = parseScopedActivityContext(connection, parseJson(row["context_json"]));
      const provenance = aiProvenanceSchema.parse({
        source: "ai",
        producer: "desktop-app-server",
        modelRequestId: row["model_request_id"],
        generatedAt: row["generated_at"],
        modelSelection: {
          availability: "reported",
          modelId: row["model_id"],
          effortId: row["effort_id"],
        },
      });
      const content = readStoredExerciseContent(
        connection,
        record.activityId,
        parseJson(row["output_json"], maximumExerciseContentBytes),
      );
      const materializeOptions = {
        exerciseIds: record.exercises.map(({ snapshot }) => snapshot.exercise.exerciseId),
        aiProvenance: provenance,
        curriculumTopicIds: context.curriculumTopicIds,
      };
      const expected = materializeContentExercises(content, materializeOptions);
      for (const [position, exercise] of expected.entries()) {
        const started = record.exercises[position];
        if (
          !started ||
          started.snapshot.startedAt !== record.startedAt ||
          JSON.stringify(started.snapshot.exercise) !== JSON.stringify(exercise)
        ) {
          throw new Error("OD_GENERATED_ACTIVITY_SNAPSHOT_INVALID");
        }
        connection
          .prepare(
            `INSERT INTO exercises (learning_scope_json, target_language,
              exercise_id, activity_id, kind, cefr_band, started_at, objectives_json,
              instructions, explanation, content_json, answer_contract_json,
              ai_provenance_json, snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            JSON.stringify(activityLearningScope(connection, record.activityId)),
            activityLearningScope(connection, record.activityId).targetLanguage,
            exercise.exerciseId,
            record.activityId,
            exercise.kind,
            exercise.cefrBand,
            record.startedAt,
            stringifyBounded(exercise.objectives),
            exercise.instructions,
            exercise.explanation ?? null,
            stringifyBounded(exercise.content, maximumMaterializedExerciseBytes),
            stringifyBounded(exercise.answerContract, maximumMaterializedExerciseBytes),
            stringifyBounded(exercise.aiProvenance),
            stringifyBounded(started.snapshot, maximumExerciseSnapshotBytes),
          );
        connection
          .prepare(
            `INSERT INTO attempts (
              attempt_id, exercise_id, status, started_at, exercise_snapshot_json
            ) VALUES (?, ?, 'in-progress', ?, ?)`,
          )
          .run(
            started.attemptId,
            exercise.exerciseId,
            record.startedAt,
            stringifyBounded(started.snapshot, maximumExerciseSnapshotBytes),
          );
        connection
          .prepare(
            "INSERT INTO attempt_content_revisions(attempt_id, activity_id, content_revision_id) VALUES (?, ?, ?)",
          )
          .run(started.attemptId, record.activityId, content.revisionId);
        captureExerciseAttempt(connection, started.attemptId);
      }
      return {
        startedAt: record.startedAt,
        attemptIds: record.exercises.map((item) => item.attemptId),
      };
    });
  }

  async saveGeneratedExerciseAnswer(value: GeneratedExerciseAnswerSave) {
    const record = generatedExerciseAnswerSaveSchema.parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const { snapshot, answer, feedback } = readGeneratedExerciseAttempt(
        connection,
        record.activityId,
        record.attemptId,
      );
      evaluateExerciseAnswer(
        snapshot.exercise,
        record.answer,
        activityLearningScope(connection, record.activityId).targetLanguage,
      );
      if (answer) {
        if (JSON.stringify(answer) !== JSON.stringify(record.answer))
          throw new Error("OD_EXERCISE_ANSWER_CONFLICT");
        // Recovery reads the original result without completing or recapturing evidence.
        return { snapshot, feedback };
      }
      const elapsed = Math.max(0, Date.parse(record.submittedAt) - Date.parse(snapshot.startedAt));
      connection
        .prepare(
          `INSERT INTO answers (
            attempt_id, position, submitted_after_previous_event_ms, answer_json
          ) VALUES (?, 0, ?, ?)`,
        )
        .run(record.attemptId, elapsed, stringifyBounded(record.answer));
      captureExerciseAttempt(connection, record.attemptId);
      return { snapshot, feedback: null };
    });
  }

  async recordCourseHelperSupport(intent: "chat" | "translate", scope: LearningScope) {
    await withLeasedTransaction(this.#database, (connection) => {
      assertLocalLearningScope(connection, scope);
      connection
        .prepare(
          `INSERT INTO exercise_support (attempt_id, hints_used, helper_used, translation_used)
        SELECT a.attempt_id, 0, 1, ? FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
        JOIN prepared_activities p ON p.activity_id = e.activity_id
        WHERE a.status = 'in-progress' AND e.target_language = ?
        ON CONFLICT(attempt_id) DO UPDATE SET helper_used = 1, translation_used = max(translation_used, excluded.translation_used)`,
        )
        .run(intent === "translate" ? 1 : 0, scope.targetLanguage);
      connection
        .prepare(
          `INSERT INTO course_activity_support (activity_id, helper_used, translation_used)
        SELECT DISTINCT e.activity_id, 1, ? FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
        JOIN prepared_activities p ON p.activity_id = e.activity_id
        WHERE a.status = 'in-progress' AND e.target_language = ? AND json_type(p.context_json, '$.learningPath') = 'object'
        ON CONFLICT(activity_id) DO UPDATE SET helper_used = 1, translation_used = max(translation_used, excluded.translation_used)`,
        )
        .run(intent === "translate" ? 1 : 0, scope.targetLanguage);
      for (const row of connection
        .prepare(
          "SELECT a.attempt_id FROM attempts a JOIN exercises e USING(exercise_id) WHERE a.status = 'in-progress' AND e.target_language = ?",
        )
        .all(scope.targetLanguage))
        captureExerciseAttempt(connection, String(row["attempt_id"]));
    });
  }

  async recordExerciseSupport(activityId: string, attemptId: string) {
    await withLeasedTransaction(this.#database, (connection) => {
      const attempt = connection
        .prepare(
          "SELECT 1 FROM attempts a JOIN exercises e ON a.exercise_id = e.exercise_id WHERE a.attempt_id = ? AND e.activity_id = ? AND a.status = 'in-progress'",
        )
        .get(attemptId, activityId);
      if (!attempt) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      connection
        .prepare(
          "INSERT INTO exercise_support (attempt_id, hints_used) VALUES (?, 1) ON CONFLICT(attempt_id) DO UPDATE SET hints_used = hints_used + 1",
        )
        .run(attemptId);
      connection
        .prepare(
          `INSERT INTO course_activity_support (activity_id, hints_used)
        SELECT activity_id, 1 FROM prepared_activities WHERE activity_id = ? AND json_type(context_json, '$.learningPath') = 'object'
        ON CONFLICT(activity_id) DO UPDATE SET hints_used = 1`,
        )
        .run(activityId);
      captureExerciseAttempt(connection, attemptId);
    });
  }

  async completeGeneratedExerciseSet(value: GeneratedExerciseSetComplete): Promise<void> {
    const record = generatedExerciseSetCompleteSchema.parse(value);
    if (new Set(record.answers.map(({ attemptId }) => attemptId)).size !== record.answers.length) {
      throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
    }
    await withLeasedTransaction(this.#database, (connection) => {
      const completionKey = [...record.answers.map((answer) => answer.attemptId)].sort().join(":");
      const claim = claimIdempotentWrite(connection, {
        operation: "attempt-completion",
        idempotencyKey: createHash("sha256").update(completionKey).digest("hex"),
        request: {
          activityId: record.activityId,
          answers: record.answers
            .map(({ attemptId, answer }) => ({ attemptId, answer }))
            .sort((left, right) => left.attemptId.localeCompare(right.attemptId)),
        },
        entityId: record.activityId,
        recordedAt: record.completedAt,
      });
      if (claim.replayed) return;
      const activity = connection
        .prepare(
          `SELECT title, activity_type, context_json FROM prepared_activities
           WHERE activity_id = ? AND status = 'prepared'`,
        )
        .get(record.activityId) as Record<string, unknown> | undefined;
      if (!activity) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
      const activityTitle = z.string().min(1).max(160).parse(activity["title"]);
      const activityType = historyActivityTypeSchema.parse(activity["activity_type"]);
      const activityContext = parseScopedActivityContext(
        connection,
        parseJson(activity["context_json"]),
      );
      const payload = connection
        .prepare("SELECT output_json FROM generated_activity_payloads WHERE activity_id = ?")
        .get(record.activityId) as { output_json: string } | undefined;
      if (!payload) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
      const readingMaterial = readStoredExerciseContent(
        connection,
        record.activityId,
        parseJson(payload.output_json, maximumExerciseContentBytes),
      ).payload.readingMaterial;
      const expectedCount = (
        connection
          .prepare(
            `SELECT count(*) AS count FROM attempts a
               JOIN exercises e ON e.exercise_id = a.exercise_id
               WHERE e.activity_id = ? AND a.status = 'in-progress'`,
          )
          .get(record.activityId) as { count: number }
      ).count;
      if (expectedCount !== record.answers.length) {
        throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      }
      for (const item of record.answers) {
        const row = connection
          .prepare(
            `SELECT a.started_at, a.exercise_snapshot_json
             FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
             WHERE a.attempt_id = ? AND a.status = 'in-progress' AND e.activity_id = ?`,
          )
          .get(item.attemptId, record.activityId) as Record<string, unknown> | undefined;
        if (!row) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
        const snapshot = startedExerciseSnapshotSchema.parse(
          parseJson(row["exercise_snapshot_json"], maximumExerciseSnapshotBytes),
        );
        const evaluation = evaluateExerciseAnswer(
          snapshot.exercise,
          item.answer,
          activityLearningScope(connection, record.activityId).targetLanguage,
        );
        const feedbackRow = connection
          .prepare(
            "SELECT feedback_json, provenance_json FROM exercise_attempt_feedback WHERE attempt_id = ?",
          )
          .get(item.attemptId);
        const retainedFeedback = feedbackRow ? readStoredExerciseFeedback(feedbackRow) : undefined;
        if (evaluation.status === "requires-ai" && !retainedFeedback) {
          throw new Error("OD_EXERCISE_AI_FEEDBACK_REQUIRED");
        }
        const elapsed = Math.max(
          0,
          Date.parse(record.completedAt) - Date.parse(utcInstantSchema.parse(row["started_at"])),
        );
        const existingAnswer = connection
          .prepare(`SELECT answer_json FROM answers WHERE attempt_id = ? AND position = 0`)
          .get(item.attemptId) as { answer_json: string } | undefined;
        if (existingAnswer) {
          if (
            JSON.stringify(exerciseAnswerSchema.parse(parseJson(existingAnswer.answer_json))) !==
            JSON.stringify(item.answer)
          ) {
            throw new Error("OD_EXERCISE_ANSWER_CONFLICT");
          }
        } else {
          connection
            .prepare(
              `INSERT INTO answers (
                attempt_id, position, submitted_after_previous_event_ms, answer_json
              ) VALUES (?, 0, ?, ?)`,
            )
            .run(item.attemptId, elapsed, stringifyBounded(item.answer));
        }
        let objectiveEvaluations;
        let feedback;
        if (evaluation.status === "requires-ai") {
          const ai = retainedFeedback;
          if (
            !ai ||
            ai.output.objectiveEvaluations.length !== snapshot.exercise.objectives.length
          ) {
            throw new Error("OD_EXERCISE_AI_FEEDBACK_INVALID");
          }
          objectiveEvaluations = ai.output.objectiveEvaluations;
          feedback = attemptFeedbackSchema.parse({
            source: { kind: "ai", modelRequestId: ai.modelRequestId },
            summary: ai.output.summary,
            strengths: ai.output.strengths,
            improvements: [...ai.output.improvements, ...ai.output.caveats].slice(0, 20),
            ...(ai.output.nextStep ? { nextStep: ai.output.nextStep } : {}),
            overallUncertainty: ai.output.overallUncertainty,
            mistakeIds: [],
            vocabularyCandidateIds: [],
          });
        } else {
          const outcome: "demonstrated" | "developing" | "not-demonstrated" =
            evaluation.status === "correct"
              ? "demonstrated"
              : evaluation.status === "almost-correct"
                ? "developing"
                : "not-demonstrated";
          objectiveEvaluations = snapshot.exercise.objectives.map(() => ({
            outcome,
            evidence:
              evaluation.status === "correct"
                ? "The submitted answer matched the exercise contract."
                : evaluation.status === "almost-correct"
                  ? "The submitted answer was close to an accepted answer with minor spelling " +
                    "or diacritic differences."
                  : "The submitted answer did not match the exercise contract.",
            uncertainty: { level: "none" as const },
          }));
          feedback = attemptFeedbackSchema.parse({
            source: { kind: "deterministic" },
            summary:
              evaluation.status === "correct"
                ? "The answer matched the accepted exercise evidence."
                : evaluation.status === "almost-correct"
                  ? "The answer was nearly correct and needs only minor spelling or diacritic review."
                  : "The answer needs review against the accepted exercise evidence.",
            strengths:
              evaluation.status === "correct"
                ? ["The submitted answer was accepted."]
                : evaluation.status === "almost-correct"
                  ? ["The submitted answer was close to an accepted correction."]
                  : [],
            improvements:
              evaluation.status === "almost-correct" || evaluation.status === "incorrect"
                ? ["Review the revealed accepted answer."]
                : [],
            overallUncertainty: { level: "none" },
            mistakeIds: [],
            vocabularyCandidateIds: [],
          });
        }
        connection
          .prepare(
            `UPDATE attempts SET status = 'completed', terminal_after_previous_event_ms = ?,
              objective_evaluations_json = ?, feedback_json = ?
             WHERE attempt_id = ? AND status = 'in-progress'`,
          )
          .run(
            elapsed,
            stringifyBounded(objectiveEvaluations),
            stringifyBounded(feedback, maximumExerciseFeedbackBytes),
            item.attemptId,
          );
        const reconstruction = generatedExerciseHistorySchema.parse({
          kind: "exercise-attempt",
          readingMaterial,
          snapshot,
          answer: item.answer,
          objectiveEvaluations,
          feedback,
          suggestedAnswer:
            evaluation.status === "requires-ai"
              ? (retainedFeedback?.output.suggestedAnswer ?? null)
              : null,
        });
        const skill =
          activityType === "reading"
            ? "reading"
            : snapshot.exercise.kind === "free-writing" ||
                snapshot.exercise.kind === "short-answer" ||
                snapshot.exercise.kind === "sentence-correction"
              ? "writing"
              : "reading";
        connection
          .prepare(
            `INSERT INTO history_entries (
              history_entry_id, entity_kind, entity_id, skill, activity_type, title,
              occurred_at, reconstruction_json, root_generation
            ) VALUES (?, 'attempt', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.historyEntryId,
            item.attemptId,
            skill,
            activityType,
            activityTitle,
            record.completedAt,
            stringifyBounded(reconstruction, maximumExerciseHistoryBytes),
            this.#database.rootGeneration,
          );
        captureExerciseAttempt(connection, item.attemptId);
        if (activityContext.learningPath) {
          const teaching = activityContext.courseTeaching;
          const repeatedAttempt = !!connection
            .prepare(
              `SELECT 1 FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id JOIN activity_content_revisions c ON c.activity_id = e.activity_id WHERE c.revision_id = (SELECT revision_id FROM activity_content_revisions WHERE activity_id = ?) AND a.started_at < ? LIMIT 1`,
            )
            .get(record.activityId, snapshot.startedAt);
          const assistance = connection
            .prepare(
              "SELECT max(hints_used) AS hints_used, max(helper_used) AS helper_used, max(translation_used) AS translation_used FROM (SELECT hints_used, helper_used, translation_used FROM exercise_support WHERE attempt_id = ? UNION ALL SELECT hints_used, helper_used, translation_used FROM course_activity_support WHERE activity_id = ?)",
            )
            .get(item.attemptId, record.activityId) as
            { hints_used: number; helper_used: number; translation_used: number } | undefined;
          const hints = assistance?.hints_used ?? 0;
          const evidence: CourseEvidence[] = teaching
            ? objectiveEvaluations.flatMap((evaluation, index) => {
                const description = snapshot.exercise.objectives[index]?.description;
                const objective = teaching.objectives.find((o) => o.description === description);
                const skill = teaching.delivery === "practice" ? "writing" : teaching.delivery;
                if (!objective || !["reading", "writing"].includes(skill)) return [];
                const supported =
                  hints > 0 ||
                  repeatedAttempt ||
                  assistance?.helper_used === 1 ||
                  assistance?.translation_used === 1 ||
                  teaching.priorFeedback ||
                  teaching.purpose === "practice";
                return [
                  {
                    objectiveId: objective.id,
                    skill: skill as "reading" | "writing",
                    outcome:
                      evaluation.outcome === "demonstrated"
                        ? supported
                          ? "supported"
                          : teaching.purpose === "review"
                            ? "transfer"
                            : "independent"
                        : evaluation.outcome === "not-evaluated"
                          ? "not-evaluated"
                          : "not-yet",
                    ...(objective.targetId
                      ? {
                          retrieval:
                            snapshot.exercise.kind === "multiple-choice"
                              ? ("recognition" as const)
                              : snapshot.exercise.kind === "free-writing"
                                ? ("use" as const)
                                : ("recall" as const),
                        }
                      : {}),
                    support: [
                      ...(hints || assistance?.helper_used ? ["hint" as const] : []),
                      ...(repeatedAttempt ? ["repeat-attempt" as const] : []),
                      ...(assistance?.translation_used ? ["translation" as const] : []),
                      ...(teaching.priorFeedback ? ["model-answer" as const] : []),
                    ],
                    evidence: evaluation.evidence,
                    uncertainty: evaluation.uncertainty.level,
                  },
                ];
              })
            : [];
          saveCourseEvidence(connection, {
            activityId: record.activityId,
            historyEntryId: item.historyEntryId,
            occurredAt: record.completedAt,
            evidence,
          });
        }
        const insertTopic = connection.prepare(
          `INSERT INTO history_curriculum_topics (history_entry_id, curriculum_topic_id)
           VALUES (?, ?)`,
        );
        for (const topicId of activityContext.curriculumTopicIds) {
          insertTopic.run(item.historyEntryId, topicId);
        }
      }
      const updated = connection
        .prepare(
          `UPDATE prepared_activities SET status = 'completed', completed_at = ?
           WHERE activity_id = ? AND status IN ('prepared', 'completed')`,
        )
        .run(record.completedAt, record.activityId);
      if (updated.changes !== 1) throw new Error("OD_GENERATED_ACTIVITY_NOT_FOUND");
    });
  }

  async abandonGeneratedExerciseSet(
    value: GeneratedExerciseSetAbandon,
  ): Promise<readonly AttemptId[]> {
    const record = generatedExerciseSetAbandonSchema.parse(value);
    return withLeasedTransaction(this.#database, (connection) => {
      const rows = connection
        .prepare(
          `SELECT a.attempt_id, a.started_at FROM attempts a
           JOIN exercises e ON e.exercise_id = a.exercise_id
           WHERE e.activity_id = ? AND a.status = 'in-progress'`,
        )
        .all(record.activityId) as Record<string, unknown>[];
      if (rows.length === 0) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      const update = connection.prepare(
        `UPDATE attempts SET status = 'abandoned', terminal_after_previous_event_ms = ?
         WHERE attempt_id = ? AND status = 'in-progress'`,
      );
      for (const row of rows) {
        const elapsed = Math.max(
          0,
          Date.parse(record.abandonedAt) - Date.parse(utcInstantSchema.parse(row["started_at"])),
        );
        const result = update.run(elapsed, attemptIdSchema.parse(row["attempt_id"]));
        if (result.changes !== 1) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      }
      return rows.map((row) => attemptIdSchema.parse(row["attempt_id"]));
    });
  }
}
