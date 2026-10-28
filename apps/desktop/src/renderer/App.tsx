import { MobilePage } from "./MobilePage.js";
import { openProviderSettingsEvent } from "./ProviderActionSummary.js";
import { VocabularyLearningNotice } from "./VocabularyLearning.js";
import i18n from "./i18n.js";
import type { PracticeLaunch } from "./usePracticeSuggestion.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type DesktopIpcRequest,
  type ProviderAccess,
  type ProviderOperation,
  type DesktopIpcResponse,
  type CallNinaError,
  languageDefinitions,
  languageCapabilities,
  type LearningScope,
  type Language,
  type DataRootGeneration,
} from "@call-nina/contracts";
import { Smartphone, Gauge, House, Route, LibraryBig, LoaderCircle, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Feedback,
  LoadingState,
  ModalDialog,
  useDetailNavigation,
} from "./components/ui/index.js";
import { ActionGroup, AppShell as ApplicationShell, Page } from "./components/layout/index.js";

import styles from "./Startup.module.css";
import { NinaHome, emptyNinaHomeDraft, type NinaHomeDraft } from "./Dashboard.js";
import { useHelperSelection } from "./useHelperSelection.js";
import { ContextualHelper } from "./ContextualHelper.js";
import { type SavedResultsScope, type HistoryPracticeSeed } from "./SavedResults.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import { ProfileOnboarding } from "./ProfileOnboarding.js";
import { LearningPathPage } from "./LearningPathPage.js";
import { PracticePage } from "./PracticePage.js";
import { PersonalDataPage } from "./PersonalDataPage.js";
import { SettingsPage } from "./SettingsPage.js";
import { LanguageSelect } from "./LanguageSelect.js";
import { SidebarModelControl } from "./SidebarModelControl.js";
import { VocabularyPage } from "./VocabularyPage.js";
import { WritingWorkspace } from "./WritingWorkspace.js";
import {
  FolderOnboarding,
  OperationError,
  StartupError,
  StartupFrame,
  ViewBoundary,
} from "./Startup.js";

type Readiness = Extract<DesktopIpcResponse, { status: "ok"; channel: "app/readiness" }>["result"];
type PreparedActivityId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number]["activityId"];
type Page =
  | "nina"
  | "practice"
  | "writing"
  | "vocabulary"
  | "mobile"
  | "learningPath"
  | "personalData"
  | "settings";

type NavigationTarget =
  | {
      destination: "practice";
      tab?: "new" | "saved";
      seed?: Extract<PracticeLaunch, { destination: "preparation" }>;
    }
  | { destination: "settings"; tab?: "profile" | "ai" | "data" | "diagnostics" }
  | { destination: Exclude<Page, "practice" | "settings"> };

const navigation: ReadonlyArray<{
  page: Page;
  icon: typeof House;
}> = [
  { page: "nina", icon: House },
  { page: "practice", icon: Gauge },
  { page: "learningPath", icon: Route },
  { page: "vocabulary", icon: LibraryBig },
  { page: "mobile", icon: Smartphone },
];

function FirstAiReminder({ close }: { close: (acknowledged: boolean) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const acknowledge = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("privacy/ai-disclosure/acknowledge", {});
      close(true);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalDialog
      isOpen
      title={t("aiReminder.title")}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <p>{t("aiReminder.body")}</p>
      {error && <OperationError error={error} />}
      <ActionGroup align="end">
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={() => {
            close(false);
          }}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          isPending={busy}
          pendingLabel={t("actions.acknowledge")}
          variant="primary"
          onPress={() => void acknowledge()}
        >
          {t("actions.acknowledge")}
        </Button>
      </ActionGroup>
    </ModalDialog>
  );
}

