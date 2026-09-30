import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { APICallError, generateText, jsonSchema, NoObjectGeneratedError, Output } from "ai";
import { aiSecretInputSchema, z, type DirectApiRoute, type ErrorKind } from "@call-nina/contracts";
import type { LearningAttempt } from "@call-nina/learning-workflows";

// SDK warnings can contain provider payloads. Nina owns redacted diagnostics;
// never forward SDK console logging or telemetry into the desktop log stream.
globalThis.AI_SDK_LOG_WARNINGS = false;

export class DirectApiError extends Error {
  constructor(
    readonly kind: ErrorKind,
    code: string,
    readonly retryAt: number | null = null,
  ) {
    super(code);
  }
}

const endpoints = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
} as const;
const maximumResponseBytes = 2 * 1024 * 1024;

// Exactly one provider endpoint; reject redirects instead of forwarding secrets
// or learner data. Bound decoded response bytes before the SDK parses them.
function providerFetch(route: DirectApiRoute, modelId: string, signal: AbortSignal): typeof fetch {
  const endpoint = `${endpoints[route]}${route === "openai" ? "/responses" : route === "anthropic" ? "/messages" : `/models/${modelId}:generateContent`}`;
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (`${url.origin}${url.pathname}` !== endpoint || url.search || init?.method !== "POST")
      throw new DirectApiError("ai-policy", "OD_DIRECT_API_DESTINATION_REJECTED");
    signal.throwIfAborted();
    const response = await fetch(input, {
      ...init,
      signal,
      redirect: "error",
      credentials: "omit",
    });
    const reader = response.body?.getReader();
    if (!reader) throw new DirectApiError("app-server", "OD_DIRECT_API_RESPONSE_EMPTY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        const chunk: unknown = part.value;
        if (!(chunk instanceof Uint8Array))
          throw new DirectApiError("app-server", "OD_DIRECT_API_RESPONSE_INVALID");
        size += chunk.byteLength;
        if (size > maximumResponseBytes)
          throw new DirectApiError("model-output", "OD_DIRECT_API_RESPONSE_TOO_LARGE");
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(Buffer.concat(chunks), { status: response.status, headers });
  };
}

function retryTime(headers: Record<string, string> | undefined): number | null {
  const value = headers?.["retry-after"];
  if (!value || value.length > 80) return null;
  const seconds = Number(value);
  const time = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(value);
  return Number.isFinite(time) && time >= Date.now() && time <= Date.now() + 86_400_000
    ? time
    : null;
}

// Only bounded machine codes are interpreted; messages, provider request IDs,
// billing details and error bodies are never copied into diagnostics or state.
const providerFailureCodes = z.object({
  error: z.object({
    code: z.union([z.string().max(100), z.number()]).nullish(),
    type: z.string().max(100).nullish(),
    status: z.string().max(100).nullish(),
    details: z
      .array(z.object({ reason: z.string().max(100).optional() }))
      .max(20)
      .nullish(),
  }),
});

export function directApiFailure(error: unknown): DirectApiError {
  if (error instanceof DirectApiError) return error;
  if (APICallError.isInstance(error)) {
    const parsed = providerFailureCodes.safeParse(error.data);
    const codes = parsed.success
      ? [
          parsed.data.error.code,
          parsed.data.error.type,
          parsed.data.error.status,
          ...(parsed.data.error.details?.map((detail) => detail.reason) ?? []),
        ]
      : [];
    if (
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      codes.some(
        (code) =>
          code === "API_KEY_INVALID" || code === "API_KEY_EXPIRED" || code === "UNAUTHENTICATED",
      )
    )
      return new DirectApiError("authentication", "OD_DIRECT_API_AUTHENTICATION_REQUIRED");
    if (
      error.statusCode === 402 ||
      codes.some(
        (code) =>
          code === "insufficient_quota" ||
          code === "billing_error" ||
          code === "organization_usage_limit_exceeded",
      )
    )
      return new DirectApiError("rate-limit", "OD_DIRECT_API_QUOTA_EXCEEDED");
    if (error.statusCode === 429 || codes.includes("RESOURCE_EXHAUSTED"))
      return new DirectApiError(
        "rate-limit",
        "OD_DIRECT_API_RATE_OR_QUOTA_LIMIT",
        retryTime(error.responseHeaders),
      );
    if (error.statusCode === 404)
      return new DirectApiError("model-unavailable", "OD_DIRECT_API_MODEL_UNAVAILABLE");
    if (error.statusCode === 408 || (error.statusCode !== undefined && error.statusCode >= 500))
      return new DirectApiError("app-server", "OD_DIRECT_API_TRANSIENT_FAILURE");
    return new DirectApiError("app-server", "OD_DIRECT_API_REQUEST_REJECTED");
  }
  // Never retain SDK errors, causes, request/response bodies or their messages.
  return new DirectApiError("app-server", "OD_DIRECT_API_INTERRUPTED");
}

export async function generateDirectAttempt(options: {
  route: DirectApiRoute;
  modelId: string;
  effortId: "low" | "medium" | "high";
  secret: string;
  attempt: LearningAttempt;
  signal: AbortSignal;
}): Promise<string> {
  const { route, modelId, effortId, attempt, signal } = options;
  const apiKey = aiSecretInputSchema.parse(options.secret);
  const settings = {
    apiKey,
    baseURL: endpoints[route],
    fetch: providerFetch(route, modelId, signal),
  };
  // Explicit instances prevent ambient keys, base URLs and Gateway resolution.
  const model =
    route === "openai"
      ? createOpenAI(settings).responses(modelId)
      : route === "anthropic"
        ? createAnthropic(settings)(modelId)
        : createGoogleGenerativeAI(settings)(modelId);
  const providerOptions =
    route === "openai"
      ? {
          openai: {
            store: false,
            reasoningEffort: effortId,
            strictJsonSchema: true,
          } satisfies OpenAILanguageModelResponsesOptions,
        }
      : route === "anthropic"
        ? {
            anthropic: {
              structuredOutputMode: "outputFormat",
              thinking: { type: "adaptive" },
              effort: effortId,
            } satisfies AnthropicLanguageModelOptions,
          }
        : {
            google: {
              structuredOutputs: true,
              thinkingConfig: { thinkingLevel: effortId, includeThoughts: false },
            } satisfies GoogleLanguageModelOptions,
          };
  try {
    signal.throwIfAborted();
    const result = await generateText({
      model,
      system: `${attempt.instructions}\n${attempt.teachingInstructions}`,
      prompt: attempt.prompt,
      output: Output.object({
        schema: jsonSchema(attempt.outputSchema as Parameters<typeof jsonSchema>[0]),
      }),
      providerOptions,
      maxOutputTokens: 16_384,
      maxRetries: 0,
      abortSignal: signal,
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false, integrations: [] },
      include: { requestBody: false, responseBody: false },
    });
    signal.throwIfAborted();
    if (result.toolCalls.length || result.finishReason === "tool-calls")
      throw new DirectApiError("ai-policy", "OD_DIRECT_API_TOOLS_REJECTED");
    if (result.finishReason === "content-filter")
      throw new DirectApiError("model-output", "OD_DIRECT_API_OUTPUT_BLOCKED");
    if (result.finishReason !== "stop") return "";
    // Shared workflow owns structural and semantic validation plus one repair.
    return result.text;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      if (error.finishReason === "content-filter" || error.finishReason === "tool-calls")
        throw new DirectApiError("model-output", "OD_DIRECT_API_OUTPUT_BLOCKED");
      return error.text ?? "";
    }
    throw directApiFailure(error);
  }
}
