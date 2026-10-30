import {
  speechTextSchema,
  type Language,
  type SpeechPlaybackRequest,
  type CallNinaError,
} from "@call-nina/contracts";
import { invokeDesktop, subscribeDesktop, DesktopOperationError } from "./ipc.js";

type LocalSource = SpeechPlaybackRequest["source"];
type Readiness = { available: boolean; reason: string };
type AvailabilityEntry = {
  text: string;
  language: Language;
  source?: LocalSource;
  voice?: string;
  value: Readiness;
  listeners: Set<() => void>;
  sequence: number;
};
const checking: Readiness = { available: false, reason: "checking" };
const unavailable: Readiness = { available: false, reason: "unavailable" };
const availability = new Map<string, AvailabilityEntry>();
let disconnect: (() => void) | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

// Keep the original text intact in each request; never synthesize a truncated passage.
export function speechSegments(text: string, language: Language): string[] {
  if (!text.trim()) return [];
  const parts: string[] = [];
  let pending = "";
  const flush = () => {
    if (pending.trim()) parts.push(pending);
    pending = "";
  };
  for (const { segment } of new Intl.Segmenter(language, { granularity: "sentence" }).segment(
    text,
  )) {
    const characters = Array.from(segment);
    if (Array.from(pending).length + characters.length > 6000) flush();
    while (characters.length > 6000) {
      let boundary = 6000;
      for (let i = 5999; i >= 4000; i--)
        if (/\s/u.test(characters[i] ?? "")) {
          boundary = i + 1;
          break;
        }
      const part = characters.splice(0, boundary).join("");
      if (part.trim()) parts.push(part);
    }
    pending += characters.join("");
  }
  flush();
  return parts;
}
export const speechAvailabilityKey = (
  text: string,
  language: Language,
  source?: LocalSource,
  voice?: string,
) => JSON.stringify([text, language, source, voice]);
export function readSpeechAvailability(key: string) {
  return availability.get(key)?.value ?? checking;
}
async function refreshEntry(entry: AvailabilityEntry) {
  const sequence = ++entry.sequence;
  let value = unavailable;
  try {
    const segments = speechSegments(entry.text, entry.language);
    if (segments.length && segments.every((text) => speechTextSchema.safeParse(text).success)) {
      value = { available: true, reason: "ready" };
      for (const text of segments) {
        const result = await invokeDesktop("speech/availability", {
          id: crypto.randomUUID(),
          text,
          language: entry.language,
          ...(entry.source ? { source: entry.source } : {}),
          ...(entry.voice ? { voice: entry.voice } : {}),
          online: navigator.onLine,
        });
        if (sequence !== entry.sequence) return;
        if (!result.available) {
          value = result;
          break;
        }
      }
    }
  } catch {
    /* A failed probe never enables synthesis. */
  }
  if (sequence !== entry.sequence) return;
  entry.value = value;
  for (const listener of entry.listeners) listener();
}
export function refreshSpeechAvailability() {
  if (refreshTimer) clearTimeout(refreshTimer);
  for (const entry of availability.values()) {
    entry.sequence++;
    entry.value = checking;
    for (const listener of entry.listeners) listener();
  }
  refreshTimer = setTimeout(() => {
    for (const entry of availability.values()) void refreshEntry(entry);
  }, 100);
}
function connect() {
  if (disconnect) return;
  const unsubscribe = subscribeDesktop((event) => {
    if (
      event.event !== "state-invalidated" ||
      !["settings", "account", "models", "ai-connections"].includes(event.scope)
    )
      return;
    // Text-provider refreshes must not interrupt independent local Audio.
    // Account changes cancel in-flight synthesis in main; completed clips remain playable.
    if (event.scope === "settings" || event.scope === "models") stopSpeech();
    refreshSpeechAvailability();
  });
  window.addEventListener("online", refreshSpeechAvailability);
  window.addEventListener("offline", refreshSpeechAvailability);
  disconnect = () => {
    unsubscribe();
    window.removeEventListener("online", refreshSpeechAvailability);
    window.removeEventListener("offline", refreshSpeechAvailability);
    disconnect = undefined;
    if (refreshTimer) clearTimeout(refreshTimer);
  };
}
export function subscribeSpeechAvailability(
  key: string,
  text: string,
  language: Language,
  source: LocalSource,
  voice: string | undefined,
  listener: () => void,
) {
  let entry = availability.get(key);
  if (!entry) {
    entry = {
      text,
      language,
      ...(source ? { source } : {}),
      ...(voice ? { voice } : {}),
      value: checking,
      listeners: new Set(),
      sequence: 0,
    };
    availability.set(key, entry);
    void refreshEntry(entry);
  }
  entry.listeners.add(listener);
  connect();
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) {
      entry.sequence++;
      availability.delete(key);
    }
    if (!availability.size) disconnect?.();
  };
}

