import { ninaPublicConfiguration, type SpeechRequest } from "@call-nina/contracts";
import { type NinaAccount } from "./nina-account.js";

export async function managedSpeech(
  account: NinaAccount,
  request: SpeechRequest,
  signal: AbortSignal,
  save: (clips: Buffer[]) => Promise<void>,
): Promise<Buffer[]> {
  const epoch = account.epoch;
  account.assert(epoch);
  if (!account.state.access?.speech.enabled || !account.state.access.speech.serviceEnabled)
    throw new Error("OD_SPEECH_ACCOUNT_DISABLED");
  const token = await account.token(epoch);
  const origin = ninaPublicConfiguration.serviceOrigin;
  if (!origin) throw new Error("OD_SPEECH_UNAVAILABLE");
  const post = (body: unknown, requestSignal: AbortSignal) =>
    fetch(`${origin}/api/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: requestSignal,
      redirect: "error",
      credentials: "omit",
    });
  try {
    const response = await post({ action: "synthesize", request }, signal);
    if (!response.ok || !response.body) throw new Error("OD_SPEECH_ALLOWANCE_UNAVAILABLE");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "",
      total = 0,
      complete = false;
    const clips: Buffer[] = [];
    try {
      for (;;) {
        signal.throwIfAborted();
        account.assert(epoch);
        const next = await reader.read();
        if (next.done) break;
        const chunk: unknown = next.value;
        if (!(chunk instanceof Uint8Array)) throw new Error("OD_SPEECH_AUDIO_INVALID");
        total += chunk.length;
        if (total > 56_000_000) throw new Error("OD_SPEECH_TOO_LARGE");
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          const data = JSON.parse(line) as { audio?: unknown; complete?: unknown };
          if (data.complete === true) {
            complete = true;
            continue;
          }
          if (complete || typeof data.audio !== "string" || clips.length >= 12)
            throw new Error("OD_SPEECH_AUDIO_INVALID");
          const audio = Buffer.from(data.audio, "base64");
          if (audio.subarray(0, 4).toString() !== "OggS")
            throw new Error("OD_SPEECH_AUDIO_INVALID");
          clips.push(audio);
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (!complete || pending.trim() || !clips.length) throw new Error("OD_SPEECH_INCOMPLETE");
    signal.throwIfAborted();
    account.assert(epoch);
    await save(clips);
    signal.throwIfAborted();
    account.assert(epoch);
    const ack = await post({ action: "ack", id: request.id }, AbortSignal.timeout(10000));
    if (!ack.ok) throw new Error("OD_SPEECH_ACK_FAILED");
    const confirmation: unknown = await ack.json();
    if (
      !confirmation ||
      typeof confirmation !== "object" ||
      !("ok" in confirmation) ||
      confirmation.ok !== true
    )
      throw new Error("OD_SPEECH_ACK_FAILED");
    account.state.access.speech.remainingCharacters = Math.max(
      0,
      account.state.access.speech.remainingCharacters - Array.from(request.text).length,
    );
    return clips;
  } catch (error) {
    await post({ action: "cancel", id: request.id }, AbortSignal.timeout(10000)).catch(
      () => undefined,
    );
    throw error;
  }
}
