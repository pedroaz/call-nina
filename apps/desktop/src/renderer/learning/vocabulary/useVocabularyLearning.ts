import { type ActivityId, type CallNinaError, type DesktopIpcResponse } from "@call-nina/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "../../runtime/ipc.js";

type Snapshot = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "vocabulary/learning-read" }
>["result"];
export function useVocabularyLearning(activityId?: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState<CallNinaError>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(true);
  const [saving, setSaving] = useState(false);
  const requestVersion = useRef(0);
  const rootEpoch = useRef(0);
  const mounted = useRef(true);
  const updating = useRef(false);
  const refresh = useCallback(async () => {
    if (updating.current) return;
    const version = ++requestVersion.current;
    setReading(true);
    try {
      const next = await invokeDesktop(
        "vocabulary/learning-read",
        activityId ? { activityId: activityId as ActivityId } : {},
      );
      if (version !== requestVersion.current || !mounted.current) return;
      setSnapshot(next);
      setReadError(undefined);
      return next;
    } catch (cause) {
      if (version === requestVersion.current && mounted.current)
        setReadError(normalizeDesktopError(cause).detail);
    } finally {
      if (version === requestVersion.current && mounted.current) setReading(false);
    }
  }, [activityId]);
  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        rootEpoch.current = rootEpoch.current + 1;
        updating.current = false;
        setSaving(false);
        setSnapshot(undefined);
        setError("");
        void refresh();
      }
      if (
        event.event === "state-invalidated" &&
        ["vocabulary", "settings", "dashboard"].includes(event.scope)
      )
        void refresh();
    });
    return () => {
      mounted.current = false;
      requestVersion.current = requestVersion.current + 1;
      rootEpoch.current = rootEpoch.current + 1;
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);
  const update = async (
    action: Parameters<typeof invokeDesktop<"vocabulary/learning-update">>[1]["action"],
  ) => {
    if (!snapshot || updating.current) return false;
    const epoch = rootEpoch.current;
    updating.current = true;
    requestVersion.current = requestVersion.current + 1;
    setReading(false);
    setSaving(true);
    try {
      const next = await invokeDesktop("vocabulary/learning-update", {
        rootGeneration: snapshot.rootGeneration,
        action,
      });
      if (!mounted.current || epoch !== rootEpoch.current) return false;
      setSnapshot(next);
      setError("");
      return true;
    } catch (cause) {
      if (mounted.current && epoch === rootEpoch.current)
        setError(normalizeDesktopError(cause).detail.messageKey);
      return false;
    } finally {
      if (mounted.current && epoch === rootEpoch.current) {
        updating.current = false;
        setSaving(false);
      }
    }
  };
  return { snapshot, refresh, update, readError, reading, error, saving };
}
