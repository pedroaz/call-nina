import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  aiConnectionsSchema,
  aiModelPreferenceSchema,
  emptyAiConnections,
  type AiConnection,
} from "@call-nina/contracts";

export function migrateAiConnections(database: DatabaseSync) {
  const connections: AiConnection[] = [];
  // Preserve every distinct valid saved choice. Generation is the single active
  // choice; correction/helper/research choices remain explicit selectable entries.
  const learners = database
    .prepare("SELECT learner_id FROM learner_profiles ORDER BY learner_id")
    .all();
  for (const learner of learners) {
    const defaults = database
      .prepare("SELECT * FROM model_preference_defaults WHERE route_id = 'codex'")
      .all();
    const overrides = database
      .prepare("SELECT * FROM model_preference_overrides WHERE learner_id = ?")
      .all(String(learner["learner_id"]));
    if (overrides.some((row) => row["route_id"] !== "codex"))
      throw new Error("OD_CONNECTION_MIGRATION_INVALID");
    for (const workload of ["generation", "correction", "helper", "research"]) {
      const row =
        overrides.find((entry) => entry["workload"] === workload) ??
        defaults.find((entry) => entry["workload"] === workload);
      if (!row) throw new Error("OD_CONNECTION_MIGRATION_INVALID");
      const preference = aiModelPreferenceSchema.parse({
        // Freeze the former workload default's intended model, never choose a
        // different catalog model silently during migration or later dispatch.
        model: {
          mode: "exact",
          modelId:
            row["model_mode"] === "automatic"
              ? workload === "helper"
                ? "gpt-6-luna"
                : "gpt-6-sol"
              : row["model_id"],
        },
        effort:
          row["effort_mode"] === "semantic"
            ? { mode: "semantic", effort: row["semantic_effort"] }
            : { mode: "exact", effortId: row["effort_id"] },
      });
      if (
        !connections.some(
          (entry) => JSON.stringify(entry.preference) === JSON.stringify(preference),
        )
      )
        connections.push({
          id: randomUUID(),
          label: `Codex (${workload})`,
          routeId: "codex",
          preference,
          secretRef: null,
        });
    }
  }
  const state = aiConnectionsSchema.parse({
    ...emptyAiConnections,
    connections,
    activeConnectionId: connections[0]?.id ?? null,
    migrationNotice: connections.length > 0,
  });
  database
    .prepare("INSERT INTO ai_connections(singleton, settings_json) VALUES (1, ?)")
    .run(JSON.stringify(state));
  database.exec("DROP TABLE model_preference_overrides; DROP TABLE model_preference_defaults;");
}
