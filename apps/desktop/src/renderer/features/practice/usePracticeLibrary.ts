import type { CallNinaError } from "@call-nina/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import type { SavedResultsScope } from "../../learning/results/savedResultsTypes.js";
import { reusePracticeActivity } from "../../learning/practice/generatePracticeActivity.js";
import { useActivityLibrary } from "../../learning/practice/useActivityLibrary.js";
import type {
  PreparedActivity,
  PreparedActivityId,
} from "../../learning/practice/activity-types.js";
import type { PracticeLibraryFilter, PracticePageProps } from "./PracticePage.types.js";

export function usePracticeLibrary({
  activityId,
  selectedTab,
  onTabChange,
  resultsRequest,
  onReturnToSource,
  resultsReturnLabel,
  onPracticeAgain,
  requestAiAccess,
  onOpenActivity,
  onWriting,
}: PracticePageProps) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [localLibraryView, setLocalLibraryView] = useState(Boolean(resultsRequest));
  const libraryView = selectedTab ? selectedTab === "saved" : localLibraryView;
  const setLibraryView = (saved: boolean) => {
    setLocalLibraryView(saved);
    onTabChange?.(saved ? "saved" : "new");
  };
  const returnPositionRef = useRef<{ y: number; id: string } | undefined>(undefined);
  const openSavedActivity = async (id: PreparedActivityId) => {
    returnPositionRef.current = { y: window.scrollY, id };
    try {
      const source = await invokeDesktop("activity/resolve", {
        action: "open-activity",
        activityId: id,
      });
      if (source.destination === "generated-exercises" && source.activity.context.learningPath) {
        const content = await invokeDesktop("prepared-activity/read", { activityId: id });
        onOpenActivity(
          await reusePracticeActivity({
            activityId: id,
            content: content.content,
            context: { origin: "free-practice" },
            expectedGeneration: source.rootGeneration,
          }),
        );
      } else onOpenActivity(id);
    } catch (cause) {
      setLibraryMutationError(normalizeDesktopError(cause).detail);
    }
  };
  const [savedView, setSavedView] = useState<"activities" | "results">(
    resultsRequest ? "results" : "activities",
  );
  const [resultsScope, setResultsScope] = useState<SavedResultsScope | undefined>(
    resultsRequest?.scope,
  );
  const [librarySearch, setLibrarySearch] = useState("");
  const [previousResultsRequest, setPreviousResultsRequest] = useState(resultsRequest);
  if (resultsRequest !== previousResultsRequest) {
    setPreviousResultsRequest(resultsRequest);
    if (resultsRequest) {
      setSavedView("results");
      setResultsScope(resultsRequest.scope);
      setLocalLibraryView(true);
    }
  }
  useEffect(() => {
    if (resultsRequest) onTabChange?.("saved");
  }, [resultsRequest, onTabChange]);
  const [libraryFilter, setLibraryFilter] = useState<PracticeLibraryFilter>("all");
  const library = useActivityLibrary(
    libraryFilter === "all"
      ? [
          "flashcards",
          "grammar",
          "custom-lesson",
          "reading",
          "writing",
          "vocabulary-review",
          "placement",
          "codex-listening",
          "voice-speaking",
        ]
      : [libraryFilter],
    true,
    undefined,
    librarySearch,
  );
  const preparedActivities = library.entries;
  const libraryBusy = library.busy;
  const [libraryMutationError, setLibraryMutationError] = useState<CallNinaError>();
  const libraryError = libraryMutationError ?? library.error;
  useEffect(() => {
    if (!activityId && !libraryBusy && returnPositionRef.current) {
      const position = returnPositionRef.current;
      const frame = window.requestAnimationFrame(() => {
        window.scrollTo(0, position.y);
        document.getElementById(`activity-open-${position.id}`)?.focus({ preventScroll: true });
        returnPositionRef.current = undefined;
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [activityId, libraryBusy, preparedActivities.length]);
  const filteredActivities = preparedActivities;
  const deletePreparedActivity = async (activityToDelete: PreparedActivity) => {
    setLibraryMutationError(undefined);
    setDeleting(true);
    try {
      await invokeDesktop("prepared-activity/delete", { activityId: activityToDelete.activityId });
      await library.refresh();
    } catch (cause: unknown) {
      setLibraryMutationError(normalizeDesktopError(cause).detail);
    } finally {
      setDeleting(false);
    }
  };
  return {
    t,
    libraryView,
    setLibraryView,
    libraryBusy,
    library,
    libraryError,
    onReturnToSource,
    resultsReturnLabel,
    savedView,
    setSavedView,
    librarySearch,
    setLibrarySearch,
    libraryFilter,
    setLibraryFilter,
    preparedActivities,
    libraryMutationError,
    deleting,
    filteredActivities,
    setResultsScope,
    deletePreparedActivity,
    openSavedActivity,
    resultsScope,
    returnPositionRef,
    onPracticeAgain,
    requestAiAccess,
    onOpenActivity,
    onWriting,
  };
}
