import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopIpcResponse, CallNinaError } from "@call-nina/contracts";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";

export type LearningPathSnapshot = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "learning-path/read" }
>["result"];
export function useLearningPath() {
  const [snapshot, setSnapshot] = useState<LearningPathSnapshot>();
  const [error, setError] = useState<CallNinaError>();
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const value = await invokeDesktop("learning-path/read", {});
      if (current === sequence.current) {
        setSnapshot(value);
        setError(undefined);
      }
    } catch (cause) {
      if (current === sequence.current) setError(normalizeDesktopError(cause).detail);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const sequenceRef = sequence;
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated" && ["dashboard", "history"].includes(event.scope))
        void refresh();
    });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      sequenceRef.current++;
      window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  return { snapshot, error, refresh };
}
