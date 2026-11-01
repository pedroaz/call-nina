import type { Language, PracticeSource } from "@call-nina/contracts";
import type { PracticeLaunch } from "../learning/practice/usePracticeSuggestion.js";
import type { HistoryPracticeSeed } from "../learning/results/SavedResults.js";
import type { SavedResultsScope } from "../learning/results/savedResultsTypes.js";
import type { NavigationTarget, PreparedActivityId, WorkspacePage } from "./App.types.js";

export interface NavigationState {
  resultsRequest:
    | {
        scope?: SavedResultsScope;
        requestId: number;
      }
    | undefined;
  page: WorkspacePage;
  resultsOrigin: "learningPath" | "vocabulary" | undefined;
  writingOrigin: WorkspacePage;
  activityOrigin: WorkspacePage | undefined;
  settingsTab: string;
  pendingNavigation:
    | { destination: WorkspacePage; mode: "normal" }
    | { destination: WorkspacePage; mode: "return" }
    | { destination: "practice"; mode: "externalActivity"; activityId: PreparedActivityId }
    | undefined;
  writingSeed: Extract<HistoryPracticeSeed, { kind: "writing" }> | undefined;
  preparedActivityId: PreparedActivityId | undefined;
  uploadPracticeSource: PracticeSource;
  writingPracticeSource: PracticeSource;
  suggestedWriting: string | undefined;
  practiceTab: "new" | "saved";
  practiceSeed: Extract<PracticeLaunch, { destination: "preparation" }> | undefined;
  practiceReturnRequest: number;
  vocabularyDue: boolean;
  vocabularySelection:
    | {
        activityId: string;
        language: Language;
      }
    | undefined;
  vocabularyViewRequest: number;
  quickStartId: PreparedActivityId | undefined;
}

export type NavigationAction =
  | { type: "navigate"; target: WorkspacePage | NavigationTarget }
  | { type: "return"; destination: WorkspacePage }
  | { type: "launch"; intent: PracticeLaunch }
  | { type: "externalActivity"; activityId: PreparedActivityId }
  | { type: "results"; scope?: SavedResultsScope; origin?: "learningPath" | "vocabulary" }
  | { type: "returnFromResults" }
  | { type: "practiceAgain"; seed: HistoryPracticeSeed }
  | { type: "openActivity"; activityId: PreparedActivityId }
  | { type: "closeActivity" }
  | { type: "write"; source?: PracticeSource }
  | { type: "uploadPractice"; source: PracticeSource }
  | { type: "vocabularyActivity"; activityId: PreparedActivityId }
  | { type: "viewVocabulary"; selection: NavigationState["vocabularySelection"] }
  | { type: "settingsTab"; tab: string }
  | { type: "practiceTab"; tab: NavigationState["practiceTab"] }
  | { type: "pending"; value: NavigationState["pendingNavigation"] }
  | { type: "learningCleared" }
  | { type: "languageChanged" };

export function initialNavigation(page: WorkspacePage): NavigationState {
  return {
    resultsRequest: undefined,
    page,
    resultsOrigin: undefined,
    writingOrigin: "practice",
    activityOrigin: undefined,
    settingsTab: "profile",
    pendingNavigation: undefined,
    writingSeed: undefined,
    preparedActivityId: undefined,
    uploadPracticeSource: { kind: "adaptive" },
    writingPracticeSource: { kind: "adaptive" },
    suggestedWriting: undefined,
    practiceTab: "new",
    practiceSeed: undefined,
    practiceReturnRequest: 0,
    vocabularyDue: false,
    vocabularySelection: undefined,
    vocabularyViewRequest: 0,
    quickStartId: undefined,
  };
}

