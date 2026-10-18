import { z, maximumStructuredOutputBytes } from "@call-nina/contracts";
import type { LearningAttempt } from "@call-nina/learning-workflows";
import {
  ChatgptError,
  chatgptFailure,
  responseFailure,
  type ChatgptSession,
} from "./chatgpt-session.js";

const errorSchema = z.object({ code: z.string().max(160).optional() });
const contentSchema = z.object({ type: z.string(), text: z.string().optional() });
const outputSchema = z.object({
  type: z.string(),
  role: z.string().optional(),
  content: z.array(contentSchema).optional(),
});
const eventSchema = z.object({
  type: z.string().max(160),
  delta: z.string().optional(),
  item_id: z.string().optional(),
  content_index: z.number().optional(),
  code: z.string().max(160).optional(),
  item: outputSchema.optional(),
  response: z
    .object({
      status: z.string(),
      model: z.string().optional(),
      error: errorSchema.nullable().optional(),
      output: z.array(outputSchema).optional(),
    })
    .optional(),
});

/** Only this endpoint receives the device-owned OAuth token; no SDK or paid fallback. */
export async function generateChatgptAttempt(options: {
  session: ChatgptSession;
  registrationId: string;
  modelId: string;
  effortId: string;
  attempt: LearningAttempt;
  signal: AbortSignal;
  assertActive: () => Promise<void>;
}): Promise<string> {
  const { session, registrationId, modelId, effortId, attempt, signal, assertActive } = options;
  signal.throwIfAborted();
  await assertActive();
  const catalog = await session.models(signal);
  const model = catalog.models.find((entry) => entry.id === modelId);
  if (!model || !model.supportedReasoningEfforts.includes(effortId))
    throw new ChatgptError("model-unavailable", "OD_CHATGPT_MODEL_UNAVAILABLE");
  const token = await session.token(signal, registrationId);
  await assertActive();
  signal.throwIfAborted();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: modelId,
      store: false,
      stream: true,
      instructions: `${attempt.instructions}\n${attempt.teachingInstructions}`,
      input: [{ role: "user", content: attempt.prompt }],
      text: {
        format: {
          type: "json_schema",
          name: "call_nina_learning_result",
          strict: true,
          schema: attempt.outputSchema,
        },
      },
      // Omitting the advertised default keeps verification at runtime-default effort.
      ...(effortId === model.defaultReasoningEffort ? {} : { reasoning: { effort: effortId } }),
    }),
  });
  if (!response.ok) throw await responseFailure(response);
  const media = response.headers.get("content-type");
  if (media !== null && !media.toLowerCase().startsWith("text/event-stream")) {
    await response.body?.cancel();
    throw new ChatgptError("app-server", "OD_CHATGPT_STREAM_MEDIA_INVALID");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ChatgptError("app-server", "OD_CHATGPT_STREAM_EMPTY");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  let size = 0;
  let text = "";
  let itemId: string | undefined;
  const lines: string[] = [];
  const invalid = () => new ChatgptError("model-output", "OD_CHATGPT_STREAM_INVALID");
  function receive(data: string): { text: string } | undefined {
    if (data === "[DONE]") throw invalid();
    const event = eventSchema.parse(JSON.parse(data));
    if (event.type === "error" || event.type === "response.failed")
      throw chatgptFailure(0, event.response?.error?.code ?? event.code);
    if (event.type === "response.incomplete")
      throw new ChatgptError("model-output", "OD_CHATGPT_RESPONSE_INCOMPLETE");
    if (
      event.type.startsWith("response.refusal") ||
      event.type.startsWith("response.function_call")
    )
      throw invalid();
    if (
      event.type === "response.output_item.added" &&
      !["message", "reasoning"].includes(event.item?.type ?? "")
    )
      throw new ChatgptError("ai-policy", "OD_CHATGPT_TOOL_REJECTED");
    if (event.type === "response.output_text.delta") {
      if (
        typeof event.delta !== "string" ||
        !event.item_id ||
        (itemId !== undefined && itemId !== event.item_id) ||
        event.content_index !== 0
      )
        throw invalid();
      itemId = event.item_id;
      text += event.delta;
      if (Buffer.byteLength(text) > maximumStructuredOutputBytes)
        throw new ChatgptError("model-output", "OD_CHATGPT_OUTPUT_TOO_LARGE");
    }
    if (event.type !== "response.completed") return;
    const completed = event.response;
    if (
      !completed ||
      completed.status !== "completed" ||
      (completed.model !== undefined &&
        completed.model !== modelId &&
        !completed.model.startsWith(`${modelId}-`))
    )
      throw invalid();
    let final = "";
    for (const item of completed.output ?? []) {
      if (item.type === "reasoning") continue;
      if (item.type !== "message" || item.role !== "assistant" || !item.content) throw invalid();
      for (const part of item.content) {
        if (part.type !== "output_text" || typeof part.text !== "string") throw invalid();
        final += part.text;
      }
    }
    if (
      (final && text && final !== text) ||
      Buffer.byteLength(final) > maximumStructuredOutputBytes
    )
      throw invalid();
    return { text: final || text };
  }
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      const value: unknown = part.value;
      if (!(value instanceof Uint8Array)) throw invalid();
      size += value.byteLength;
      if (size > 4 * 1024 * 1024)
        throw new ChatgptError("model-output", "OD_CHATGPT_STREAM_TOO_LARGE");
      buffered += decoder.decode(value, { stream: true });
      if (buffered.length > 1024 * 1024) throw invalid();
      for (;;) {
        const end = buffered.indexOf("\n");
        if (end < 0) break;
        const line = buffered.slice(0, end).replace(/\r$/u, "");
        buffered = buffered.slice(end + 1);
        if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /u, ""));
        if (line.length === 0 && lines.length > 0) {
          const completed = receive(lines.join("\n"));
          lines.length = 0;
          if (completed) {
            await assertActive();
            signal.throwIfAborted();
            return completed.text;
          }
        }
      }
    }
    throw new ChatgptError("app-server", "OD_CHATGPT_STREAM_INTERRUPTED");
  } catch (cause) {
    if (cause instanceof ChatgptError || signal.aborted) throw cause;
    // Validation/network exception details may include private provider data.
    throw new ChatgptError("app-server", "OD_CHATGPT_STREAM_FAILED");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
