import { useEffect, useId, useState, useSyncExternalStore, useRef } from "react";
import { Volume2, Square } from "lucide-react";
import type { Language } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/index.js";
import styles from "./SpeechSettings.module.css";
import { invokeDesktop, subscribeDesktop } from "./ipc.js";

let owner: string | null = null;
let player: HTMLAudioElement | null = null;
let revision = 0;
let urls: string[] = [];
let requestSequence = 0;
let cancellation: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
const changed = () => {
  revision++;
  for (const listener of listeners) listener();
};
export function stopSpeech() {
  requestSequence++;
  owner = null;
  player?.pause();
  player = null;
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
  changed();
  cancellation = invokeDesktop("speech/manage", { action: "cancel" }).catch(() => undefined);
}
export function SpeechButton({
  text,
  language,
  showUnavailableReason = true,
}: {
  text: string;
  language: Language;
  showUnavailableReason?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [slow, setSlow] = useState(false);
  const playbackRate = useRef(1);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState({ available: false, reason: "checking" });
  useEffect(() => {
    let mounted = true,
      sequence = 0;
    const refresh = async () => {
      const ticket = ++sequence;
      try {
        const value = await invokeDesktop("speech/availability", {
          id: crypto.randomUUID(),
          text,
          language,
          online: navigator.onLine,
        });
        if (mounted && ticket === sequence) setAvailability(value);
      } catch {
        if (mounted && ticket === sequence)
          setAvailability({ available: false, reason: "unavailable" });
      }
    };
    const initial = window.setTimeout(() => {
      setAvailability({ available: false, reason: "checking" });
      void refresh();
    }, 0);
    const onConnection = () => {
      void refresh();
    };
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated") void refresh();
    });
    window.addEventListener("online", onConnection);
    window.addEventListener("offline", onConnection);
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => {
      mounted = false;
      window.clearTimeout(initial);
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("online", onConnection);
      window.removeEventListener("offline", onConnection);
    };
  }, [text, language]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revision,
  );
  const active = owner === id;
  useEffect(
    () => () => {
      if (owner === id) stopSpeech();
    },
    [id, text, language],
  );
  useEffect(
    () =>
      subscribeDesktop((event) => {
        if (event.event === "state-invalidated" && owner === id) stopSpeech();
      }),
    [id],
  );
  const play = async () => {
    if (active) {
      stopSpeech();
      return;
    }
    stopSpeech();
    const ticket = requestSequence;
    owner = id;
    changed();
    setLoading(true);
    setError(false);
    const requestId = crypto.randomUUID();
    const stream = { received: false };
    let complete = false,
      index = 0,
      starting = false;
    const current = () => owner === id && ticket === requestSequence;
    const fail = () => {
      if (current()) {
        setError(true);
        stopSpeech();
      }
    };
    const next = async () => {
      if (!current() || starting || player) return;
      if (index >= urls.length) {
        if (complete) stopSpeech();
        return;
      }
      starting = true;
      try {
        player = new Audio(urls[index++]);
        player.playbackRate = playbackRate.current;
        player.preservesPitch = true;
        player.onended = () => {
          if (current()) {
            player = null;
            void next().catch(fail);
          }
        };
        player.onerror = fail;
        await player.play();
        if (current()) setLoading(false);
      } finally {
        starting = false;
      }
    };
    const append = (encoded: string) => {
      if (!current()) return;
      urls.push(
        URL.createObjectURL(
          new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: "audio/ogg" }),
        ),
      );
    };
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event !== "speech-audio" || event.id !== requestId || !current()) return;
      try {
        stream.received = true;
        append(event.audio);
        void next().catch(fail);
      } catch {
        fail();
      }
    });
    try {
      await cancellation;
      if (!current()) return;
      const result = await invokeDesktop("speech/synthesize", { id: requestId, text, language });
      if (!current()) return;
      complete = true;
      if (!stream.received) for (const audio of result.clips) append(audio);
      await next();
    } catch {
      fail();
    } finally {
      unsubscribe();
      if (ticket === requestSequence) setLoading(false);
    }
  };
  return (
    <span className={styles.playback}>
      <Button
        variant="quiet"
        aria-label={t(active ? "speech.stop" : "speech.play")}
        isDisabled={!active && !availability.available}
        {...(showUnavailableReason && !active && !availability.available
          ? { "aria-describedby": `${id}-availability` }
          : {})}
        onPress={() => void play()}
      >
        {active ? <Square size={16} /> : <Volume2 size={16} />}{" "}
        {loading && active ? t("speech.loading") : t(active ? "speech.stop" : "speech.play")}
      </Button>
      <Button
        variant="quiet"
        aria-label={t("speech.slow")}
        aria-pressed={slow}
        isDisabled={!active && !availability.available}
        onPress={() => {
          playbackRate.current = slow ? 1 : 0.75;
          setSlow(!slow);
          if (active && player) player.playbackRate = slow ? 1 : 0.75;
        }}
      >
        0.75×
      </Button>
      {showUnavailableReason && !active && !availability.available && (
        <span id={`${id}-availability`}>{t(`speech.readiness.${availability.reason}`)}</span>
      )}
      {error && <span role="status">{t("speech.unavailable")}</span>}
    </span>
  );
}