function navigate(
  state: NavigationState,
  target: WorkspacePage | NavigationTarget,
): NavigationState {
  const destination = typeof target === "string" ? target : target.destination;
  const next = { ...state, page: destination, resultsOrigin: undefined };
  if (destination === "writing" && state.page !== "writing") {
    next.writingPracticeSource = { kind: "adaptive" };
    next.writingOrigin = state.page;
    next.writingSeed = undefined;
    next.suggestedWriting = undefined;
  }
  if (destination === "practice") {
    next.preparedActivityId = undefined;
    next.practiceSeed = undefined;
    next.activityOrigin = undefined;
  }
  if (destination === "vocabulary") next.vocabularyDue = false;
  if (typeof target !== "string") {
    if (target.destination === "practice") {
      next.practiceTab = target.tab ?? "new";
      next.practiceSeed = target.seed;
    }
    if (target.destination === "settings" && target.tab) next.settingsTab = target.tab;
  }
  return next;
}

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  switch (action.type) {
    case "navigate":
      return navigate(state, action.target);
    case "return":
      return {
        ...state,
        page: action.destination,
        practiceReturnRequest:
          state.practiceReturnRequest +
          Number(state.page === "writing" && action.destination === "practice"),
      };
    case "launch": {
      const intent = action.intent;
      const next = {
        ...state,
        uploadPracticeSource: { kind: "adaptive" } as const,
        writingPracticeSource: { kind: "adaptive" } as const,
        quickStartId:
          intent.destination === "activity" && intent.autoStart ? intent.activityId : undefined,
      };
      if (intent.destination === "writing")
        return {
          ...next,
          page: "writing",
          writingOrigin: state.page,
          writingSeed: undefined,
          suggestedWriting: intent.prompt,
        };
      if (intent.destination === "vocabulary")
        return { ...next, page: "vocabulary", vocabularyDue: true };
      const prepared =
        intent.destination === "preparation"
          ? navigate(next, { destination: "practice", tab: "new", seed: intent })
          : next;
      return {
        ...prepared,
        page: "practice",
        activityOrigin: state.page,
        preparedActivityId: intent.destination === "activity" ? intent.activityId : undefined,
        practiceSeed: intent.destination === "preparation" ? intent : undefined,
      };
    }
    case "externalActivity":
      return {
        ...state,
        practiceSeed: undefined,
        preparedActivityId: action.activityId,
        activityOrigin: undefined,
        page: "practice",
      };
    case "results":
      return {
        ...state,
        resultsOrigin: action.origin,
        preparedActivityId: undefined,
        practiceSeed: undefined,
        activityOrigin: undefined,
        practiceTab: "saved",
        page: "practice",
        resultsRequest: {
          ...(action.scope ? { scope: action.scope } : {}),
          requestId: (state.resultsRequest?.requestId ?? 0) + 1,
        },
      };
    case "returnFromResults":
      return { ...state, page: state.resultsOrigin ?? state.page, resultsOrigin: undefined };
    case "practiceAgain":
      return action.seed.kind === "exercise"
        ? {
            ...state,
            activityOrigin: "practice",
            practiceSeed: undefined,
            preparedActivityId: action.seed.activityId as PreparedActivityId,
          }
        : {
            ...state,
            writingPracticeSource: { kind: "adaptive" },
            writingOrigin: "practice",
            writingSeed: action.seed,
            page: "writing",
          };
    case "openActivity":
      return { ...state, preparedActivityId: action.activityId };
    case "closeActivity":
      return {
        ...state,
        preparedActivityId: undefined,
        ...(state.activityOrigin && state.activityOrigin !== "practice"
          ? { page: state.activityOrigin, activityOrigin: undefined }
          : {}),
      };
    case "write":
      return {
        ...navigate(state, "writing"),
        writingPracticeSource: action.source ?? { kind: "adaptive" },
      };
    case "uploadPractice":
      return { ...state, uploadPracticeSource: action.source, practiceTab: "new" };
    case "vocabularyActivity":
      return {
        ...state,
        activityOrigin: "vocabulary",
        preparedActivityId: action.activityId,
        practiceSeed: undefined,
        page: "practice",
      };
    case "viewVocabulary":
      return {
        ...state,
        vocabularySelection: action.selection,
        vocabularyDue: false,
        vocabularyViewRequest: state.vocabularyViewRequest + 1,
      };
    case "settingsTab":
      return { ...state, settingsTab: action.tab };
    case "practiceTab":
      return { ...state, practiceTab: action.tab };
    case "pending":
      return { ...state, pendingNavigation: action.value };
    case "learningCleared":
      return {
        ...state,
        writingSeed: undefined,
        suggestedWriting: undefined,
        practiceSeed: undefined,
        preparedActivityId: undefined,
      };
    case "languageChanged":
      return { ...state, resultsRequest: undefined, resultsOrigin: undefined, page: "nina" };
  }
}
