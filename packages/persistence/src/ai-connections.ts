import { aiConnectionsSchema, type AiConnections } from "@call-nina/contracts";
import { type CallNinaDatabase, withLeasedConnection, withLeasedTransaction } from "./sqlite.js";
import type { DatabaseSync } from "node:sqlite";

function read(connection: DatabaseSync): AiConnections {
  const row = connection
    .prepare("SELECT settings_json FROM ai_connections WHERE singleton = 1")
    .get();
  // Missing, corrupt and unknown-newer configuration are errors, never initialization.
  if (!row || typeof row["settings_json"] !== "string")
    throw new Error("OD_CONNECTION_CONFIG_INVALID");
  const parsed = aiConnectionsSchema.safeParse(JSON.parse(row["settings_json"]));
  if (!parsed.success) throw new Error("OD_CONNECTION_CONFIG_INVALID");
  return parsed.data;
}
export function readAiConnections(database: CallNinaDatabase) {
  return withLeasedConnection(database, read);
}
export function updateAiConnections(
  database: CallNinaDatabase,
  expectedRevision: number,
  value: AiConnections,
) {
  return withLeasedTransaction(database, (connection) => {
    const current = read(connection);
    if (current.revision !== expectedRevision) throw new Error("OD_CONNECTION_CONFLICT");
    const next = aiConnectionsSchema.parse({ ...value, revision: expectedRevision + 1 });
    connection
      .prepare("UPDATE ai_connections SET settings_json = ? WHERE singleton = 1")
      .run(JSON.stringify(next));
    return next;
  });
}
