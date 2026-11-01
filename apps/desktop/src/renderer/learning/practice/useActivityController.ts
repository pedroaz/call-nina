import { type CallNinaError, type DesktopIpcResponse } from "@call-nina/contracts";
import { materializeContentExercises } from "@call-nina/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
} from "../../runtime/ipc.js";
import { useLearningOperation } from "../operations/useLearningOperation.js";
import type { ActivityHostProps } from "./activity-types.js";

export function useActivityController({
  activityId,
  activityBreadcrumbs,
  activityTitle,
  parentLabel,
  onResults,
  onNina,
  onReviewVocabulary,
  courseCompletionActions,
  onCloseActivity,
  onVocabulary,
  onOpenActivity,
  requestAiAccess,
  autoStart = false,
}: ActivityHostProps) {
  const { t } = useTranslation();
  const [generatedResult, setGenerated] =
    useState<
      Extract<DesktopIpcResponse, { status: "ok"; channel: "prepared-activity/read" }>["result"]
    >();
  const [error, setError] = useState<CallNinaError>();
  const launchIds = useRef({
    resume: createDesktopSubmissionId(),
    newAttempt: createDesktopSubmissionId(),
  });
  const [startedAttemptIds, setStartedAttemptIds] =
    useState<
      Extract<
        DesktopIpcResponse,
        { status: "ok"; channel: "exercise-set/start" }
      >["result"]["attemptIds"]
    >();
  const feedback = useLearningOperation();
  const [deleting, setDeleting] = useState(false);
  const [prepared, setPrepared] =
    useState<
      Extract<DesktopIpcResponse, { status: "ok"; channel: "activity/resolve" }>["result"]
    >();
  const generated = prepared?.activity.activityId === activityId ? generatedResult : undefined;
  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    const timer = window.setTimeout(() => {
      setPrepared(undefined);
      setGenerated(undefined);
      setStartedAttemptIds(undefined);
      launchIds.current = {
        resume: createDesktopSubmissionId(),
        newAttempt: createDesktopSubmissionId(),
      };
      setError(undefined);
      if (!activityId) return;
      window.scrollTo(0, 0);
      void invokeDesktop("activity/resolve", { action: "open-activity", activityId })
        .then(async (result) => {
          if (!current) return;
          if (result.destination === "generated-exercises") {
            const loaded = await invokeDesktop("prepared-activity/read", { activityId });
            if (!isCurrent()) return;
            const opened = await invokeDesktop("activity/resolve", {
              action: "open-activity",
              activityId,
              expectedGeneration: result.rootGeneration,
            });
            if (isCurrent()) {
              setPrepared(opened);
              setGenerated(loaded);
            }
          } else {
            const opened = await invokeDesktop("activity/resolve", {
              action: "open-activity",
              activityId,
              expectedGeneration: result.rootGeneration,
            });
            if (isCurrent()) setPrepared(opened);
          }
        })
        .catch((cause: unknown) => {
          if (current) setError(normalizeDesktopError(cause).detail);
        });
    }, 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [activityId]);
  useEffect(() => {
    if (!activityId || prepared?.activity.activityId !== activityId) return;
    // This effect runs after the resolved activity has committed to the view.
    // Loading and reuse probes must never advance Continue's last-used marker.
    let current = true;
    void invokeDesktop("activity/resolve", {
      action: "open-activity",
      activityId,
      expectedGeneration: prepared.rootGeneration,
      recordUse: true,
    }).catch((cause: unknown) => {
      if (current) setError(normalizeDesktopError(cause).detail);
    });
    return () => {
      current = false;
    };
  }, [activityId, prepared]);
  const exercises = useMemo(
    () =>
      generated
        ? materializeContentExercises(generated.content, {
            exerciseIds: generated.content.payload.exercises.map(
              (_, position) => `exercise_${String(position).padStart(16, "0")}`,
            ),
            aiProvenance: {
              source: "ai",
              producer: "desktop-app-server",
              modelRequestId: generated.provenance.modelRequestId,
              generatedAt: generated.provenance.generatedAt,
              modelSelection: {
                availability: "reported",
                modelId: generated.provenance.modelId,
                effortId: generated.provenance.effortId,
              },
            },
            curriculumTopicIds: generated.curriculumTopicIds,
          })
        : [],
    [generated],
  );
  return {
    activityId,
    prepared,
    activityBreadcrumbs,
    activityTitle,
    parentLabel,
    t,
    onResults,
    onNina,
    onReviewVocabulary,
    courseCompletionActions,
    onCloseActivity,
    onVocabulary,
    onOpenActivity,
    requestAiAccess,
    setDeleting,
    setError,
    generated,
    deleting,
    error,
    autoStart,
    feedback,
    exercises,
    launchIds,
    setStartedAttemptIds,
    startedAttemptIds,
  };
}
