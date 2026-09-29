import {
  type ProviderOperation,
  errorDefinitions,
  callNinaErrorSchema,
  type ActivityId,
  type CallNinaError,
  type PracticeSuggestion,
} from "@call-nina/contracts";
import { useEffect, useRef, useState } from "react";
import {
  createDesktopSubmissionId,
  DesktopOperationError,
  invokeDesktop,
  normalizeDesktopError,
} from "./ipc.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { generatePracticeActivity } from "./generatePracticeActivity.js";

export type PracticeLaunch =
  | { destination: "activity"; activityId: ActivityId }
  | { destination: "writing"; prompt: string }
  | { destination: "vocabulary" }
  | { destination: "preparation"; kind: "listening" | "speaking"; prompt: string };

export type SuggestionActions = {
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onLaunch: (intent: PracticeLaunch) => void;
};

export function usePracticeSuggestion({ requestAiAccess, onLaunch }: SuggestionActions) {
  const operation = useLearningOperation();
  const active = useRef(false);
  const mounted = useRef(true);
  const [starting, setStarting] = useState<string>();
  const [error, setError] = useState<CallNinaError>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isMounted = () => mounted.current;
  const start = async (suggestion: PracticeSuggestion) => {
    if (active.current) return;
    active.current = true;
    setStarting(suggestion.id);
    setError(undefined);
    try {
      const root = await invokeDesktop("data-root/read", {});
      if (!mounted.current) return;
      if (root.status !== "ready" || root.generation !== suggestion.rootGeneration) {
        const definition = errorDefinitions["stale-data-root"];
        throw new DesktopOperationError(
          callNinaErrorSchema.parse({
            schemaVersion: 1,
            kind: "stale-data-root",
            ...definition,
            reference: {
              code: definition.code,
              correlationId: createDesktopSubmissionId(),
              occurredAt: new Date().toISOString(),
            },
          }),
        );
      }
      if (suggestion.kind === "writing") {
        onLaunch({ destination: "writing", prompt: suggestion.naturalRequest });
      } else if (suggestion.source === "due-vocabulary") {
        onLaunch({ destination: "vocabulary" });
      } else if (["codex-listening", "voice-speaking"].includes(suggestion.kind)) {
        onLaunch({
          destination: "preparation",
          kind: suggestion.kind === "codex-listening" ? "listening" : "speaking",
          prompt: suggestion.naturalRequest,
        });
      } else {
        if (!(await requestAiAccess("exercise-generation")) || !isMounted()) return;
        const activityId = await generatePracticeActivity(
          { source: "suggestion", suggestion },
          operation.run,
        );
        if (isMounted()) onLaunch({ destination: "activity", activityId });
      }
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      active.current = false;
      if (mounted.current) setStarting(undefined);
    }
  };
  return {
    start,
    starting,
    error,
    cancel: operation.cancel,
    generating: operation.busy,
    progress: operation.progress,
  };
}
