import { randomUUID } from "node:crypto";
import {
  z,
  generationInputSchema,
  type GenerationInput,
  type GenerationKind,
  type GenerationOutputMap,
} from "@call-nina/contracts";
import { parseGenerationCandidateOutput } from "@call-nina/learning-workflows";
import { limits, managedResponseSchema, ManagedFailure, readBounded } from "./protocol.js";

export { ManagedFailure } from "./protocol.js";

/** Main-process transport only. Null is the shipped, honestly unavailable route.
 * Endpoint/model come from approved application configuration, never renderer
 * input. This module does not import server code, database drivers or keys. */
export type ManagedClientConfiguration = Readonly<{ endpoint: string; modelId: string }>;
export const shippedManagedConfiguration: ManagedClientConfiguration | null = null;

export async function runManagedOperation<Kind extends GenerationKind>(options: {
  configuration: ManagedClientConfiguration | null;
  input: Extract<GenerationInput, { kind: Kind }>;
  signal: AbortSignal;
}): Promise<{ output: GenerationOutputMap[Kind]; modelId: string }> {
  if (!options.configuration) throw new ManagedFailure("unavailable");
  const config = z
    .strictObject({ endpoint: z.url(), modelId: z.string().min(1).max(200) })
    .parse(options.configuration);
  const url = new URL(config.endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/generate"
  )
    throw new ManagedFailure("unavailable");
  const requestId = randomUUID();
  const input = generationInputSchema.parse(options.input);
  const body = JSON.stringify({ requestId, modelId: config.modelId, input });
  if (Buffer.byteLength(body) > limits.requestBytes) throw new ManagedFailure("invalid-request");
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(limits.deadlineMs)]);
  try {
    signal.throwIfAborted();
    // No authorization, cookies, BYOK key, automatic retry or alternate endpoint.
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      signal,
      redirect: "error",
      credentials: "omit",
    });
    const parsed = managedResponseSchema.parse(
      JSON.parse(await readBounded(response.body, limits.responseBytes, signal)) as unknown,
    );
    if (parsed.status === "failed") throw new ManagedFailure(parsed.code);
    if (!response.ok || parsed.requestId !== requestId || parsed.modelId !== config.modelId)
      throw new ManagedFailure("invalid-output");
    const output = parseGenerationCandidateOutput(input.kind, JSON.stringify(parsed.output), input);
    signal.throwIfAborted();
    return { output: output as GenerationOutputMap[Kind], modelId: parsed.modelId };
  } catch (error) {
    if (options.signal.aborted) throw new ManagedFailure("cancelled");
    if (signal.aborted) throw new ManagedFailure("deadline");
    if (error instanceof ManagedFailure) throw error;
    throw new ManagedFailure("unavailable");
  }
}
