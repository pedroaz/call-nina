import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { Volume2, Square, LoaderCircle } from "lucide-react";
import type { Language, SpeechPlaybackRequest } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "./components/ui/index.js";
import styles from "./SpeechButton.module.css";
import {
  stopSpeech,
  speechAvailabilityKey,
  readSpeechAvailability,
  subscribeSpeechAvailability,
  readSpeechPlayback,
  subscribeSpeechPlayback,
  playSpeech,
} from "./speechPlayback.js";
export { stopSpeech } from "./speechPlayback.js";

export function SpeechButton({
  text,
  language,
  source,
  voice,
  variant = "inline",
  enabled = true,
  showUnavailableReason = true,
}: {
  text: string;
  language: Language;
  source?: SpeechPlaybackRequest["source"];
  voice?: SpeechPlaybackRequest["voice"];
  variant?: "inline" | "passage";
  enabled?: boolean;
  showUnavailableReason?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const key = speechAvailabilityKey(text, language, source, voice);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled
        ? subscribeSpeechAvailability(key, text, language, source, voice, listener)
        : () => {},
    [enabled, key, text, language, source, voice],
  );
  const availability = useSyncExternalStore(subscribe, () => readSpeechAvailability(key));
  const playback = useSyncExternalStore(subscribeSpeechPlayback, readSpeechPlayback);
  const active = playback.owner === id;
  useEffect(
    () => () => {
      if (readSpeechPlayback().owner === id) stopSpeech();
    },
    [id, text, language, source, voice, enabled],
  );
  // Kept-mounted tabs/dialogs can become hidden without unmounting their controls.
  useEffect(() => {
    if (!active) return;
    const observer = new MutationObserver(() => {
      if (root.current?.closest('[hidden], [inert], [aria-hidden="true"], details:not([open])'))
        stopSpeech();
    });
    let element: HTMLElement | null = root.current;
    while (element) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["hidden", "inert", "aria-hidden", "open"],
      });
      element = element.parentElement;
    }
    return () => observer.disconnect();
  }, [active]);
  if (!enabled) return null;
  const label = t(active ? (playback.loading ? "actions.cancel" : "speech.stop") : "speech.play");
  const reason = t(`speech.readiness.${availability.reason}`);
  const error = playback.error?.owner === id ? playback.error.detail : null;
  const icon = active ? (
    playback.loading ? (
      <LoaderCircle className={styles.spinner} aria-hidden="true" />
    ) : (
      <Square aria-hidden="true" />
    )
  ) : (
    <Volume2 aria-hidden="true" />
  );
  const play = () => {
    if (active || availability.available) void playSpeech(id, text, language, source, voice);
  };
  const description =
    !active && !availability.available && showUnavailableReason ? reason : undefined;
  return (
    <span
      ref={root}
      className={styles.playback}
      data-variant={variant}
      data-active={active || undefined}
      lang=""
    >
      {variant === "inline" ? (
        <IconButton
          density="compact"
          variant="quiet"
          label={description ? `${label} · ${description}` : label}
          leadingIcon={icon}
          aria-disabled={!active && !availability.available}
          {...(error ? { "aria-describedby": `${id}-error` } : {})}
          onPress={play}
        />
      ) : (
        <Button
          density="compact"
          variant="quiet"
          leadingIcon={icon}
          aria-disabled={!active && !availability.available}
          onPress={play}
          {...(description ? { "aria-describedby": `${id}-availability` } : {})}
        >
          {label}
        </Button>
      )}
      {description && variant === "passage" && (
        <span id={`${id}-availability`} className={styles.status}>
          {description}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className={styles.status} role="status">
          {t(error === true ? "speech.unavailable" : error.messageKey)}
        </span>
      )}
    </span>
  );
}
