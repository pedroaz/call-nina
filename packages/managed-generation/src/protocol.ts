import { generationInputSchema, z } from "@call-nina/contracts";

export const limits = Object.freeze({
  requestBytes: 64 * 1024,
  responseBytes: 512 * 1024,
  providerRequestBytes: 256 * 1024,
  providerResponseBytes: 1024 * 1024,
  outputTokens: 8192,
  deadlineMs: 120_000,
});
export const managedRequestSchema = z.strictObject({
  requestId: z.uuid(),
  modelId: z.string().min(1).max(200),
  input: generationInputSchema,
});
export const failureCodeSchema = z.enum([
  "unavailable",
  "shutdown",
  "exhausted",
  "throttled",
  "conflict",
  "invalid-request",
  "cancelled",
  "deadline",
  "invalid-output",
]);
export type FailureCode = z.infer<typeof failureCodeSchema>;
export class ManagedFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(`OD_MANAGED_${code.toUpperCase().replaceAll("-", "_")}`);
  }
}
export const managedResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("validated"),
    requestId: z.uuid(),
    modelId: z.string().min(1).max(200),
    output: z.unknown(),
  }),
  z.strictObject({ status: z.literal("failed"), code: failureCodeSchema }),
]);

/** Bounded decoded bytes, including chunked responses; no raw body in errors. */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
): Promise<string> {
  if (!body) throw new ManagedFailure("invalid-request");
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) throw new ManagedFailure("invalid-request");
      size += chunk.byteLength;
      if (size > maximum) throw new ManagedFailure("invalid-request");
      chunks.push(chunk);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
