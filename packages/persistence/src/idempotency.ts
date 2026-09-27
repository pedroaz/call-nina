import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { utcInstantSchema, z } from "@call-nina/contracts";

const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[0-9A-Za-z._:-]+$/u);

export type IdempotentWriteResult = Readonly<{ replayed: boolean }>;

export function claimIdempotentWrite(
  connection: DatabaseSync,
  input: Readonly<{
    operation:
      | "vocabulary-candidate"
      | "vocabulary-confirmation"
      | "vocabulary-review"
      | "voice-summary"
      | "prepared-activity"
      | "attempt-completion";
    idempotencyKey: string;
    request: unknown;
    entityId: string;
    recordedAt: string;
  }>,
): IdempotentWriteResult {
  const key = keySchema.parse(input.idempotencyKey);
  const recordedAt = utcInstantSchema.parse(input.recordedAt);
  if (input.request === undefined) throw new Error("OD_IDEMPOTENCY_REQUEST_INVALID");
  const serialized = JSON.stringify(input.request);
  const requestHash = createHash("sha256").update(serialized).digest("hex");
  const existing = connection
    .prepare(
      `SELECT request_sha256, entity_id FROM idempotent_writes
       WHERE operation = ? AND idempotency_key = ?`,
    )
    .get(input.operation, key) as { request_sha256: string; entity_id: string } | undefined;
  if (existing !== undefined) {
    if (existing.request_sha256 !== requestHash || existing.entity_id !== input.entityId) {
      throw new Error("OD_IDEMPOTENCY_CONFLICT");
    }
    return Object.freeze({ replayed: true });
  }
  connection
    .prepare(
      `INSERT INTO idempotent_writes (
        operation, idempotency_key, request_sha256, entity_id, recorded_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.operation, key, requestHash, input.entityId, recordedAt);
  return Object.freeze({ replayed: false });
}
