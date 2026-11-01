import {
  type CallNinaError,
  type DataRootGeneration,
  type DesktopIpcRequest,
  type Language,
  type LearningScope,
  type ProviderAccess,
  type ProviderOperation,
} from "@call-nina/contracts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDetailNavigation } from "../components/ui/index.js";
import { type NinaHomeDraft } from "../features/home/index.js";
import { useHelperSelection } from "../learning/helper/useHelperSelection.js";
import { type PracticeLaunch } from "../learning/practice/usePracticeSuggestion.js";
import { type SavedResultsScope } from "../learning/results/savedResultsTypes.js";
import { stopSpeech } from "../learning/speech/SpeechButton.js";
import { refreshSpeechAvailability } from "../learning/speech/speechPlayback.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "../runtime/ipc.js";
import {
  type DesktopWorkspaceProps,
  type NavigationTarget,
  type WorkspacePage,
} from "./App.types.js";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation.js";

export function useDesktopWorkspaceController({
  readiness,
  reload,
  onRunSetup,
  initialPage,
  initialPath,
}: DesktopWorkspaceProps) {
  const {
    resultsRequest,
    page,
    resultsOrigin,
    writingOrigin,
    activityOrigin,
    settingsTab,
    pendingNavigation,
    writingSeed,
    preparedActivityId,
    uploadPracticeSource,
    writingPracticeSource,
    suggestedWriting,
    practiceTab,
    practiceSeed,
    practiceReturnRequest,
    vocabularyDue,
    vocabularySelection,
    vocabularyViewRequest,
    quickStartId,
    navigation,
  } = useWorkspaceNavigation(initialPage);
  const { setSettingsTab, setPracticeTab, setPendingNavigation } = navigation;
  const { t } = useTranslation();

  useEffect(() => {
    stopSpeech();
  }, [page]);

  const pathHistory = useDetailNavigation<"results">();

  const [learningScope, setLearningScope] = useState<LearningScope>();
  const audioRoot = readiness.dataRoot.status === "ready" ? readiness.dataRoot.generation : null;
  useEffect(() => {
    stopSpeech();
    refreshSpeechAvailability();
  }, [audioRoot, learningScope?.learnerId, learningScope?.targetLanguage]);
  const [ninaDrafts, setNinaDrafts] = useState<Record<string, NinaHomeDraft>>({});
  const ninaScopeKey = JSON.stringify(learningScope ?? null);
  const [switchingLanguage, setSwitchingLanguage] = useState(false);
  const [practiceLanguageBlocked, setPracticeLanguageBlocked] = useState(false);
  const [vocabularyLanguageBlocked, setVocabularyLanguageBlocked] = useState(false);
  const [pathLanguageBlocked, setPathLanguageBlocked] = useState(false);
  const languageSwitchBlocked =
    page === "writing" ||
    page === "settings" ||
    (page === "practice" && practiceLanguageBlocked) ||
    (page === "vocabulary" && vocabularyLanguageBlocked) ||
    (page === "learningPath" && pathLanguageBlocked);
  const refreshScope = useCallback(async () => {
    const settings = await invokeDesktop("learner-settings/read", {});
    setLearningScope(settings.settings.learningScope);
  }, []);
  const selectTarget = async (targetLanguage: Language) => {
    if (
      switchingLanguage ||
      languageSwitchBlocked ||
      !learningScope ||
      targetLanguage === learningScope.targetLanguage
    )
      return;
    setSwitchingLanguage(true);
    setOperationError(undefined);
    try {
      const current = await invokeDesktop("learner-settings/read", {});
      const next = await invokeDesktop("learner-settings/select-language", {
        expectedGeneration: current.dataRoot.generation,
        targetLanguage,
      });
      setLearningScope(next.settings.learningScope);
      pathHistory.back();
      navigation.languageChanged();
    } catch (cause) {
      setOperationError(normalizeDesktopError(cause).detail);
    } finally {
      setSwitchingLanguage(false);
    }
  };
  const savedResultsScrollRef = useRef<number | undefined>(undefined);
  const [navPreference, setNavPreference] = useState<boolean>();
  useEffect(() => {
    const y = page === "practice" ? (savedResultsScrollRef.current ?? 0) : 0;
    window.scrollTo(0, y);
    if (page === "practice") savedResultsScrollRef.current = undefined;
  }, [page]);
  const [wideHelper, setWideHelper] = useState(
    () => window.matchMedia("(min-width: 80.01rem)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 80.01rem)");
    const update = () => {
      setWideHelper(media.matches);
    };
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  const navCollapsed = navPreference ?? !wideHelper;
  const [helperPreference, setHelperPreference] = useState<boolean>();
  const helperOpen = helperPreference ?? (page === "writing" && wideHelper);
  const [reminderOpen, setReminderOpen] = useState(false);
  const disclosure = useRef<Array<(value: boolean) => void>>([]);
  useEffect(
    () => () => {
      for (const resolve of disclosure.current.splice(0)) resolve(false);
    },
    [],
  );
  const [providerUnavailable, setProviderUnavailable] =
    useState<Extract<ProviderAccess, { status: "unavailable" }>>();
  const [operationError, setOperationError] = useState<CallNinaError>();
  const [resetNotice, setResetNotice] = useState(false);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshScope().catch((cause: unknown) => {
        setOperationError(normalizeDesktopError(cause).detail);
      });
    }, 0);
    return () => {
      window.clearTimeout(initialLoad);
    };
  }, [refreshScope]);
  useEffect(() => {
    void invokeDesktop("development-notice/read", {})
      .then((result) => {
        setResetNotice(result.pending);
      })
      .catch((cause: unknown) => {
        setOperationError(normalizeDesktopError(cause).detail);
      });
  }, []);
  const [writingDirty, setWritingDirty] = useState(false);

  const practiceContainer = useRef<HTMLDivElement>(null);

  const focusedPracticeReturn = useRef(0);
  useLayoutEffect(() => {
    if (page !== "practice" || practiceReturnRequest === focusedPracticeReturn.current) return;
    focusedPracticeReturn.current = practiceReturnRequest;
    practiceContainer.current?.querySelector<HTMLHeadingElement>("h1")?.focus({
      preventScroll: true,
    });
  }, [page, practiceReturnRequest]);
  const returnTo = navigation.returnTo;
  const openExternalActivity = navigation.externalActivity;

  const vocabularyActivityId =
    vocabularySelection?.language === learningScope?.targetLanguage
      ? vocabularySelection?.activityId
      : undefined;

  const launchPractice = (intent: PracticeLaunch) => {
    if (intent.destination === "preparation" && pathHistory.view) pathHistory.back();
    navigation.launch(intent);
  };
  const [helperEpoch, setHelperEpoch] = useState(0);
  const [helperSelection, setHelperSelection] = useHelperSelection(helperEpoch);
  useEffect(() => {
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "state-invalidated" &&
        ["account", "ai-connections"].includes(event.scope)
      )
        setProviderUnavailable(undefined);
      if (event.event === "settings-open") {
        if (writingDirty) setPendingNavigation({ destination: "settings", mode: "normal" });
        else {
          if (pathHistory.view) pathHistory.back();
          navigation.apply("settings");
        }
        return;
      }
      if (event.event === "prepared-activity-open") {
        if (writingDirty)
          setPendingNavigation({
            destination: "practice",
            mode: "externalActivity",
            activityId: event.activityId,
          });
        else openExternalActivity(event.activityId);
        return;
      }
      if (event.event === "data-root-changed") {
        void reload();
        return;
      }
      if (
        event.event === "state-invalidated" &&
        ["account", "settings", "ai-connections"].includes(event.scope)
      )
        void reload();
      if (event.event === "state-invalidated" && event.scope === "settings")
        void refreshScope().catch((cause: unknown) => {
          setOperationError(normalizeDesktopError(cause).detail);
        });
    });
    window.callNina.workspaceReady(true);
    return () => {
      window.callNina.workspaceReady(false);
      unsubscribe();
    };
  }, [
    reload,
    refreshScope,
    writingDirty,
    setPendingNavigation,
    openExternalActivity,
    navigation,
    pathHistory,
  ]);
  const openAi = async (
    operation: ProviderOperation,
    previousOperationId?: DesktopIpcRequest["requestId"],
    hasImage = false,
  ) => {
    setOperationError(undefined);
    setProviderUnavailable(undefined);
    try {
      const access = await invokeDesktop("provider/access/read", {
        operation,
        hasImage,
        ...(previousOperationId ? { previousOperationId } : {}),
      });
      if (access.status === "unavailable") {
        setProviderUnavailable(access);
        return false;
      }
      const privacy = await invokeDesktop("privacy/ai-disclosure/read", {});
      if (!privacy.acknowledged) {
        if (disclosure.current.length > 0) return false;
        setReminderOpen(true);
        return await new Promise<boolean>((resolve) => disclosure.current.push(resolve));
      }
      return true;
    } catch (cause) {
      setOperationError(normalizeDesktopError(cause).detail);
      return false;
    }
  };
  const moveNavFocus = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.closest("nav")?.querySelectorAll<HTMLButtonElement>("[data-nav]") ?? [],
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  };
  const applyNavigation = (target: WorkspacePage | NavigationTarget) => {
    if (pathHistory.view) pathHistory.back();
    navigation.apply(target);
  };
  const navigate = (destination: WorkspacePage, mode: "normal" | "return" = "normal") => {
    if (page === "writing" && writingDirty && destination !== "writing") {
      setPendingNavigation({ destination, mode });
      return;
    }
    if (mode === "return") returnTo(destination);
    else applyNavigation(destination);
  };
  const openProviderSettings = () => {
    setSettingsTab("ai");
    navigate("settings");
  };

  const openSavedResults = (scope?: SavedResultsScope, origin?: "learningPath" | "vocabulary") => {
    navigation.results(scope, origin);
  };
  const openCompletionPage = async (
    destination: "results" | "nina" | "vocabulary",
    language: Language,
    rootGeneration: DataRootGeneration,
  ) => {
    try {
      const current = await invokeDesktop("learner-settings/read", {});
      if (current.dataRoot.generation !== rootGeneration) throw new Error("OD_DATA_ROOT_STALE");
      if (current.settings.learningScope.targetLanguage !== language) {
        const next = await invokeDesktop("learner-settings/select-language", {
          expectedGeneration: rootGeneration,
          targetLanguage: language,
        });
        setLearningScope(next.settings.learningScope);
      }
      if (destination === "results") openSavedResults();
      else {
        navigate(destination);
      }
    } catch (cause) {
      setOperationError(normalizeDesktopError(cause).detail);
    }
  };
  const parent =
    page === "writing"
      ? {
          label: t(`nav.${writingOrigin}`),
          onPress: () => {
            navigate(writingOrigin, "return");
          },
        }
      : page === "personalData"
        ? {
            label: t("nav.settings"),
            onPress: () => {
              navigate("settings");
            },
          }
        : undefined;
  const shellPage =
    page === "writing"
      ? writingOrigin
      : page === "personalData"
        ? "settings"
        : page === "practice" && preparedActivityId
          ? (activityOrigin ?? "practice")
          : page;
  return {
    navigation,
    setSettingsTab,
    setPracticeTab,
    setPendingNavigation,
    openProviderSettings,
    vocabularyActivityId,
    learningScope,
    navigate,
    shellPage,
    t,
    resetNotice,
    setResetNotice,
    setOperationError,
    operationError,
    providerUnavailable,
    setProviderUnavailable,
    page,
    ninaScopeKey,
    ninaDrafts,
    setNinaDrafts,
    openAi,
    launchPractice,
    writingOrigin,
    practiceContainer,
    setPracticeLanguageBlocked,
    resultsRequest,
    resultsOrigin,
    pathHistory,
    savedResultsScrollRef,
    setWritingDirty,
    practiceTab,
    uploadPracticeSource,
    openCompletionPage,
    preparedActivityId,
    quickStartId,
    activityOrigin,
    practiceSeed,
    writingPracticeSource,
    parent,
    writingSeed,
    suggestedWriting,
    setHelperSelection,
    readiness,
    initialPath,
    setPathLanguageBlocked,
    openSavedResults,
    setVocabularyLanguageBlocked,
    vocabularyDue,
    vocabularyViewRequest,
    openExternalActivity,
    setHelperEpoch,
    settingsTab,
    reload,
    onRunSetup,
    refreshScope,
    helperEpoch,
    helperSelection,
    helperOpen,
    navCollapsed,
    switchingLanguage,
    languageSwitchBlocked,
    selectTarget,
    moveNavFocus,
    wideHelper,
    setNavPreference,
    setHelperPreference,
    reminderOpen,
    setReminderOpen,
    disclosure,
    pendingNavigation,
    applyNavigation,
    returnTo,
  };
}
