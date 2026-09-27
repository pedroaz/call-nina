import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopIpcEvent } from "@call-nina/contracts";
import { subscribeDesktop } from "./ipc.js";

type ProgressEvent = Extract<DesktopIpcEvent, { event: "learning-operation-progress" }>;
export type OperationProgressState = Pick<
  ProgressEvent,
  "stage" | "attempt" | "kind" | "submissionId"
> & { startedAt: number };

export function useOperationProgress() {
  const active = useRef<OperationProgressState | undefined>(undefined);
  const [progress, setProgress] = useState<OperationProgressState>();
  const begin = useCallback(
    (submissionId: ProgressEvent["submissionId"], kind: ProgressEvent["kind"]) => {
      const next: OperationProgressState = {
        submissionId,
        kind,
        stage: "queued",
        attempt: 1,
        startedAt: performance.now(),
      };
      active.current = next;
      setProgress(next);
    },
    [],
  );
  const clear = useCallback(() => {
    active.current = undefined;
    setProgress(undefined);
  }, []);
  useEffect(
    () =>
      subscribeDesktop((event) => {
        const current = active.current;
        if (
          !current ||
          (event.event !== "learning-operation-progress" &&
            event.event !== "learning-operation-finished") ||
          event.submissionId !== current.submissionId ||
          event.kind !== current.kind
        )
          return;
        if (event.event === "learning-operation-finished") clear();
        else {
          const next = {
            ...current,
            stage: event.stage,
            attempt: Math.max(current.attempt, event.attempt) as 1 | 2,
          };
          active.current = next;
          setProgress(next);
        }
      }),
    [clear],
  );
  return { progress, begin, clear };
}
