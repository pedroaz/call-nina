import { captureExerciseAttempt } from "./attempt-evidence.js";
import { claimIdempotentWrite } from "./idempotency.js";
import {
  activityIdSchema,
  historyEntryIdSchema,
  mistakeIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
} from "@call-nina/contracts";
import {
  attemptFeedbackSchema,
  correctionSchema,
  exerciseAnswerSchema,
  objectiveEvaluationSchema,
  mistakeCategorySchema,
  originalTextFromCorrection,
  startedExerciseSnapshotSchema,
  vocabularyEntrySchema,
} from "@call-nina/domain";

import { type CallNinaDatabase, withLeasedTransaction } from "./sqlite.js";

export const writingAttemptPersistenceSchema = strictBoundaryObject({
  activityId: activityIdSchema,
  historyEntryId: historyEntryIdSchema,
  title: z.string().min(1).max(160).regex(/\S/u),
  workload: z.literal("correction"),
  startedExercise: startedExerciseSnapshotSchema,
  attemptId: z.string().regex(/^attempt_[0-9a-z]{16,64}$/u),
  answer: z.strictObject({
    submittedAfterPreviousEventMilliseconds: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    answer: exerciseAnswerSchema,
  }),
  completedAfterPreviousEventMilliseconds: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  objectiveEvaluations: z.array(objectiveEvaluationSchema).min(1).max(12),
  feedback: attemptFeedbackSchema,
  correction: correctionSchema,
  mistakes: z
    .array(
      z.strictObject({
        proposedMistakeId: mistakeIdSchema,
        alignmentSegmentPosition: z.int().nonnegative().max(499),
        category: mistakeCategorySchema,
      }),
    )
    .max(100),
  vocabularyEntries: z.array(vocabularyEntrySchema).max(50),
  completedAt: utcInstantSchema,
});

export type WritingAttemptPersistence = z.infer<typeof writingAttemptPersistenceSchema>;

function boundedJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 262_144) {
    throw new Error("OD_WRITING_ATTEMPT_TOO_LARGE");
  }
  return serialized;
}

