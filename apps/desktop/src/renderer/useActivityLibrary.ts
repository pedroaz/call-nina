import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopIpcRequest, DesktopIpcResponse, CallNinaError } from "@call-nina/contracts";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";

type Filter = Extract<DesktopIpcRequest, { channel: "activity/list" }>["payload"];
type Snapshot = Extract<DesktopIpcResponse, { status: "ok"; channel: "activity/list" }>["result"];

export function useActivityLibrary(
  activityTypes: Filter["activityTypes"],
  enabled = true,
  material?: Filter["material"],
) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const version = useRef(0);
  const retainedCount = useRef(20);
  const filterKey = activityTypes.join(",");
  const materialId = material?.materialId;
  const revisionId = material?.revisionId;
  const fetchPage = useCallback(
    async (cursor?: NonNullable<Snapshot["nextCursor"]>) => {
      const current = ++version.current;
      setBusy(true);
      setError(undefined);
      try {
        const targetCount = cursor ? 20 : retainedCount.current;
        let nextCursor = cursor;
        let next: Snapshot;
        const entries: Snapshot["entries"][number][] = [];
        let scopeKey: string | undefined;
        do {
          next = await invokeDesktop("activity/list", {
            activityTypes: filterKey.split(",").filter(Boolean) as Filter["activityTypes"],
            maximum: 20,
            ...(materialId && revisionId ? { material: { materialId, revisionId } } : {}),
            ...(nextCursor ? { cursor: nextCursor } : {}),
          });
          if (current !== version.current) return;
          const observedScope = JSON.stringify([next.rootGeneration, next.learningScope]);
          if (scopeKey && scopeKey !== observedScope)
            throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
          scopeKey = observedScope;
          entries.push(...next.entries);
          nextCursor = next.nextCursor ?? undefined;
        } while (entries.length < targetCount && nextCursor);
        next = { ...next, entries };
        if (current !== version.current) return;
        if (cursor) retainedCount.current += next.entries.length;
        setSnapshot((previous) => ({
          ...next,
          entries:
            cursor &&
            previous?.rootGeneration === next.rootGeneration &&
            JSON.stringify(previous.learningScope) === JSON.stringify(next.learningScope)
              ? [
                  ...previous.entries,
                  ...next.entries.filter(
                    (entry) => !previous.entries.some((old) => old.activityId === entry.activityId),
                  ),
                ]
              : next.entries,
        }));
      } catch (cause) {
        if (current === version.current) setError(normalizeDesktopError(cause).detail);
      } finally {
        if (current === version.current) setBusy(false);
      }
    },
    [filterKey, materialId, revisionId],
  );
  const refresh = useCallback(() => fetchPage(), [fetchPage]);
  useEffect(() => {
    if (!enabled) return;
    const initial = window.setTimeout(() => {
      retainedCount.current = 20;
      setSnapshot(undefined);
      void refresh();
    }, 0);
    const onFocus = () => void refresh();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated" && event.scope === "dashboard") void refresh();
    });
    window.addEventListener("focus", onFocus);
    return () => {
      version.current += 1;
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [enabled, refresh]);
  return {
    rootGeneration: snapshot?.rootGeneration,
    learningScope: snapshot?.learningScope,
    entries: snapshot?.entries ?? [],
    loaded: snapshot !== undefined,
    busy,
    error,
    refresh,
    hasMore: Boolean(snapshot?.nextCursor),
    loadMore: () =>
      snapshot?.nextCursor && !busy ? fetchPage(snapshot.nextCursor) : Promise.resolve(),
  };
}
