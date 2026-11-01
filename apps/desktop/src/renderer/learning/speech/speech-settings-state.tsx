import {
  type CallNinaError,
  type Language,
  type NinaAccountState,
  type SpeechAction,
  type SpeechSnapshot,
} from "@call-nina/contracts";
import { useCallback, useEffect, useState } from "react";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "../../runtime/ipc.js";
import { stopSpeech } from "./SpeechButton.js";

export const languages: Language[] = ["de", "en-US", "pt-BR", "es"];
export const voiceName = (voice: string) =>
  voice === "juergen"
    ? "Jürgen"
    : voice === "hfc_male"
      ? "Hi-Fi Captain"
      : voice === "mls_10246"
        ? "MLS 10246"
        : voice.charAt(0).toUpperCase() + voice.slice(1).replaceAll("_", " ");
export function useSpeechSettings() {
  const [view, setView] = useState<SpeechSnapshot | null>(null);
  const [account, setAccount] = useState<NinaAccountState | null>(null);
  const [readError, setReadError] = useState<CallNinaError>();
  const [actionError, setActionError] = useState<CallNinaError>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true,
      sequence = 0;
    const refresh = async () => {
      const ticket = ++sequence;
      try {
        const [next, user] = await Promise.all([
          invokeDesktop("speech/read", {}),
          invokeDesktop("nina-account/read", {}),
        ]);
        if (live && ticket === sequence) {
          setView(next);
          setAccount(user);
          setReadError(undefined);
        }
      } catch (cause) {
        if (live && ticket === sequence) setReadError(normalizeDesktopError(cause).detail);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated") void refresh();
    });
    return () => {
      live = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  const act = useCallback(async (action: SpeechAction) => {
    if (
      ["preferences", "remove", "clear-private-cache", "clear-cache", "remove-course"].includes(
        action.action,
      )
    )
      stopSpeech();
    setBusy(true);
    setActionError(undefined);
    try {
      setView(await invokeDesktop("speech/manage", action));
      return true;
    } catch (cause) {
      setActionError(normalizeDesktopError(cause).detail);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { view, account, error: actionError ?? readError, busy, act };
}
export function accountReason(account: NinaAccountState | null) {
  const access = account?.access?.speech;
  return account?.status !== "signed-in" || !access?.enabled || !access.serviceEnabled
    ? "account"
    : access.remainingCharacters < 1
      ? "allowance"
      : "ready";
}
export const samples: Record<Language, string> = {
  de: "Guten Morgen! Wie geht es dir?",
  "en-US": "Good morning! How are you?",
  "pt-BR": "Bom dia! Como você está?",
  es: "¡Buenos días! ¿Cómo estás?",
};
