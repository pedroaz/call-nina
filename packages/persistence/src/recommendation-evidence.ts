import type { DatabaseSync } from "node:sqlite";
import { courseEvidenceSchema, utcInstantSchema, type LearningContext } from "@call-nina/contracts";
import { historyAttemptEvidence } from "./attempt-evidence.js";
import { parseScopedActivityContext, requireLocalLearningScope } from "./learning-context.js";

export type RecommendationCourseEvidence = Readonly<{
  objectiveId: string;
  skill: "reading" | "writing" | "listening" | "speaking";
  outcome: "difficulty" | "independent" | "supported";
  occurredAt: string;
  curriculumTopicIds: readonly string[];
  unitId: string;
}>;

/** Retained course results are read once per history entry; repeated objective rows cannot vote twice. */
export function readRecommendationEvidence(
  connection: DatabaseSync,
  learningContext: LearningContext,
): readonly RecommendationCourseEvidence[] {
  const scope = requireLocalLearningScope(connection);
  if (
    scope.learnerId !== learningContext.learnerId ||
    scope.courseId !== learningContext.courseId ||
    scope.targetLanguage !== learningContext.targetLanguage
  )
    throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
  if (learningContext.courseId === null) return Object.freeze([]);
  const rows = connection
    .prepare(
      `SELECT r.history_entry_id, r.occurred_at, r.evidence_json, p.context_json
     FROM course_results r JOIN prepared_activities p ON p.activity_id = r.activity_id
     WHERE p.target_language = ?
       AND json_extract(p.context_json, '$.learningScope.learnerId') = ?
       AND json_extract(p.context_json, '$.learningScope.courseId') = ?
     ORDER BY r.occurred_at DESC, r.history_entry_id DESC LIMIT 400`,
    )
    .all(learningContext.targetLanguage, learningContext.learnerId, learningContext.courseId);
  const seen = new Set<string>();
  const result: RecommendationCourseEvidence[] = [];
  for (const row of rows) {
    const context = parseScopedActivityContext(connection, JSON.parse(String(row["context_json"])));
    if (!context.learningPath) continue;
    const historyEntryId = String(row["history_entry_id"]);
    const basis = historyAttemptEvidence(connection, historyEntryId)?.basis;
    const occurredAt = utcInstantSchema.parse(row["occurred_at"]);
    for (const evidence of courseEvidenceSchema
      .array()
      .parse(JSON.parse(String(row["evidence_json"])))) {
      const key = `${historyEntryId}:${evidence.objectiveId}:${evidence.skill}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const independent =
        basis === "independent" &&
        evidence.uncertainty === "none" &&
        evidence.support.length === 0 &&
        (evidence.outcome === "independent" || evidence.outcome === "transfer");
      const difficulty =
        basis === "independent" &&
        evidence.outcome === "not-yet" &&
        evidence.uncertainty !== "substantial";
      if (!independent && !difficulty) continue;
      result.push(
        Object.freeze({
          objectiveId: evidence.objectiveId,
          skill: evidence.skill,
          outcome: independent ? "independent" : difficulty ? "difficulty" : "supported",
          occurredAt,
          curriculumTopicIds: Object.freeze([...context.curriculumTopicIds]),
          unitId: context.learningPath.unitId,
        }),
      );
    }
  }
  return Object.freeze(result);
}
