import { createHmac, createHash, sign } from "node:crypto";
import { speechRequestSchema, waveNetVoices, z } from "@call-nina/contracts";
import { authenticate, type ClerkPolicy } from "./auth.js";
import { readBounded } from "./protocol.js";
import type { BudgetSql } from "./budget.js";

export { waveNetVoices };
export function speechSegments(text: string): string[] {
  const result: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?\n]+[.!?\n]*|[.!?\n]+/gu) ?? [text]) {
    if (Buffer.byteLength(current + sentence) <= 4500) {
      current += sentence;
      continue;
    }
    if (current) {
      result.push(current);
      current = "";
    }
    for (const char of sentence) {
      if (Buffer.byteLength(current + char) > 4500) {
        result.push(current);
        current = "";
      }
      current += char;
    }
  }
  if (current) result.push(current);
  return result;
}
let googleToken: { fingerprint: string; token: string; expires: number } | undefined;
async function googleAuthorization(credentials: string, signal: AbortSignal): Promise<string> {
  const fingerprint = createHash("sha256").update(credentials).digest("hex");
  if (googleToken?.fingerprint === fingerprint && googleToken.expires > Date.now() + 60000)
    return googleToken.token;
  const value = z
    .object({
      type: z.literal("service_account"),
      client_email: z.email(),
      private_key: z.string().min(100),
      token_uri: z.literal("https://oauth2.googleapis.com/token"),
    })
    .parse(JSON.parse(credentials));
  const now = Math.floor(Date.now() / 1000);
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body =
    encode({ alg: "RS256", typ: "JWT" }) +
    "." +
    encode({
      iss: value.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: value.token_uri,
      iat: now,
      exp: now + 3600,
    });
  const assertion =
    body + "." + sign("RSA-SHA256", Buffer.from(body), value.private_key).toString("base64url");
  const response = await fetch(value.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("OD_SPEECH_CREDENTIALS_UNAVAILABLE");
  }
  const token = z
    .object({
      access_token: z.string().min(1).max(16000),
      expires_in: z.number().positive().max(3600),
    })
    .parse(JSON.parse(await readBounded(response.body, 32000, signal)));
  googleToken = {
    fingerprint,
    token: token.access_token,
    expires: Date.now() + token.expires_in * 1000,
  };
  return token.access_token;
}
export async function waveNet(
  text: string,
  language: keyof typeof waveNetVoices,
  key: string,
  signal: AbortSignal,
): Promise<Buffer> {
  const voice = waveNetVoices[language];
  const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await googleAuthorization(key, signal)}`,
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voice.split("-").slice(0, 2).join("-"), name: voice },
      audioConfig: { audioEncoding: "OGG_OPUS" },
    }),
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("OD_SPEECH_PROVIDER_FAILED");
  }
  const value = z
    .strictObject({ audioContent: z.string().max(28_000_000) })
    .parse(JSON.parse(await readBounded(response.body, 28_000_100, signal)));
  const audio = Buffer.from(value.audioContent, "base64");
  if (audio.subarray(0, 4).toString() !== "OggS") throw new Error("OD_SPEECH_AUDIO_INVALID");
  return audio;
}
const envelope = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("synthesize"), request: speechRequestSchema }),
  z.strictObject({ action: z.enum(["ack", "cancel"]), id: z.uuid() }),
]);
export async function speechResponse(
  request: Request,
  options: { auth: ClerkPolicy; sql: BudgetSql; key: string; throttleKey: string; address: string },
): Promise<Response> {
  const headers = { "cache-control": "no-store", "content-type": "application/x-ndjson" };
  const failure = (status: number) =>
    new Response(JSON.stringify({ error: "speech-unavailable" }), { status, headers });
  try {
    const uid = await authenticate(request, options.auth);
    const cancellation = new AbortController();
    const signal = AbortSignal.any([
      cancellation.signal,
      request.signal,
      AbortSignal.timeout(120000),
    ]);
    const value = envelope.parse(JSON.parse(await readBounded(request.body, 30000, signal)));
    const transition = async (id: string, action: string) => {
      const result = await options.sql.query(
        "SELECT nina_speech.transition($1::uuid,$2,$3) AS ok",
        [id, uid, action],
      );
      return z.object({ ok: z.boolean() }).parse(result.rows[0]).ok;
    };
    if (value.action !== "synthesize")
      return new Response(JSON.stringify({ ok: await transition(value.id, value.action) }), {
        headers,
      });
    const { id, text, language } = value.request;
    const network = createHmac("sha256", options.throttleKey)
      .update(new Date().toISOString().slice(0, 10) + options.address)
      .digest("hex");
    const admission = await options.sql.query(
      "SELECT nina_speech.reserve($1::uuid,$2,$3,$4) AS status",
      [id, uid, Array.from(text).length, network],
    );
    if (z.object({ status: z.string() }).parse(admission.rows[0]).status !== "reserved")
      return failure(429);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (const segment of speechSegments(text)) {
            signal.throwIfAborted();
            if (!(await transition(id, "dispatch"))) throw new Error("disabled");
            const audio = await waveNet(segment, language, options.key, signal);
            controller.enqueue(
              encoder.encode(JSON.stringify({ audio: audio.toString("base64") }) + "\n"),
            );
          }
          signal.throwIfAborted();
          if (!(await transition(id, "delivered"))) throw new Error("expired");
          controller.enqueue(encoder.encode(JSON.stringify({ complete: true }) + "\n"));
          controller.close();
        } catch {
          await transition(id, "cancel").catch(() => false);
          try {
            controller.error(new Error("OD_SPEECH_FAILED"));
          } catch {
            /* disconnected */
          }
        }
      },
      async cancel() {
        cancellation.abort();
        await transition(id, "cancel").catch(() => false);
      },
    });
    return new Response(stream, { headers });
  } catch {
    return failure(503);
  }
}
