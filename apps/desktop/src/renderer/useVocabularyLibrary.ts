import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopIpcRequest, DesktopIpcResponse, CallNinaError } from "@call-nina/contracts";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";

export type VocabularyEntry = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "vocabulary/detail" }
>["result"]["entry"];
export type VocabularyLibrary = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "vocabulary/read" }
>["result"];
export type VocabularyFilter = Extract<
  DesktopIpcRequest,
  { channel: "vocabulary/read" }
>["payload"];
export type VocabularySummary = VocabularyLibrary["entries"][number];
export type VocabularyBulkAction = Extract<
  DesktopIpcRequest,
  { channel: "vocabulary/bulk" }
>["payload"]["action"];

export function vocabularyVersion(
  entry: Pick<VocabularyEntry, "vocabularyId" | "revision" | "updatedAt">,
) {
  return {
    vocabularyId: entry.vocabularyId,
    expectedRevision: entry.revision,
    expectedUpdatedAt: entry.updatedAt,
  };
}

export function useVocabularyLibrary(initialDueOnly: boolean) {
  const [query, setQuery] = useState<VocabularyFilter>({
    search: "",
    filter: initialDueOnly ? "due" : "all",
    sort: "word",
    page: 0,
  });
  const queryRef = useRef(query);
  const [result, setResult] = useState<VocabularyLibrary>();
  const [rootGeneration, setRootGeneration] = useState<VocabularyLibrary["rootGeneration"]>();
  const [error, setError] = useState<CallNinaError>();
  const [busy, setBusy] = useState(true);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    const requestedQuery = queryRef.current;
    setBusy(true);
    setError(undefined);
    try {
      const next = await invokeDesktop("vocabulary/read", requestedQuery);
      if (current !== version.current) return;
      setRootGeneration(next.rootGeneration);
      setResult(next);
      if (next.page !== requestedQuery.page) {
        queryRef.current = { ...requestedQuery, page: next.page };
        setQuery(queryRef.current);
      }
    } catch (cause) {
      if (current === version.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === version.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        version.current += 1;
        setResult(undefined);
        queryRef.current = { ...queryRef.current, page: 0 };
        setQuery(queryRef.current);
      } else if (
        event.event === "state-invalidated" &&
        (event.scope === "vocabulary" || event.scope === "dashboard")
      ) {
        void refresh();
      }
    });
    return () => {
      version.current += 1;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh, query]);
  const changeQuery = useCallback((patch: Partial<VocabularyFilter>) => {
    version.current += 1;
    setBusy(true);
    setResult(undefined);
    queryRef.current = { ...queryRef.current, ...patch };
    setQuery(queryRef.current);
  }, []);
  return { result, rootGeneration, query, changeQuery, busy, error, refresh };
}
