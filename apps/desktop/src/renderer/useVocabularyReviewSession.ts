import { useCallback, useEffect, useRef, useState } from "react";
import type { DataRootGeneration, CallNinaError, DesktopIpcResponse } from "@call-nina/contracts";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { vocabularyVersion } from "./useVocabularyLibrary.js";
export function useVocabularyReviewSession(
  rootGeneration: DataRootGeneration,
  onChanged: () => void,
) {
  const [queue, setQueue] =
    useState<
      Extract<
        DesktopIpcResponse,
        { status: "ok"; channel: "vocabulary/review-queue" }
      >["result"]["entries"]
    >();
  const [index, setIndex] = useState(0);
  const [selectedRetrieval, setRetrieval] = useState<"recognition" | "recall" | "use">();
  const [revealed, setRevealed] = useState(false);
  const [dueOn, setDueOn] = useState<string>();
  const [reviewed, setReviewed] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<CallNinaError>();
  const locked = useRef(false);
  const version = useRef(0);
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dueOn || error) nextButton.current?.focus();
  }, [dueOn, error, revealed]);
  const load = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    const current = ++version.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("vocabulary/review-queue", { rootGeneration });
      if (current !== version.current) return;
      setQueue(result.entries);
      setIndex(0);
      setReviewed(0);
      setDueOn(undefined);
      setRevealed(false);
    } catch (cause) {
      if (current === version.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === version.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }, [rootGeneration]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      version.current += 1;
      locked.current = false;
      window.clearTimeout(timer);
    };
  }, [load]);
  const entry = queue?.[index];
  const today = new Date().toISOString().slice(0, 10);
  const retrieval =
    selectedRetrieval ??
    entry?.retrievalSchedules.find((s) => s.retrieval === "recall" && s.dueOn <= today)
      ?.retrieval ??
    entry?.retrievalSchedules.find((s) => s.dueOn <= today)?.retrieval ??
    "recall";
  const grade = async (value: "again" | "hard" | "good" | "easy") => {
    if (!entry || !revealed || dueOn || locked.current || error) return;
    locked.current = true;
    const current = version.current;
    setBusy(true);
    try {
      const result = await invokeDesktop("vocabulary/review", {
        rootGeneration,
        ...vocabularyVersion(entry),
        grade: value,
        retrieval,
      });
      if (current !== version.current) return;
      setDueOn(result.dueOn);
      setReviewed((previous) => previous + 1);
      onChanged();
    } catch (cause) {
      if (current === version.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === version.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const next = () => {
    setIndex(index + 1);
    setRetrieval(undefined);
    setRevealed(false);
    setDueOn(undefined);
    setError(undefined);
  };
  return {
    queue,
    index,
    retrieval,
    setRetrieval,
    revealed,
    setRevealed,
    dueOn,
    reviewed,
    busy,
    error,
    nextButton,
    load,
    today,
    entry,
    grade,
    next,
  };
}
