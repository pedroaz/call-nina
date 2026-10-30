import { useEffect, useState, useSyncExternalStore } from "react";
import { SlidersHorizontal, ChevronUp } from "lucide-react";
import type { Language, SpeechSnapshot } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { useProviderView } from "./useProviderView.js";
import { useNinaAccountState } from "./NinaAccount.js";
import { invokeDesktop, subscribeDesktop } from "./ipc.js";
import { SelectField, Feedback, UtilityPopover, Button } from "./components/ui/index.js";
import languageStyles from "./SidebarLanguages.module.css";
import { readSpeechPlayback, subscribeSpeechPlayback, setSpeechRate } from "./speechPlayback.js";
import styles from "./SidebarModelControl.module.css";

export function SidebarModelControl({
  language,
  collapsed,
  onConfigure,
}: {
  language: Language;
  collapsed: boolean;
  onConfigure: () => void;
}) {
  const { t } = useTranslation();
  const view = useProviderView();
  const nina = useNinaAccountState();
  const [speech, setSpeech] = useState<SpeechSnapshot>();
  const playback = useSyncExternalStore(subscribeSpeechPlayback, readSpeechPlayback);
  const [savingRate, setSavingRate] = useState(false);
  const [rateFailed, setRateFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let serial = 0;
    const refresh = async () => {
      const ticket = ++serial;
      try {
        const next = await invokeDesktop("speech/read", {});
        if (live && ticket === serial) {
          setSpeech(next);
          setSpeechRate(next.preferences.playbackRate);
        }
      } catch {
        if (live && ticket === serial) setSpeech(undefined);
      }
    };
    void refresh();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        setSpeech(undefined);
        setSpeechRate(1);
        void refresh();
      } else if (event.event === "state-invalidated") void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => {
      live = false;
      ++serial;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);
  const changeRate = async (rate: 0.75 | 1) => {
    if (savingRate) return;
    setSavingRate(true);
    setRateFailed(false);
    try {
      const next = await invokeDesktop("speech/manage", { action: "playback-rate", rate });
      setSpeech(next);
      setSpeechRate(next.preferences.playbackRate);
    } catch {
      setRateFailed(true);
    } finally {
      setSavingRate(false);
    }
  };
  const route = view?.settings.routing.text;
  const connection = view?.settings.connections.find((entry) => entry.routeId === route);
  const status = view?.availability.find((entry) => entry.connectionId === connection?.id)?.status;
  const connected = status === "available" || status === "configured";
  const shortNames: Record<string, string> = {
    chatgpt: "ChatGPT",
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
  };
  const exercise =
    connected && route
      ? (shortNames[route] ?? t(`connectionSettings.routes.${route}`))
      : t("providers.disconnected");
  const source = speech?.preferences[language];
  const voiceId = source ? speech?.preferences.voices[`${source}:${language}`] : undefined;
  const pack = speech?.packs.find((entry) =>
    voiceId ? entry.id === voiceId : entry.language === language && entry.engine === source,
  );
  const audioReady =
    source === "managed"
      ? nina.status === "signed-in" &&
        nina.access?.speech.enabled &&
        nina.access.speech.serviceEnabled &&
        nina.access.speech.remainingCharacters > 0
      : speech?.supported && pack?.state === "installed";
  const audio = audioReady
    ? source === "managed"
      ? t("connectionSettings.routes.managed")
      : source === "pocket"
        ? "Pocket TTS"
        : "Piper"
    : t("providers.disconnected");
  if (collapsed) return null;
  return (
    <UtilityPopover
      label={t("setupUx.aiAudio")}
      triggerClassName={languageStyles.trigger}
      placement="right bottom"
      closePosition="top-right"
      leadingIcon={<SlidersHorizontal aria-hidden="true" />}
      trailingIcon={<ChevronUp aria-hidden="true" />}
      triggerContent={
        <span className={languageStyles.copy}>
          <span>{t("setupUx.aiAudio")}</span>
          <span className={languageStyles.summary}>
            {exercise} · {audio}
          </span>
        </span>
      }
    >
      <dl className={styles.assignments}>
        {(
          [
            ["exerciseSummary", exercise],
            ["audioSummary", audio],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className={styles.assignment}>
            <dt>{t(`setupUx.${label}`)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <SelectField
        className={styles.rate}
        density="compact"
        label={t("speech.playbackSpeed")}
        value={playback.rate}
        disabled={!speech}
        aria-disabled={savingRate || undefined}
        aria-busy={savingRate || undefined}
        onChange={(event) => void changeRate(event.currentTarget.value === "0.75" ? 0.75 : 1)}
      >
        <option value="0.75">0.75×</option>
        <option value="1">1×</option>
      </SelectField>
      {rateFailed && (
        <Feedback density="compact" tone="error" live="assertive">
          {t("settings.saveFailed")}
        </Feedback>
      )}
      <Button variant="secondary" slot="close" onPress={onConfigure}>
        {t("providers.configure")}
      </Button>
    </UtilityPopover>
  );
}
