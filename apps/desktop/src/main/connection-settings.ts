import { randomUUID } from "node:crypto";
import {
  type aiConnectionsViewSchema,
  type AiConnections,
  type AiConnection,
  type z,
  type aiConnectionMutationSchema,
} from "@call-nina/contracts";
import {
  readAiConnections,
  updateAiConnections,
  type CallNinaDatabase,
} from "@call-nina/persistence";
import type { ConnectionSecretStorage } from "./secret-storage.js";

export async function mutateConnections(
  database: CallNinaDatabase,
  secrets: ConnectionSecretStorage,
  input: z.infer<typeof aiConnectionMutationSchema>,
) {
  if (database.rootGeneration !== input.expectedGeneration) throw new Error("OD_DATA_ROOT_STALE");
  let current = await readAiConnections(database);
  if (current.revision !== input.expectedRevision) throw new Error("OD_CONNECTION_CONFLICT");
  const action = input.action;
  let createdRef: string | undefined;
  const next: AiConnections = structuredClone(current);
  if (action.kind === "save") {
    const prior = next.connections.find((entry) => entry.id === action.connection.id);
    if (prior && prior.routeId !== action.connection.routeId)
      throw new Error("OD_CONNECTION_ROUTE_IMMUTABLE");
    let secretRef = prior?.secretRef ?? null;
    if (action.credential.action === "replace") {
      if (!["openai", "anthropic", "google"].includes(action.connection.routeId))
        throw new Error("OD_CONNECTION_SECRET_OWNER_INVALID");
      if (secrets.state().status !== "available") throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
      createdRef = randomUUID();
      // Reserve cleanup ownership before writing ciphertext. No cross-store
      // atomic transaction exists; both sides of a crash must remain recoverable.
      current = await updateAiConnections(database, current.revision, {
        ...current,
        retiredSecretRefs: [...current.retiredSecretRefs, createdRef],
      });
      await secrets.save(createdRef, action.credential.secret);
      secretRef = createdRef;
    } else if (action.credential.action === "remove") secretRef = null;
    if (prior?.secretRef && prior.secretRef !== secretRef)
      next.retiredSecretRefs.push(prior.secretRef);
    const connection: AiConnection = { ...action.connection, secretRef };
    next.connections = prior
      ? next.connections.map((entry) => (entry.id === prior.id ? connection : entry))
      : [...next.connections, connection];
    if (next.activeConnectionId === null) next.activeConnectionId = connection.id;
  } else if (action.kind === "activate") next.activeConnectionId = action.connectionId;
  else if (action.kind === "remove") {
    const prior = next.connections.find((entry) => entry.id === action.connectionId);
    if (!prior) throw new Error("OD_CONNECTION_NOT_FOUND");
    if (prior.secretRef) next.retiredSecretRefs.push(prior.secretRef);
    next.connections = next.connections.filter((entry) => entry.id !== prior.id);
    if (next.activeConnectionId === prior.id)
      next.activeConnectionId = action.nextActiveConnectionId;
    else if (action.nextActiveConnectionId !== next.activeConnectionId)
      throw new Error("OD_CONNECTION_CONFLICT");
  } else next.migrationNotice = false;
  try {
    current = await updateAiConnections(database, current.revision, next);
  } catch (error) {
    // The reservation remains durable if cleanup itself fails or the lease moved.
    if (createdRef) await cleanupConnectionSecrets(database, secrets, current);
    throw error;
  }
  return cleanupConnectionSecrets(database, secrets, current);
}

export async function cleanupConnectionSecrets(
  database: CallNinaDatabase,
  secrets: ConnectionSecretStorage,
  current: AiConnections,
) {
  const pending: string[] = [];
  for (const ref of current.retiredSecretRefs) {
    try {
      await secrets.remove(ref);
    } catch {
      pending.push(ref);
    }
  }
  // Failed deletion stays durably visible and retries on the next read/mutation;
  // crashes between DB commit and deletion never lose cleanup ownership.
  return pending.length === current.retiredSecretRefs.length
    ? current
    : updateAiConnections(database, current.revision, { ...current, retiredSecretRefs: pending });
}

export type ConnectionView = z.infer<typeof aiConnectionsViewSchema>;