function DesktopWorkspace({
  readiness,
  reload,
  onRunSetup,
  initialPage,
}: {
  readiness: Readiness;
  reload: () => Promise<void>;
  onRunSetup: () => void;
  initialPage: Page;
}) {
  const { t } = useTranslation();
  const [resultsRequest, setResultsRequest] = useState<{
    scope?: SavedResultsScope;
    requestId: number;
  }>();
  const [page, setPage] = useState<Page>(initialPage);
  const [resultsOrigin, setResultsOrigin] = useState<"learningPath" | "vocabulary">();
  const pathHistory = useDetailNavigation<"results">();
  const [writingOrigin, setWritingOrigin] = useState<Page>("practice");
  const [activityOrigin, setActivityOrigin] = useState<Page>();
  const [settingsTab, setSettingsTab] = useState("profile");
  const [learningScope, setLearningScope] = useState<LearningScope>();
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
      setResultsRequest(undefined);
      setResultsOrigin(undefined);
      pathHistory.back();
      setPage("nina");
    } catch (cause) {
      setOperationError(normalizeDesktopError(cause).detail);
    } finally {
      setSwitchingLanguage(false);
    }
  };
  const savedResultsScroll = useRef<number | undefined>(undefined);
  const [navPreference, setNavPreference] = useState<boolean>();
  useEffect(() => {
    const y = page === "practice" ? (savedResultsScroll.current ?? 0) : 0;
    window.scrollTo(0, y);
    if (page === "practice") savedResultsScroll.current = undefined;
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
  const [pendingNavigation, setPendingNavigation] = useState<
    | { destination: Page; mode: "normal" }
    | { destination: Page; mode: "return" }
    | { destination: "practice"; mode: "externalActivity"; activityId: PreparedActivityId }
  >();
  const [writingSeed, setWritingSeed] =
    useState<Extract<HistoryPracticeSeed, { kind: "writing" }>>();
  const [preparedActivityId, setPreparedActivityId] = useState<PreparedActivityId>();
  const [suggestedWriting, setSuggestedWriting] = useState<string>();
  const [practiceTab, setPracticeTab] = useState<"new" | "saved">("new");
  const [practiceSeed, setPracticeSeed] =
    useState<Extract<PracticeLaunch, { destination: "preparation" }>>();
  const practiceContainer = useRef<HTMLDivElement>(null);
  const [practiceReturnRequest, setPracticeReturnRequest] = useState(0);
  const focusedPracticeReturn = useRef(0);
  useLayoutEffect(() => {
    if (page !== "practice" || practiceReturnRequest === focusedPracticeReturn.current) return;
    focusedPracticeReturn.current = practiceReturnRequest;
    practiceContainer.current?.querySelector<HTMLHeadingElement>("h1")?.focus({
      preventScroll: true,
    });
  }, [page, practiceReturnRequest]);
  const returnTo = (destination: Page) => {
    if (page === "writing" && destination === "practice")
      setPracticeReturnRequest((request) => request + 1);
    setPage(destination);
  };
  const openExternalActivity = (activityId: PreparedActivityId) => {
    setPracticeSeed(undefined);
    setPreparedActivityId(activityId);
    setActivityOrigin(undefined);
    setPage("practice");
  };
  const [vocabularyDue, setVocabularyDue] = useState(false);
  const [vocabularyViewRequest, setVocabularyViewRequest] = useState(0);
  const [quickStartId, setQuickStartId] = useState<PreparedActivityId>();
  const launchPractice = (intent: PracticeLaunch) => {
    setQuickStartId(
      intent.destination === "activity" && intent.autoStart ? intent.activityId : undefined,
    );
    if (intent.destination === "writing") {
      setWritingOrigin(page);
      setWritingSeed(undefined);
      setSuggestedWriting(intent.prompt);
      setPage("writing");
    } else if (intent.destination === "vocabulary") {
      setVocabularyDue(true);
      setPage("vocabulary");
    } else {
      if (intent.destination === "preparation")
        applyNavigation({ destination: "practice", tab: "new", seed: intent });
      setActivityOrigin(page);
      setPreparedActivityId(intent.destination === "activity" ? intent.activityId : undefined);
      setPracticeSeed(intent.destination === "preparation" ? intent : undefined);
      setPage("practice");
    }
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
  }, [reload, refreshScope, writingDirty]);

  useEffect(() => {
    const open = () => {
      setSettingsTab("ai");
      navigate("settings");
    };
    window.addEventListener(openProviderSettingsEvent, open);
    return () => window.removeEventListener(openProviderSettingsEvent, open);
  });

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

  const applyNavigation = (target: Page | NavigationTarget) => {
    const destination = typeof target === "string" ? target : target.destination;
    if (pathHistory.view) pathHistory.back();
    setResultsOrigin(undefined);

    if (destination === "writing" && page !== "writing") {
      setWritingOrigin(page);
      setWritingSeed(undefined);
      setSuggestedWriting(undefined);
    }
    if (destination === "practice") {
      setPreparedActivityId(undefined);
      setPracticeSeed(undefined);
      setActivityOrigin(undefined);
    }
    if (destination === "vocabulary") setVocabularyDue(false);
    if (typeof target !== "string") {
      if (target.destination === "practice") {
        setPracticeTab(target.tab ?? "new");
        setPracticeSeed(target.seed);
      }
      if (target.destination === "settings" && target.tab) setSettingsTab(target.tab);
    }
    setPage(destination);
  };
  const navigate = (destination: Page, mode: "normal" | "return" = "normal") => {
    if (page === "writing" && writingDirty && destination !== "writing") {
      setPendingNavigation({ destination, mode });
      return;
    }
    if (mode === "return") returnTo(destination);
    else applyNavigation(destination);
  };
  const openSavedResults = (scope?: SavedResultsScope, origin?: "learningPath" | "vocabulary") => {
    setResultsOrigin(origin);
    setPreparedActivityId(undefined);
    setPracticeSeed(undefined);
    setActivityOrigin(undefined);
    setPracticeTab("saved");
    setResultsRequest((current) => ({
      ...(scope ? { scope } : {}),
      requestId: (current?.requestId ?? 0) + 1,
    }));
    setPage("practice");
  };
  const openCompletionPage = async (
    destination: "results" | "nina",
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
      else navigate(destination);
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

  return (
    <>
      <ApplicationShell
        activePage={shellPage}
        brandName={t("app.name")}
        content={
          <>
            {resetNotice && (
              <Feedback live="polite">
                <p>{t("developmentReset.body")}</p>
                <Button
                  variant="primary"
                  onPress={() => {
                    void invokeDesktop("development-notice/dismiss", {})
                      .then(() => {
                        setResetNotice(false);
                      })
                      .catch((cause: unknown) => {
                        setOperationError(normalizeDesktopError(cause).detail);
                      });
                  }}
                >
                  {t("developmentReset.dismiss")}
                </Button>
              </Feedback>
            )}
            {operationError && <OperationError error={operationError} />}
            {providerUnavailable && (
              <Feedback live="assertive" tone="warning">
                <p>{t(`providerAccess.reasons.${providerUnavailable.reason}`)}</p>
                <p>{t("providerAccess.localAvailable")}</p>
                <ActionGroup>
                  <Button
                    variant="primary"
                    onPress={() => {
                      navigate("settings");
                    }}
                  >
                    {t("nav.settings")}
                  </Button>
                  <Button
                    variant="quiet"
                    onPress={() => {
                      setProviderUnavailable(undefined);
                    }}
                  >
                    {t("providerAccess.dismiss")}
                  </Button>
                </ActionGroup>
              </Feedback>
            )}
            {page === "nina" && learningScope ? (
              <NinaHome
                onLearningPaths={() => navigate("learningPath")}
                key={ninaScopeKey}
                draft={ninaDrafts[ninaScopeKey] ?? emptyNinaHomeDraft}
                onDraftChange={(draft) => {
                  setNinaDrafts((current) => ({ ...current, [ninaScopeKey]: draft }));
                }}
                requestAiAccess={openAi}
                onLaunch={launchPractice}
              />
            ) : null}
            {page === "practice" || (page === "writing" && writingOrigin === "practice") ? (
              <div ref={practiceContainer} hidden={page !== "practice"}>
                <PracticePage
                  onLanguageSwitchBlockedChange={setPracticeLanguageBlocked}
                  key={ninaScopeKey}
                  resultsRequest={resultsRequest}
                  onReturnToSource={
                    resultsOrigin
                      ? () => {
                          setPage(resultsOrigin);
                          pathHistory.back();
                          setResultsOrigin(undefined);
                        }
                      : undefined
                  }
                  resultsReturnLabel={resultsOrigin ? t(`nav.${resultsOrigin}`) : undefined}
                  onPracticeAgain={(seed) => {
                    if (seed.kind === "writing") savedResultsScroll.current = window.scrollY;
                    if (seed.kind === "exercise") {
                      setActivityOrigin("practice");
                      setPracticeSeed(undefined);
                      setPreparedActivityId(seed.activityId as PreparedActivityId);
                    } else {
                      setWritingOrigin("practice");
                      setWritingSeed(seed);
                      setWritingDirty(false);
                      setPage("writing");
                    }
                  }}
                  selectedTab={practiceTab}
                  onTabChange={setPracticeTab}
                  onWriting={() => {
                    navigate("writing");
                  }}
                  onResults={(language, rootGeneration) =>
                    void openCompletionPage("results", language, rootGeneration)
                  }
                  onNina={(language, rootGeneration) =>
                    void openCompletionPage("nina", language, rootGeneration)
                  }
                  autoStart={Boolean(preparedActivityId && quickStartId === preparedActivityId)}
                  targetLanguage={learningScope?.targetLanguage}
                  {...(activityOrigin ? { parentLabel: t(`nav.${activityOrigin}`) } : {})}
                  onVocabulary={() => {
                    navigate("vocabulary");
                  }}
                  {...(practiceSeed ? { initialPreparation: practiceSeed } : {})}
                  {...(preparedActivityId ? { activityId: preparedActivityId } : {})}
                  requestAiAccess={openAi}
                  onOpenActivity={(activityId) => {
                    setPreparedActivityId(activityId);
                  }}
                  onCloseActivity={() => {
                    setPreparedActivityId(undefined);
                    if (activityOrigin && activityOrigin !== "practice") {
                      setPage(activityOrigin);
                      setActivityOrigin(undefined);
                    }
                  }}
                />
              </div>
            ) : null}
            {page === "writing" ? (
              <WritingWorkspace
                {...(parent ? { breadcrumbs: [parent] } : {})}
                key={writingSeed?.historyEntryId ?? "new-writing"}
                {...(writingSeed
                  ? { initialContext: writingSeed.context, initialDraft: writingSeed.draft }
                  : suggestedWriting
                    ? { initialContext: suggestedWriting }
                    : {})}
                onDirtyChange={setWritingDirty}
                onHelperSelection={setHelperSelection}
                requestAiAccess={openAi}
              />
            ) : null}
            {page === "mobile" && <MobilePage />}
            {(page === "learningPath" || pathHistory.view === "results") &&
            learningScope &&
            languageCapabilities[learningScope.targetLanguage].structuredPath &&
            learningScope.courseId ===
              languageDefinitions[learningScope.targetLanguage].structuredCourseId ? (
              <div hidden={page !== "learningPath"}>
                <LearningPathPage
                  onLanguageSwitchBlockedChange={setPathLanguageBlocked}
                  onNina={() => {
                    navigate("nina");
                  }}
                  requestAiAccess={openAi}
                  onOpenResults={(ids) => {
                    pathHistory.open("results");
                    openSavedResults(
                      ids?.length ? { historyEntryIds: ids } : undefined,
                      "learningPath",
                    );
                  }}
                />
              </div>
            ) : page === "learningPath" ? (
              <Page title={t("nav.learningPath")}>
                {!learningScope ? (
                  <LoadingState live>{t("startup.loading")}</LoadingState>
                ) : (
                  <Card as="section">
                    <p>
                      {t(
                        learningScope.targetLanguage === "de"
                          ? "learningPath.enrollRequired"
                          : "learningPath.languageUnavailable",
                      )}
                    </p>
                    <ActionGroup>
                      <Button
                        variant="primary"
                        onPress={() => {
                          setSettingsTab("profile");
                          navigate("settings");
                        }}
                      >
                        {t("nav.settings")}
                      </Button>
                      <Button
                        variant="secondary"
                        onPress={() => {
                          navigate("practice");
                        }}
                      >
                        {t("nav.practice")}
                      </Button>
                    </ActionGroup>
                  </Card>
                )}
              </Page>
            ) : null}
            {page === "vocabulary" || resultsOrigin === "vocabulary" ? (
              <div hidden={page !== "vocabulary"}>
                <VocabularyPage
                  onLanguageSwitchBlockedChange={setVocabularyLanguageBlocked}
                  requestAiAccess={openAi}
                  targetLanguage={learningScope?.targetLanguage}
                  onOpenActivity={(activityId) => {
                    setActivityOrigin("vocabulary");
                    setPreparedActivityId(activityId);
                    setPracticeSeed(undefined);
                    setPage("practice");
                  }}
                  initialDueOnly={vocabularyDue}
                  viewRequest={vocabularyViewRequest}
                  onNavigate={(destination, scope) => {
                    if (destination === "results") openSavedResults(scope, "vocabulary");
                    else if (scope?.activityId) openExternalActivity(scope.activityId);
                    else navigate(destination);
                  }}
                />
              </div>
            ) : null}
            {page === "personalData" ? (
              <PersonalDataPage
                {...(parent ? { breadcrumbs: [parent] } : {})}
                onDataCleared={() => {
                  setHelperSelection(undefined);
                  setHelperEpoch((value) => value + 1);
                  setWritingSeed(undefined);
                  setSuggestedWriting(undefined);
                  setWritingDirty(false);
                  setPracticeSeed(undefined);
                  setPreparedActivityId(undefined);
                }}
              />
            ) : null}
            {page === "settings" ? (
              <SettingsPage
                readiness={readiness}
                selectedTab={settingsTab}
                onTabChange={setSettingsTab}
                onOpenPersonalData={() => {
                  navigate("personalData");
                }}
                onDataRootChanged={reload}
                onRunSetup={onRunSetup}
                onLearningLanguageChange={() => {
                  void refreshScope().catch((cause: unknown) => {
                    setOperationError(normalizeDesktopError(cause).detail);
                  });
                }}
              />
            ) : null}
          </>
        }
        helper={
          <ContextualHelper
            key={helperEpoch}
            selection={helperSelection}
            targetLanguage={learningScope?.targetLanguage}
            requestAiAccess={openAi}
          />
        }
        helperOpen={helperOpen}
        helperTitle={t("dashboard.helperTitle")}
        helperToggleLabel={helperOpen ? t("actions.hideHelper") : t("actions.showHelper")}
        navCollapsed={navCollapsed}
        navigation={navigation.map(({ page: destination, icon }) => ({
          page: destination,
          icon,
          label: t(`nav.${destination}`),
          ...(destination === "vocabulary"
            ? {
                feedback: (
                  <VocabularyLearningNotice
                    compact={navCollapsed}
                    onView={() => {
                      navigate("vocabulary");
                      setVocabularyViewRequest((value) => value + 1);
                    }}
                  />
                ),
              }
            : {}),
        }))}
        settingsNavigation={{ page: "settings", icon: Settings, label: t("nav.settings") }}
        navigationLabel={t("nav.label")}
        navFooter={
          <>
            {learningScope && (
              <>
                <span
                  hidden
                  data-learning-root={
                    readiness.dataRoot.status === "ready"
                      ? readiness.dataRoot.generation
                      : undefined
                  }
                />
                <LanguageSelect
                  label={t("onboarding.targetLanguage")}
                  value={learningScope.targetLanguage}
                  disabled={switchingLanguage || languageSwitchBlocked}
                  onChange={(language) => void selectTarget(language)}
                />
                {languageSwitchBlocked && page !== "settings" && (
                  <small>{t("settings.finishBeforeSwitch")}</small>
                )}
              </>
            )}
            <SidebarModelControl
              onOpenSettings={() => {
                setSettingsTab("ai");
                navigate("settings");
              }}
            />
          </>
        }
        navToggleLabel={
          navCollapsed ? t("actions.expandNavigation") : t("actions.collapseNavigation")
        }
        onMoveNavFocus={moveNavFocus}
        onNavigate={(destination) => {
          navigate(destination);
          if (!wideHelper) setNavPreference(true);
        }}
        onToggleHelper={() => {
          setHelperPreference(!helperOpen);
        }}
        onToggleNavigation={() => {
          setNavPreference(!navCollapsed);
        }}
      />
      {reminderOpen && (
        <FirstAiReminder
          close={(acknowledged) => {
            setReminderOpen(false);
            for (const resolve of disclosure.current.splice(0)) resolve(acknowledged);
          }}
        />
      )}
      {pendingNavigation && (
        <ModalDialog
          isOpen
          title={t("writing.unsavedTitle")}
          onOpenChange={(open) => {
            if (!open) setPendingNavigation(undefined);
          }}
        >
          <p>{t("writing.unsavedBody")}</p>
          <ActionGroup align="end">
            <Button
              variant="secondary"
              onPress={() => {
                setPendingNavigation(undefined);
              }}
            >
              {t("writing.keepEditing")}
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                setWritingDirty(false);
                if (pendingNavigation.mode === "normal")
                  applyNavigation(pendingNavigation.destination);
                else if (pendingNavigation.mode === "return")
                  returnTo(pendingNavigation.destination);
                else openExternalActivity(pendingNavigation.activityId);
                setPendingNavigation(undefined);
              }}
            >
              {t("writing.leave")}
            </Button>
          </ActionGroup>
        </ModalDialog>
      )}
    </>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [readiness, setReadiness] = useState<Readiness>();
  const [fatal, setFatal] = useState<CallNinaError>();
  const [recoveringRoot, setRecoveringRoot] = useState(false);
  const [profileOnboarding, setProfileOnboarding] = useState(false);
  const [repeatSetup, setRepeatSetup] = useState(false);
  const [initialPage, setInitialPage] = useState<Page>("nina");
  const load = useCallback(async () => {
    setFatal(undefined);
    try {
      const nextReadiness = await invokeDesktop("app/readiness", {});
      if (nextReadiness.dataRoot.status === "ready") {
        const profile = await invokeDesktop("learner-profile/read", {});
        if (profile.status === "ready") await i18n.changeLanguage(profile.profile.uiLocale);
        setProfileOnboarding(
          profile.status === "not-created" || profile.profile.onboardingState !== "complete",
        );
      }
      setReadiness(nextReadiness);
      setRecoveringRoot(false);
    } catch (cause) {
      setFatal(normalizeDesktopError(cause).detail);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    window.callNina.ready();
    return () => {
      window.clearTimeout(initialLoad);
    };
  }, [load]);
  if (fatal) {
    return (
      <StartupFrame>
        <Card as="section" className={styles.startupCard} role="alert">
          <h1>{t("startup.unavailableTitle")}</h1>
          <p>{t("startup.unavailableBody")}</p>
          <OperationError error={fatal} />
          <Button variant="primary" onPress={() => void load()}>
            {t("actions.retry")}
          </Button>
        </Card>
      </StartupFrame>
    );
  }
  if (!readiness) {
    return (
      <StartupFrame>
        <Card as="section" className={styles.startupCard} role="status">
          <LoaderCircle aria-hidden="true" /> {t("startup.loading")}
        </Card>
      </StartupFrame>
    );
  }
  if (readiness.dataRoot.status === "unconfigured" || recoveringRoot)
    return (
      <FolderOnboarding
        onReady={async () => {
          await load();
        }}
      />
    );
  if (readiness.dataRoot.status === "unavailable")
    return (
      <StartupError
        readiness={readiness}
        retry={load}
        recover={() => {
          setRecoveringRoot(true);
        }}
      />
    );
  if (profileOnboarding || repeatSetup)
    return (
      <ProfileOnboarding
        key={readiness.dataRoot.generation}
        readiness={readiness}
        {...(repeatSetup
          ? {
              onExit: () => {
                setRepeatSetup(false);
                setInitialPage("settings");
                void load();
              },
            }
          : {})}
        onComplete={() => {
          setProfileOnboarding(false);
          if (repeatSetup) setInitialPage("settings");
          setRepeatSetup(false);
          void load();
        }}
      />
    );
  return (
    <ViewBoundary
      title={t("errors.boundaryTitle")}
      body={t("errors.boundaryBody")}
      close={t("actions.close")}
    >
      <DesktopWorkspace
        key={readiness.dataRoot.generation}
        readiness={readiness}
        reload={load}
        initialPage={initialPage}
        onRunSetup={() => {
          setRepeatSetup(true);
        }}
      />
    </ViewBoundary>
  );
}
