import { useOperationProgress } from "./useOperationProgress.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  generationDeadlineMilliseconds,
  errorDefinitions,
  callNinaErrorSchema,
  type DesktopIpcEvent,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type ErrorKind,
} from "@call-nina/contracts";
import {
  createDesktopSubmissionId,
  DesktopOperationError,
  invokeDesktop,
  subscribeDesktop,
} from "./ipc.js";

type Input = Extract<
  DesktopIpcRequest,
  { channel: "learning-operation/start" }
>["payload"]["input"];
type Finished = Extract<DesktopIpcEvent, { event: "learning-operation-finished" }>;
type Result =
  | Extract<Finished["outcome"], { status: "validated" }>
  | (Extract<
      Extract<DesktopIpcResponse, { status: "ok"; channel: "learning-operation/start" }>["result"],
      { status: "retained-feedback" }
    > & { activityId?: never });

function operationError(kind: ErrorKind, correlationId: string) {
  const definition = errorDefinitions[kind];
  return new DesktopOperationError(
    callNinaErrorSchema.parse({
      schemaVersion: 1,
      kind,
      ...definition,
      reference: { code: definition.code, correlationId, occurredAt: new Date().toISOString() },
    }),
  );
}

export function runLearningOperation(
  input: Input,
  signal: AbortSignal,
  onSubmission?: (id: ReturnType<typeof createDesktopSubmissionId>, kind: Input["kind"]) => void,
): Promise<Result> {
  const submissionId = createDesktopSubmissionId();
  onSubmission?.(submissionId, input.kind);
  if (signal.aborted) return Promise.reject(operationError("cancellation", submissionId));
  return new Promise((resolve, reject) => {
    let operationId: ReturnType<typeof createDesktopSubmissionId> | undefined;
    let settled = false;
    let cancellationRequested = false;
    const cancelBackend = () => {
      cancellationRequested = true;
      if (operationId) {
        void invokeDesktop("learning-operation/cancel", { operationId }).catch(() => undefined);
      }
    };
    const cleanup = () => {
      settled = true;
      unsubscribe();
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      if (settled) return;
      cancelBackend();
      cleanup();
      reject(operationError("cancellation", submissionId));
    };
    const unsubscribe = subscribeDesktop((event) => {
      if (
        settled ||
        event.event !== "learning-operation-finished" ||
        event.kind !== input.kind ||
        event.submissionId !== submissionId
      )
        return;
      cleanup();
      const outcome = event.outcome;
      if (outcome.status === "validated") resolve(outcome);
      else if (outcome.status === "failed") reject(new DesktopOperationError(outcome.error));
      else
        reject(
          operationError(
            outcome.status === "cancelled" ? "cancellation" : "rate-limit",
            submissionId,
          ),
        );
    });
    // Allow time for startup and dispatch in addition to the bounded model turn.
    const timeout = window.setTimeout(() => {
      if (settled) return;
      cancelBackend();
      cleanup();
      reject(operationError("ai-timeout", operationId ?? submissionId));
    }, generationDeadlineMilliseconds[input.kind] + 30_000);
    signal.addEventListener("abort", abort, { once: true });
    void invokeDesktop("learning-operation/start", { submissionId, input })
      .then((accepted) => {
        operationId = accepted.operationId;
        if (!settled && accepted.status === "retained-feedback") {
          cleanup();
          resolve(accepted);
          return;
        }
        // Cancellation can arrive before the start acknowledgement.
        if (cancellationRequested) cancelBackend();
      })
      .catch((cause: unknown) => {
        if (settled) return;
        cleanup();
        reject(cause instanceof Error ? cause : new Error("OD_OPERATION_FAILED", { cause }));
      });
  });
}

export function useLearningOperation() {
  const { progress, begin, clear } = useOperationProgress();
  const mounted = useRef(true);
  const active = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = undefined;
    };
  }, []);
  const run = useCallback(
    async (input: Input) => {
      if (!mounted.current) throw operationError("cancellation", createDesktopSubmissionId());
      if (active.current) throw operationError("conflict", createDesktopSubmissionId());
      const controller = new AbortController();
      active.current = controller;
      setBusy(true);
      try {
        const result = await runLearningOperation(input, controller.signal, begin);
        if (controller.signal.aborted)
          throw operationError("cancellation", createDesktopSubmissionId());
        return result;
      } finally {
        if (active.current === controller) {
          active.current = undefined;
          setBusy(false);
          clear();
        }
      }
    },
    [begin, clear],
  );
  const cancel = useCallback(() => active.current?.abort(), []);
  return { run, cancel, busy, progress };
}