type QueuedAudio = { url: string; element?: HTMLAudioElement };
const queue: QueuedAudio[] = [];
let player: HTMLAudioElement | undefined;
let starting = false;
let owner: string | null = null;
let sequence = 0;
let activeRequestId: string | null = null;
let cancellation: Promise<unknown> = Promise.resolve();
let complete = false;
let playbackFailure: (error: unknown) => void = () => undefined;
let snapshot: {
  owner: string | null;
  loading: boolean;
  rate: number;
  error: { owner: string; detail: CallNinaError | true } | null;
} = {
  owner,
  loading: false,
  rate: 1,
  error: null as { owner: string; detail: CallNinaError | true } | null,
};
const listeners = new Set<() => void>();
function changed(values: Partial<typeof snapshot> = {}) {
  const next = { ...snapshot, owner, ...values };
  if (
    next.owner === snapshot.owner &&
    next.loading === snapshot.loading &&
    next.rate === snapshot.rate &&
    next.error === snapshot.error
  )
    return;
  snapshot = next;
  for (const listener of listeners) listener();
}
export const readSpeechPlayback = () => snapshot;
export function subscribeSpeechPlayback(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function release(audio: QueuedAudio) {
  if (audio.element) {
    audio.element.onended = null;
    audio.element.onerror = null;
    audio.element.pause();
    audio.element.removeAttribute("src");
    audio.element.load();
  }
  URL.revokeObjectURL(audio.url);
}
export function stopSpeech() {
  sequence++;
  owner = null;
  complete = false;
  player = undefined;
  starting = false;
  for (const audio of queue) release(audio);
  queue.length = 0;
  const cancelled = activeRequestId;
  activeRequestId = null;
  if (cancelled)
    cancellation = cancellation
      .then(() => invokeDesktop("speech/manage", { action: "cancel", id: cancelled }))
      .catch(() => undefined);
  changed({ loading: false });
}
function preload() {
  // Bound native players while preparing the next chunk before the current one ends.
  for (const audio of queue.slice(0, 2)) {
    if (audio.element) continue;
    audio.element = new Audio(audio.url);
    audio.element.preload = "auto";
    audio.element.playbackRate = snapshot.rate;
    audio.element.preservesPitch = true;
  }
}
function finished() {
  if (complete && !queue.length && !starting) {
    stopSpeech();
    refreshSpeechAvailability();
  }
}
async function next() {
  if (player || starting || !owner) return;
  if (!queue.length) {
    finished();
    return;
  }
  preload();
  const queued = queue[0]!;
  const audio = queued.element!;
  player = audio;
  starting = true;
  const ticket = sequence;
  audio.onended = () => {
    if (ticket !== sequence || player !== audio) return;
    player = undefined;
    queue.shift();
    release(queued);
    void next().catch(playbackFailure);
  };
  audio.onerror = () => {
    if (ticket === sequence) playbackFailure(new Error("OD_SPEECH_AUDIO_INVALID"));
  };
  try {
    await audio.play();
    if (ticket === sequence) changed({ loading: false });
  } finally {
    if (ticket === sequence) {
      starting = false;
      finished();
    }
  }
}
function append(encoded: string) {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  queue.push({ url: URL.createObjectURL(new Blob([bytes], { type: "audio/ogg" })) });
  preload();
  void next().catch(playbackFailure);
}
export function setSpeechRate(rate: 0.75 | 1) {
  for (const audio of queue) if (audio.element) audio.element.playbackRate = rate;
  changed({ rate });
}
export async function playSpeech(
  id: string,
  text: string,
  language: Language,
  source?: LocalSource,
  voice?: string,
) {
  if (owner === id) {
    stopSpeech();
    return;
  }
  stopSpeech();
  owner = id;
  const ticket = sequence;
  changed({ loading: true, error: null });
  const current = () => owner === id && ticket === sequence;
  const fail = (error: unknown) => {
    if (!current()) return;
    stopSpeech();
    changed({
      error: { owner: id, detail: error instanceof DesktopOperationError ? error.detail : true },
    });
  };
  try {
    playbackFailure = fail;
    await cancellation;
    if (!current()) return;
    for (const segment of speechSegments(text, language)) {
      if (!current()) return;
      const requestId = crypto.randomUUID();
      activeRequestId = requestId;
      let received = false;
      const unsubscribe = subscribeDesktop((event) => {
        if (event.event === "speech-audio" && event.id === requestId && current()) {
          try {
            received = true;
            append(event.audio);
          } catch (error) {
            fail(error);
          }
        }
      });
      try {
        const result = await invokeDesktop("speech/synthesize", {
          id: requestId,
          text: segment,
          language,
          ...(source ? { source } : {}),
          ...(voice ? { voice } : {}),
        });
        if (!current()) return;
        activeRequestId = null;
        if (!received) for (const clip of result.clips) append(clip);
      } finally {
        unsubscribe();
      }
    }
    if (!current()) return;
    complete = true;
    finished();
  } catch (error) {
    fail(error);
  }
}
