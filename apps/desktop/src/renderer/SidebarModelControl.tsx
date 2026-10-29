import { useEffect, useState } from "react";
import type { Language, SpeechSnapshot } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { useProviderView } from "./useProviderView.js";
import { useNinaAccountState } from "./NinaAccount.js";
import { invokeDesktop, subscribeDesktop } from "./ipc.js";
import styles from "./SidebarModelControl.module.css";

export function SidebarModelControl({ language }: { language: Language }) {
  const { t } = useTranslation();
  const view = useProviderView();
  const nina = useNinaAccountState();
  const [speech, setSpeech] = useState<SpeechSnapshot>();
  useEffect(() => {
    let live = true;
    let serial = 0;
    const refresh = async () => {
      const ticket = ++serial;
      try {
        const next = await invokeDesktop("speech/read", {});
        if (live && ticket === serial) setSpeech(next);
      } catch {
        if (live && ticket === serial) setSpeech(undefined);
      }
    };
    void refresh();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        setSpeech(undefined);
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
  const pack = speech?.packs.find(
    (entry) => entry.language === language && entry.engine === source,
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
  return (
    <dl className={styles.navModelPanel}>
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
  );
}