export async function saveWritingAttempt(
  database: CallNinaDatabase,
  value: WritingAttemptPersistence,
): Promise<void> {
  const record = writingAttemptPersistenceSchema.parse(value);
  const exercise = record.startedExercise.exercise;
  if (exercise.kind !== "free-writing" || record.answer.answer.kind !== "free-writing") {
    throw new Error("OD_WRITING_ATTEMPT_KIND_INVALID");
  }
  if (record.correction.attemptId !== record.attemptId) {
    throw new Error("OD_WRITING_ATTEMPT_LINK_INVALID");
  }
  if (originalTextFromCorrection(record.correction) !== record.answer.answer.text) {
    throw new Error("OD_WRITING_ATTEMPT_ORIGINAL_INVALID");
  }
  if (exercise.objectives.length !== record.objectiveEvaluations.length) {
    throw new Error("OD_WRITING_ATTEMPT_EVALUATIONS_INVALID");
  }
  if (record.completedAt < record.startedExercise.startedAt) {
    throw new Error("OD_WRITING_ATTEMPT_CHRONOLOGY_INVALID");
  }
  const mistakePositions = record.mistakes.map(({ alignmentSegmentPosition }) =>
    String(alignmentSegmentPosition),
  );
  const proposedMistakeIds = record.mistakes.map(({ proposedMistakeId }) => proposedMistakeId);
  if (
    new Set(mistakePositions).size !== mistakePositions.length ||
    new Set(proposedMistakeIds).size !== proposedMistakeIds.length ||
    new Set(record.feedback.mistakeIds).size !== record.feedback.mistakeIds.length ||
    [...proposedMistakeIds].sort().join("\0") !== [...record.feedback.mistakeIds].sort().join("\0")
  ) {
    throw new Error("OD_WRITING_ATTEMPT_MISTAKES_INVALID");
  }
  for (const { alignmentSegmentPosition } of record.mistakes) {
    const segment = record.correction.alignment[alignmentSegmentPosition];
    if (!segment || segment.kind === "unchanged") {
      throw new Error("OD_WRITING_ATTEMPT_MISTAKES_INVALID");
    }
  }
  const vocabularyIds = record.vocabularyEntries.map(({ vocabularyId }) => vocabularyId);
  if (
    new Set(vocabularyIds).size !== vocabularyIds.length ||
    [...vocabularyIds].sort().join("\0") !==
      [...record.feedback.vocabularyCandidateIds].sort().join("\0") ||
    record.vocabularyEntries.some(
      (entry) =>
        entry.state.status !== "candidate" ||
        entry.source.kind !== "correction" ||
        entry.source.correctionId !== record.correction.correctionId ||
        entry.source.attemptId !== record.attemptId,
    )
  ) {
    throw new Error("OD_WRITING_ATTEMPT_VOCABULARY_INVALID");
  }

  await withLeasedTransaction(database, (connection) => {
    const claim = claimIdempotentWrite(connection, {
      operation: "attempt-completion",
      idempotencyKey: record.attemptId,
      request: record,
      entityId: record.attemptId,
      recordedAt: record.completedAt,
    });
    if (claim.replayed) return;
    connection
      .prepare(
        `INSERT INTO exercises (
          exercise_id, activity_id, kind, cefr_band, started_at, objectives_json,
          instructions, explanation, content_json, answer_contract_json,
          ai_provenance_json, snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        exercise.exerciseId,
        record.activityId,
        exercise.kind,
        exercise.cefrBand,
        record.startedExercise.startedAt,
        boundedJson(exercise.objectives),
        exercise.instructions,
        exercise.explanation ?? null,
        boundedJson(exercise.content),
        boundedJson(exercise.answerContract),
        boundedJson(exercise.aiProvenance),
        boundedJson(record.startedExercise),
      );
    connection
      .prepare(
        `INSERT INTO attempts (
          attempt_id, exercise_id, status, started_at, exercise_snapshot_json
        ) VALUES (?, ?, 'in-progress', ?, ?)`,
      )
      .run(
        record.attemptId,
        exercise.exerciseId,
        record.startedExercise.startedAt,
        boundedJson(record.startedExercise),
      );
    connection
      .prepare(
        `INSERT INTO answers (
          attempt_id, position, submitted_after_previous_event_ms, answer_json
        ) VALUES (?, 0, ?, ?)`,
      )
      .run(
        record.attemptId,
        record.answer.submittedAfterPreviousEventMilliseconds,
        boundedJson(record.answer.answer),
      );

    const correction = record.correction;
    connection
      .prepare(
        `INSERT INTO corrections (
          correction_id, attempt_id, created_at, ai_provenance_json,
          natural_alternative_json, follow_up_json, overall_uncertainty_json,
          vocabulary_candidates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        correction.correctionId,
        correction.attemptId,
        correction.createdAt,
        boundedJson(correction.aiProvenance),
        boundedJson(correction.naturalAlternative),
        boundedJson(correction.followUp),
        boundedJson(correction.overallUncertainty),
        boundedJson(correction.vocabularyCandidates),
      );
    const insertChange = connection.prepare(
      `INSERT INTO correction_changes (
        correction_id, position, kind, original_text, corrected_text,
        category, severity, priority, explanation, grammar_topic_ids_json, uncertainty_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [position, segment] of correction.alignment.entries()) {
      if (segment.kind === "unchanged") {
        insertChange.run(
          correction.correctionId,
          position,
          segment.kind,
          segment.text,
          segment.text,
          null,
          null,
          null,
          null,
          null,
          null,
        );
      } else {
        insertChange.run(
          correction.correctionId,
          position,
          segment.kind,
          segment.originalText,
          segment.correctedText,
          segment.category,
          segment.severity,
          segment.priority,
          segment.explanation,
          boundedJson(segment.grammarTopicIds),
          boundedJson(segment.uncertainty),
        );
      }
    }
    const originalText = correction.alignment
      .map((segment) => (segment.kind === "unchanged" ? segment.text : segment.originalText))
      .join("");
    const correctedText = correction.alignment
      .map((segment) => (segment.kind === "unchanged" ? segment.text : segment.correctedText))
      .join("");
    const resolvedMistakeIds: string[] = [];
    const insertMistake = connection.prepare(
      `INSERT INTO mistakes (
        mistake_id, inferred_category_json, effective_category_json,
        classification_source, disposition
      ) VALUES (?, ?, ?, 'inferred', 'active')`,
    );
    const insertOccurrence = connection.prepare(
      `INSERT INTO mistake_occurrences (
        mistake_id, correction_id, attempt_id, alignment_segment_position,
        observed_on, before_context, evidence_text, after_context, explanation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const originalParts = correction.alignment.map((segment) =>
      segment.kind === "unchanged" ? segment.text : segment.originalText,
    );
    for (const mistake of record.mistakes) {
      const categoryJson = boundedJson(mistake.category);
      const existing = connection
        .prepare(
          `SELECT mistake_id FROM mistakes
           WHERE effective_category_json = ? AND disposition = 'active'
           ORDER BY mistake_id LIMIT 1`,
        )
        .get(categoryJson) as { mistake_id: string } | undefined;
      const mistakeId = existing?.mistake_id ?? mistake.proposedMistakeId;
      if (!existing) insertMistake.run(mistakeId, categoryJson, categoryJson);
      const segment = correction.alignment[mistake.alignmentSegmentPosition];
      if (!segment || segment.kind === "unchanged") {
        throw new Error("OD_WRITING_ATTEMPT_MISTAKES_INVALID");
      }
      const before = originalParts.slice(0, mistake.alignmentSegmentPosition).join("").slice(-500);
      const after = originalParts
        .slice(mistake.alignmentSegmentPosition + 1)
        .join("")
        .slice(0, 500);
      const evidenceText = (segment.originalText || segment.correctedText).slice(0, 1_000);
      insertOccurrence.run(
        mistakeId,
        correction.correctionId,
        record.attemptId,
        mistake.alignmentSegmentPosition,
        record.completedAt.slice(0, 10),
        before,
        evidenceText,
        after,
        segment.explanation,
      );
      if (!resolvedMistakeIds.includes(mistakeId)) resolvedMistakeIds.push(mistakeId);
    }
    connection
      .prepare(
        `UPDATE corrections SET state = 'final', original_text = ?, corrected_text = ?
         WHERE correction_id = ? AND state = 'draft'`,
      )
      .run(originalText, correctedText, correction.correctionId);
    connection
      .prepare(
        `UPDATE attempts SET status = 'completed', terminal_after_previous_event_ms = ?,
          objective_evaluations_json = ?, feedback_json = ?
         WHERE attempt_id = ? AND status = 'in-progress'`,
      )
      .run(
        record.completedAfterPreviousEventMilliseconds,
        boundedJson(record.objectiveEvaluations),
        boundedJson({ ...record.feedback, mistakeIds: resolvedMistakeIds }),
        record.attemptId,
      );
    connection
      .prepare(
        `INSERT INTO history_entries (
          history_entry_id, entity_kind, entity_id, skill, activity_type, title,
          occurred_at, reconstruction_json, root_generation
        ) VALUES (?, 'attempt', ?, 'writing', 'writing', ?, ?, ?, ?)`,
      )
      .run(
        record.historyEntryId,
        record.attemptId,
        record.title,
        record.completedAt,
        boundedJson({
          schemaVersion: 1,
          workload: record.workload,
          attemptId: record.attemptId,
          exerciseId: exercise.exerciseId,
          correctionId: correction.correctionId,
          modelRequestId: correction.aiProvenance.modelRequestId,
          modelSelection: correction.aiProvenance.modelSelection,
        }),
        database.rootGeneration,
      );
    const insertHistoryCategory = connection.prepare(
      `INSERT OR IGNORE INTO history_mistake_categories (history_entry_id, category)
       VALUES (?, ?)`,
    );
    for (const { category } of record.mistakes) {
      insertHistoryCategory.run(record.historyEntryId, category.categoryKey);
    }
    const insertVocabulary = connection.prepare(
      `INSERT INTO vocabulary_entries (
        vocabulary_id, lemma, meaning, lexeme_json, examples_json, source_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entry of record.vocabularyEntries) {
      insertVocabulary.run(
        entry.vocabularyId,
        entry.lemma,
        entry.meaning,
        boundedJson(entry.lexeme),
        boundedJson(entry.examples),
        boundedJson(entry.source),
        record.completedAt,
        record.completedAt,
      );
    }
    captureExerciseAttempt(connection, record.attemptId);
  });
}
