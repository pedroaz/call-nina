// Resolve only persisted identities; titles and dates never establish ownership.
export function historyActivitySql(alias: string): string {
  return `coalesce(
    (SELECT e.activity_id FROM attempts a JOIN exercises e USING(exercise_id)
      WHERE ${alias}.entity_kind = 'attempt' AND a.attempt_id = ${alias}.entity_id),
    (SELECT f.activity_id FROM mcp_attempt_feedback f
      WHERE ${alias}.entity_kind = 'attempt' AND f.attempt_id = ${alias}.entity_id),
    (SELECT json_extract(a.ownership_json, '$.source.activityId') FROM learning_attempts a
      WHERE ${alias}.entity_kind = 'attempt' AND a.attempt_id = ${alias}.entity_id),
    (SELECT r.activity_id FROM course_results r WHERE r.history_entry_id = ${alias}.history_entry_id LIMIT 1),
    CASE WHEN ${alias}.entity_kind = 'voice-summary'
      THEN json_extract(${alias}.reconstruction_json, '$.activity.activityId') END
  )`;
}
