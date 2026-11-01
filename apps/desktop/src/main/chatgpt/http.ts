import { z, type ErrorKind } from "@call-nina/contracts";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const authOrigin = "https://auth.openai.com";
export const apiOrigin = "https://api.openai.com";
export const scopes =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const random = () => randomBytes(32).toString("base64url");
export const equal = (left: unknown, right: string) =>
  typeof left === "string" &&
  Buffer.byteLength(left) === Buffer.byteLength(right) &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));
export class ChatgptError extends Error {
  constructor(
    readonly kind: ErrorKind,
    code: string,
  ) {
    super(code);
  }
}
export function chatgptFailure(status: number, code?: string): ChatgptError {
  if (code === "invalid_json_schema")
    return new ChatgptError("app-server", "OD_CHATGPT_SCHEMA_REJECTED");
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429)
    return new ChatgptError("rate-limit", "OD_CHATGPT_USAGE_LIMIT");
  if (
    [
      "subscription_sharing_user_not_eligible",
      "subscription_sharing_unsupported_capability",
      "subscription_sharing_route_not_supported",
    ].includes(code ?? "")
  )
    return new ChatgptError("ai-policy", "OD_CHATGPT_POLICY_REJECTED");
  if (
    status === 401 ||
    [
      "subscription_sharing_invalid_user",
      "chatpass_v2_scope_not_authorized",
      "chatpass_v2_invalid_authorization_context",
    ].includes(code ?? "")
  )
    return new ChatgptError("authentication", "OD_CHATGPT_AUTHENTICATION_REQUIRED");
  if (status === 400 || status === 403)
    return new ChatgptError("ai-policy", "OD_CHATGPT_REQUEST_REJECTED");
  return new ChatgptError("app-server", "OD_CHATGPT_UNAVAILABLE");
}
export async function boundedBody(response: Response, maximum: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ChatgptError("app-server", "OD_CHATGPT_RESPONSE_EMPTY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const value: unknown = part.value;
      if (!(value instanceof Uint8Array))
        throw new ChatgptError("app-server", "OD_CHATGPT_RESPONSE_INVALID");
      size += value.byteLength;
      if (size > maximum) throw new ChatgptError("model-output", "OD_CHATGPT_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export const failureBodySchema = z.object({
  error: z.object({ code: z.string().max(160).optional() }).optional(),
});
export async function responseFailure(response: Response) {
  let code: string | undefined;
  try {
    code = failureBodySchema.parse(JSON.parse(await boundedBody(response, 65536))).error?.code;
  } catch {
    /* Never expose untrusted error bodies. */
  }
  return chatgptFailure(response.status, code);
}
export async function jsonRequest(url: string, options: RequestInit = {}) {
  if (new URL(url).origin !== authOrigin && new URL(url).origin !== apiOrigin)
    throw new ChatgptError("ai-policy", "OD_CHATGPT_DESTINATION_REJECTED");
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    credentials: "omit",
    signal: options.signal ?? AbortSignal.timeout(20000),
  });
  if (!response.ok) throw await responseFailure(response);
  return JSON.parse(await boundedBody(response, 2 * 1024 * 1024)) as unknown;
}
