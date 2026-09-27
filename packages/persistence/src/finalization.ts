import { utcInstantSchema, z } from "@call-nina/contracts";
import {
  attemptFeedbackSchema,
  learningObjectiveSchema,
  objectiveEvaluationSchema,
  type AttemptFeedback,
  type ObjectiveEvaluation,
} from "@call-nina/domain";

import { claimIdempotentWrite, type IdempotentWriteResult } from "./idempotency.js";
import { type CallNinaDatabase, withLeasedTransaction } from "./sqlite.js";

const recordIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-z][a-z0-9_-]+$/u);
const objectiveEvaluationsSchema = z.array(objectiveEvaluationSchema).min(1).max(12);
const learningObjectivesSchema = z.array(learningObjectiveSchema).min(1).max(12);

export async function completeAttempt(
  database: CallNinaDatabase,
  input: Readonly<{
    attemptId: string;
    terminalAfterPreviousEventMilliseconds: number;
    objectiveEvaluations: ObjectiveEvaluation[];
    feedback: AttemptFeedback;
    idempotencyKey: string;
    recordedAt: string;
  }>,
): Promise<IdempotentWriteResult> {
  const attemptId = recordIdSchema.parse(input.attemptId);
  if (
    !Number.isSafeInteger(input.terminalAfterPreviousEventMilliseconds) ||
    input.terminalAfterPreviousEventMilliseconds < 0
  ) {
    throw new Error("OD_ATTEMPT_TERMINAL_OFFSET_INVALID");
  }
  const parsedFeedback = attemptFeedbackSchema.safeParse(input.feedback);
  if (!parsedFeedback.success) throw new Error("OD_ATTEMPT_FEEDBACK_INVALID");
  const feedback = parsedFeedback.data;
  const feedbackJson = JSON.stringify(feedback);
  if (Buffer.byteLength(feedbackJson, "utf8") > 64 * 1024) {
    throw new Error("OD_ATTEMPT_FEEDBACK_INVALID");
  }
  const parsedEvaluations = objectiveEvaluationsSchema.safeParse(input.objectiveEvaluations);
  if (!parsedEvaluations.success) throw new Error("OD_ATTEMPT_OBJECTIVE_EVALUATIONS_INVALID");
  const objectiveEvaluations = parsedEvaluations.data;
  const objectiveEvaluationsJson = JSON.stringify(objectiveEvaluations);
  const recordedAt = utcInstantSchema.parse(input.recordedAt);
  return withLeasedTransaction(database, (connection) => {
    const exercise = connection
      .prepare(
        `SELECT e.objectives_json
           FROM attempts a JOIN exercises e ON e.exercise_id = a.exercise_id
          WHERE a.attempt_id = ? AND a.status = 'in-progress'`,
      )
      .get(attemptId) as { objectives_json: string } | undefined;
    if (exercise === undefined) throw new Error("OD_ATTEMPT_NOT_IN_PROGRESS");
    const objectives = learningObjectivesSchema.safeParse(JSON.parse(exercise.objectives_json));
    if (!objectives.success || objectives.data.length !== objectiveEvaluations.length) {
      throw new Error("OD_ATTEMPT_OBJECTIVE_EVALUATIONS_INVALID");
    }
    const claim = claimIdempotentWrite(connection, {
      operation: "attempt-completion",
      idempotencyKey: input.idempotencyKey,
      request: {
        attemptId,
        terminalAfterPreviousEventMilliseconds: input.terminalAfterPreviousEventMilliseconds,
        objectiveEvaluations,
        feedback,
      },
      entityId: attemptId,
      recordedAt,
    });
    if (claim.replayed) return claim;
    const result = connection
      .prepare(
        `UPDATE attempts
           SET status = 'completed', terminal_after_previous_event_ms = ?,
               objective_evaluations_json = ?, feedback_json = ?
           WHERE attempt_id = ? AND status = 'in-progress'`,
      )
      .run(
        input.terminalAfterPreviousEventMilliseconds,
        objectiveEvaluationsJson,
        feedbackJson,
        attemptId,
      );
    if (result.changes !== 1) throw new Error("OD_ATTEMPT_NOT_IN_PROGRESS");
    return claim;
  });
}

export async function finalizeCorrection(
  database: CallNinaDatabase,
  correctionIdValue: string,
): Promise<Readonly<{ originalText: string; correctedText: string }>> {
  const correctionId = recordIdSchema.parse(correctionIdValue);
  return withLeasedTransaction(database, (connection) => {
    const rows = connection
      .prepare(
        `SELECT position, original_text, corrected_text
           FROM correction_changes WHERE correction_id = ? ORDER BY position`,
      )
      .all(correctionId) as Array<{
      position: number;
      original_text: string;
      corrected_text: string;
    }>;
    if (rows.length === 0 || rows.some((row, index) => row.position !== index)) {
      throw new Error("OD_CORRECTION_ALIGNMENT_INVALID");
    }
    const originalText = rows.map((row) => row.original_text).join("");
    const correctedText = rows.map((row) => row.corrected_text).join("");
    const result = connection
      .prepare(
        `UPDATE corrections SET state = 'final', original_text = ?, corrected_text = ?
           WHERE correction_id = ? AND state = 'draft'`,
      )
      .run(originalText, correctedText, correctionId);
    if (result.changes !== 1) throw new Error("OD_CORRECTION_NOT_DRAFT");
    return Object.freeze({ originalText, correctedText });
  });
}
