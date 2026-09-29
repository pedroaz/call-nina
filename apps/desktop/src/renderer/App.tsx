import i18n from "./i18n.js";
import type { PracticeLaunch } from "./usePracticeSuggestion.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DesktopIpcRequest,
  type ProviderAccess,
  type ProviderOperation,
  type DesktopIpcResponse,
  type CallNinaError,
} from "@call-nina/contracts";
import type { ModelWorkload } from "@call-nina/domain";
import {
  FilePenLine,
  Gauge,
  History,
  MessageCircle,
  LibraryBig,
  LoaderCircle,
  Settings,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Feedback, ModalDialog } from "./components/ui/index.js";
import { ActionGroup, AppShell as ApplicationShell } from "./components/layout/index.js";

import callNinaLogo from "../../assets/call-nina.svg";
import styles from "./AppStyles.module.css";
import { Dashboard } from "./Dashboard.js";
import { useHelperSelection } from "./useHelperSelection.js";
import { ContextualHelper } from "./ContextualHelper.js";
import { HistoryPage, type HistoryPracticeSeed } from "./HistoryPage.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import { ProfileOnboarding } from "./ProfileOnboarding.js";
import { LearningPathPage } from "./LearningPathPage.js";
import { PracticePage } from "./PracticePage.js";
import { PersonalDataPage } from "./PersonalDataPage.js";
import { SettingsPage } from "./SettingsPage.js";
import { SidebarModelControl } from "./SidebarModelControl.js";
import { VocabularyPage } from "./VocabularyPage.js";
import { WritingWorkspace } from "./WritingWorkspace.js";
import {
  CodexBanner,
  FolderOnboarding,
  LanguageButton,
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
  | "history"
  | "learningPath"
  | "personalData"
  | "settings";

const navigation: ReadonlyArray<{
  page: Page;
  icon: typeof MessageCircle;
}> = [
  { page: "nina", icon: MessageCircle },
  { page: "practice", icon: Gauge },
  { page: "learningPath", icon: Sparkles },
  { page: "vocabulary", icon: LibraryBig },
  { page: "history", icon: History },
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
      <ActionGroup>
        <Button
          isPending={busy}
          pendingLabel={t("actions.acknowledge")}
          variant="primary"
          onPress={() => void acknowledge()}
        >
          {t("actions.acknowledge")}
        </Button>
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={() => {
            close(false);
          }}
        >
          {t("actions.cancel")}
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
  const [historyEntryIds, setHistoryEntryIds] =
    useState<
      NonNullable<
        Extract<DesktopIpcRequest, { channel: "history/read" }>["payload"]["historyEntryIds"]
      >
    >();
  const [page, setPage] = useState<Page>(initialPage);
  const [writingOrigin, setWritingOrigin] = useState<Page>("practice");
  const [activityOrigin, setActivityOrigin] = useState<Page>();
  const [settingsTab, setSettingsTab] = useState("profile");
  const [navCollapsed, setNavCollapsed] = useState(false);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  const [wideHelper, setWideHelper] = useState(
    () => window.matchMedia("(min-width: 68.01rem)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 68.01rem)");
    const update = () => {
      setWideHelper(media.matches);
    };
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
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
  const [accountSignedOut, setAccountSignedOut] = useState(false);
  const [providerUnavailable, setProviderUnavailable] =
    useState<Extract<ProviderAccess, { status: "unavailable" }>>();
  const [operationError, setOperationError] = useState<CallNinaError>();
  const [resetNotice, setResetNotice] = useState(false);
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
  const [pendingNavigation, setPendingNavigation] = useState<{
    destination: Page;
    mode: "normal" | "return" | "externalActivity";
  }>();
  const [writingSeed, setWritingSeed] =
    useState<Extract<HistoryPracticeSeed, { kind: "writing" }>>();
  const [preparedActivityId, setPreparedActivityId] = useState<PreparedActivityId>();
  const [suggestedWriting, setSuggestedWriting] = useState<string>();
  const [practiceSeed, setPracticeSeed] =
    useState<Extract<PracticeLaunch, { destination: "preparation" }>>();
  const [vocabularyDue, setVocabularyDue] = useState(false);
  const launchPractice = (intent: PracticeLaunch) => {
    if (intent.destination === "writing") {
      setWritingOrigin(page);
      setWritingSeed(undefined);
      setSuggestedWriting(intent.prompt);
      setPage("writing");
    } else if (intent.destination === "vocabulary") {
      setVocabularyDue(true);
      setPage("vocabulary");
    } else {
      setActivityOrigin(page);
      setPreparedActivityId(intent.destination === "activity" ? intent.activityId : undefined);
      setPracticeSeed(intent.destination === "preparation" ? intent : undefined);
      setPage("practice");
    }
  };
  const [helperEpoch, setHelperEpoch] = useState(0);
  const [helperSelection, setHelperSelection] = useHelperSelection(helperEpoch);

  useEffect(() => {
    let disposed = false;
    const refreshAccount = () => {
      void invokeDesktop("codex/account/read", {})
        .then((state) => {
          if (!disposed) setAccountSignedOut(state.status !== "signed-in");
        })
        .catch((cause: unknown) => {
          if (!disposed) setOperationError(normalizeDesktopError(cause).detail);
        });
    };
    refreshAccount();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated" && event.scope === "account") {
        setProviderUnavailable(undefined);
        refreshAccount();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "prepared-activity-open") {
        setPracticeSeed(undefined);
        setPreparedActivityId(event.activityId);
        setActivityOrigin(undefined);
        if (writingDirty)
          setPendingNavigation({ destination: "practice", mode: "externalActivity" });
        else setPage("practice");
        return;
      }
      if (event.event === "data-root-changed") {
        void reload();
        return;
      }
      if (
        event.event === "state-invalidated" &&
        (event.scope === "account" || event.scope === "settings")
      )
        void reload();
    });
    window.callNina.workspaceReady(true);
    return () => {
      window.callNina.workspaceReady(false);
      unsubscribe();
    };
  }, [reload, writingDirty]);

  const openAi = async (
    operation: ProviderOperation,
    previousOperationId?: DesktopIpcRequest["requestId"],
  ) => {
    setOperationError(undefined);
    setProviderUnavailable(undefined);
    try {
      const access = await invokeDesktop("provider/access/read", {
        routeId: "codex",
        operation,
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

  const applyNavigation = (destination: Page) => {
    if (destination === "history") setHistoryEntryIds(undefined);
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
    setPage(destination);
  };
  const navigate = (destination: Page, mode: "normal" | "return" = "normal") => {
    if (page === "writing" && writingDirty && destination !== "writing") {
      setPendingNavigation({ destination, mode });
      return;
    }
    if (mode === "return") setPage(destination);
    else applyNavigation(destination);
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
  const shellPage = page === "writing" ? "practice" : page === "personalData" ? "settings" : page;
  const modelWorkload: ModelWorkload = page === "writing" ? "correction" : "generation";

  return (
    <>
      <ApplicationShell
        activePage={shellPage}
        locationLabel={t(`nav.${page}`)}
        {...(parent ? { parent } : {})}
        brandMark={callNinaLogo}
        brandName={t("app.name")}
        content={
          <>
            <CodexBanner readiness={readiness} />
            {resetNotice && (
              <Feedback live="polite">
                <p>{t("developmentReset.body")}</p>
                <Button
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
            {accountSignedOut && readiness.codex.status === "available" && (
              <Feedback live="polite">
                <UserRound aria-hidden="true" /> {t("codex.signedOut")}
              </Feedback>
            )}
            {page === "nina" ? (
              <Dashboard requestAiAccess={openAi} onLaunch={launchPractice} onNavigate={navigate} />
            ) : null}
            {page === "practice" || (page === "writing" && writingOrigin === "practice") ? (
              <div hidden={page !== "practice"}>
                {!preparedActivityId && page === "practice" && (
                  <div className={styles.practiceSecondary}>
                    <Button
                      variant="secondary"
                      leadingIcon={<FilePenLine aria-hidden="true" />}
                      onPress={() => {
                        navigate("writing");
                      }}
                    >
                      {t("nav.writing")}
                    </Button>
                  </div>
                )}
                <PracticePage
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
            {page === "history" ? (
              <HistoryPage
                {...(historyEntryIds ? { initialHistoryEntryIds: historyEntryIds } : {})}
                requestAiAccess={openAi}
                onPracticeAgain={(seed) => {
                  if (seed.kind === "exercise") {
                    setActivityOrigin("history");
                    setPracticeSeed(undefined);
                    setPreparedActivityId(seed.activityId as PreparedActivityId);
                    setPage("practice");
                  } else {
                    setWritingOrigin("history");
                    setWritingSeed(seed);
                    setWritingDirty(false);
                    setPage("writing");
                  }
                }}
              />
            ) : null}
            {page === "learningPath" ? (
              <LearningPathPage
                requestAiAccess={openAi}
                onOpenHistory={(ids) => {
                  setHistoryEntryIds(ids);
                  setPage("history");
                }}
              />
            ) : null}
            {page === "vocabulary" ? (
              <VocabularyPage
                onOpenActivity={(activityId) => {
                  setActivityOrigin("vocabulary");
                  setPreparedActivityId(activityId);
                  setPracticeSeed(undefined);
                  setPage("practice");
                }}
                initialDueOnly={vocabularyDue}
                onNavigate={(destination) => {
                  navigate(destination);
                }}
              />
            ) : null}
            {page === "personalData" ? (
              <PersonalDataPage
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
              />
            ) : null}
          </>
        }
        exerciseMode={page === "practice" && Boolean(preparedActivityId)}
        helper={
          <ContextualHelper
            key={helperEpoch}
            selection={helperSelection}
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
        }))}
        settingsNavigation={{ page: "settings", icon: Settings, label: t("nav.settings") }}
        navigationLabel={t("nav.label")}
        navFooter={
          <>
            <LanguageButton />
            <SidebarModelControl initialWorkload={modelWorkload} />
          </>
        }
        navToggleLabel={
          navCollapsed ? t("actions.expandNavigation") : t("actions.collapseNavigation")
        }
        wide={page === "writing"}
        onMoveNavFocus={moveNavFocus}
        onNavigate={navigate}
        onToggleHelper={() => {
          setHelperPreference(!helperOpen);
        }}
        onToggleNavigation={() => {
          setNavCollapsed((current) => !current);
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
            if (!open) {
              if (pendingNavigation.mode === "externalActivity") setPreparedActivityId(undefined);
              setPendingNavigation(undefined);
            }
          }}
        >
          <p>{t("writing.unsavedBody")}</p>
          <ActionGroup>
            <Button
              variant="danger"
              onPress={() => {
                setWritingDirty(false);
                if (pendingNavigation.mode === "normal")
                  applyNavigation(pendingNavigation.destination);
                else setPage(pendingNavigation.destination);
                setPendingNavigation(undefined);
              }}
            >
              {t("writing.leave")}
            </Button>
            <Button
              onPress={() => {
                if (pendingNavigation.mode === "externalActivity") setPreparedActivityId(undefined);
                setPendingNavigation(undefined);
              }}
            >
              {t("writing.keepEditing")}
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
        <section className={styles.startupCard} role="alert">
          <h1>{t("startup.unavailableTitle")}</h1>
          <p>{t("startup.unavailableBody")}</p>
          <OperationError error={fatal} />
          <Button variant="primary" onPress={() => void load()}>
            {t("actions.retry")}
          </Button>
        </section>
      </StartupFrame>
    );
  }
  if (!readiness) {
    return (
      <StartupFrame>
        <section className={styles.startupCard} role="status">
          <LoaderCircle aria-hidden="true" /> {t("startup.loading")}
        </section>
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
