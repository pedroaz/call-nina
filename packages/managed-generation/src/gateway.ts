import { createGateway, generateText, jsonSchema, NoObjectGeneratedError, Output } from "ai";
import type { LearningAttempt } from "@call-nina/learning-workflows";
import type { ServicePolicy } from "./policy.js";
import { limits, ManagedFailure, readBounded } from "./protocol.js";

globalThis.AI_SDK_LOG_WARNINGS = false;
const baseURL = "https://ai-gateway.vercel.sh/v4/ai";

export async function generateGatewayAttempt(options: {
  policy: ServicePolicy;
  apiKey: string;
  attempt: LearningAttempt;
  signal: AbortSignal;
}): Promise<string> {
  const { policy, apiKey, attempt, signal } = options;
  let transportFailure: ManagedFailure | undefined;
  // Reject discovery, redirects, tools, model fallbacks and ambient key selection.
  const boundedFetch: typeof fetch = async (input, init) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (
        url !== `${baseURL}/language-model` ||
        init?.method !== "POST" ||
        typeof init.body !== "string" ||
        Buffer.byteLength(init.body) > limits.providerRequestBytes
      )
        throw new ManagedFailure("invalid-request");
      signal.throwIfAborted();
      const response = await fetch(input, {
        ...init,
        redirect: "error",
        credentials: "omit",
        signal,
      });
      const body = await readBounded(response.body, limits.providerResponseBytes, signal);
      // No provider error body leaves the transport or reaches a log.
      if (!response.ok)
        throw new ManagedFailure(response.status === 429 ? "throttled" : "unavailable");
      return new Response(body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      // The SDK wraps fetch errors; retain only our sanitized local classification.
      if (error instanceof ManagedFailure) transportFailure = error;
      throw error;
    }
  };
  try {
    const result = await generateText({
      model: createGateway({ apiKey, baseURL, fetch: boundedFetch })(policy.model.id),
      system: `${attempt.instructions}\n${attempt.teachingInstructions}`,
      prompt: attempt.prompt,
      output: Output.object({
        schema: jsonSchema(attempt.outputSchema as Parameters<typeof jsonSchema>[0]),
      }),
      providerOptions: {
        gateway: { only: [policy.model.provider], order: [policy.model.provider], models: [] },
      },
      maxOutputTokens: limits.outputTokens,
      maxRetries: 0,
      abortSignal: signal,
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false, integrations: [] },
      include: { requestBody: false, responseBody: false },
    });
    signal.throwIfAborted();
    if (
      result.toolCalls.length ||
      result.finishReason === "tool-calls" ||
      result.finishReason === "content-filter"
    )
      throw new ManagedFailure("invalid-output");
    return result.finishReason === "stop" ? result.text : "";
  } catch (error) {
    if (transportFailure) throw transportFailure;
    if (error instanceof ManagedFailure) throw error;
    if (
      NoObjectGeneratedError.isInstance(error) &&
      error.finishReason !== "tool-calls" &&
      error.finishReason !== "content-filter"
    )
      return error.text ?? "";
    throw new ManagedFailure("unavailable");
  }
}
