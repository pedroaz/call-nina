import type { PracticeSource } from "@call-nina/contracts";
import { useMemo, useReducer } from "react";
import type { PracticeLaunch } from "../learning/practice/usePracticeSuggestion.js";
import type { HistoryPracticeSeed } from "../learning/results/SavedResults.js";
import type { SavedResultsScope } from "../learning/results/savedResultsTypes.js";
import type { NavigationTarget, PreparedActivityId, WorkspacePage } from "./App.types.js";
import { initialNavigation, navigationReducer, type NavigationState } from "./navigation-state.js";

export function useWorkspaceNavigation(initialPage: WorkspacePage) {
  const [state, dispatch] = useReducer(navigationReducer, initialPage, initialNavigation);
  const navigation = useMemo(
    () => ({
      apply: (target: WorkspacePage | NavigationTarget) => {
        dispatch({ type: "navigate", target });
      },
      returnTo: (destination: WorkspacePage) => {
        dispatch({ type: "return", destination });
      },
      launch: (intent: PracticeLaunch) => {
        dispatch({ type: "launch", intent });
      },
      externalActivity: (activityId: PreparedActivityId) => {
        dispatch({ type: "externalActivity", activityId });
      },
      results: (scope?: SavedResultsScope, origin?: "learningPath" | "vocabulary") => {
        dispatch({ type: "results", ...(scope ? { scope } : {}), ...(origin ? { origin } : {}) });
      },
      returnFromResults: () => {
        dispatch({ type: "returnFromResults" });
      },
      practiceAgain: (seed: HistoryPracticeSeed) => {
        dispatch({ type: "practiceAgain", seed });
      },
      openActivity: (activityId: PreparedActivityId) => {
        dispatch({ type: "openActivity", activityId });
      },
      closeActivity: () => {
        dispatch({ type: "closeActivity" });
      },
      write: (source?: PracticeSource) => {
        dispatch({ type: "write", ...(source ? { source } : {}) });
      },
      uploadPractice: (source: PracticeSource) => {
        dispatch({ type: "uploadPractice", source });
      },
      vocabularyActivity: (activityId: PreparedActivityId) => {
        dispatch({ type: "vocabularyActivity", activityId });
      },
      viewVocabulary: (selection: NavigationState["vocabularySelection"]) => {
        dispatch({ type: "viewVocabulary", selection });
      },
      setSettingsTab: (tab: string) => {
        dispatch({ type: "settingsTab", tab });
      },
      setPracticeTab: (tab: NavigationState["practiceTab"]) => {
        dispatch({ type: "practiceTab", tab });
      },
      setPendingNavigation: (value: NavigationState["pendingNavigation"]) => {
        dispatch({ type: "pending", value });
      },
      clearLearning: () => {
        dispatch({ type: "learningCleared" });
      },
      languageChanged: () => {
        dispatch({ type: "languageChanged" });
      },
    }),
    [],
  );
  return { ...state, navigation };
}
