import { LiveConversationProvider } from "./LiveConversationProvider.js";
import { PersonalDataPage } from "./PersonalDataPage.js";
import { SettingsRow } from "./SettingsRow.js";
import { LearningProfileFields } from "./LearningProfileFields.js";
import { SpeechSettings } from "./SpeechSettings.js";
import { ConnectionSettings } from "./ConnectionSettings.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Language, type DesktopIpcResponse, type CallNinaError } from "@call-nina/contracts";
import {
  Save,
  UserRound,
  CircleCheck,
  CircleHelp,
  Gauge,
  LogOut,
  AudioLines,
  BookOpen,
  Plug,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tabs,
  InfoHint,
  DiagnosticCode,
  Button,
  Feedback,
  SelectField,
  LoadingState,
  ItemList,
  ModalDialog,
} from "./components/ui/index.js";
import { ActionGroup, Page, Section } from "./components/layout/index.js";

import styles from "./SettingsPage.module.css";
import i18n from "./i18n.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import {
  desktopSettingsAdapter,
  type DesktopSettingsAdapter,
  type DesktopSettingsResult,
  type DesktopSettingsValue,
} from "./settings-adapter.js";

type Readiness = Extract<DesktopIpcResponse, { status: "ok"; channel: "app/readiness" }>["result"];
type Integration = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "codex/integration/read" }
>["result"];
type Account = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/read" }
>["result"];
type Accounts = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/accounts/read" }
>["result"];
type LoginId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/login/start" }
>["result"]["loginId"];
type DataRootSelection = Extract<
  Extract<DesktopIpcResponse, { status: "ok"; channel: "data-root/choose" }>["result"],
  { status: "selected" }
>;
type Diagnostics = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "diagnostics/read" }
>["result"];
type DiagnosticsExport = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "diagnostics/export" }
>["result"];

const dataRootWarningKeys = {
  "git-worktree": "folder.warningGit",
  "broad-permissions": "folder.warningBroad",
  "install-directory": "folder.warningInstall",
  "integration-restart-required": "folder.warningRestart",
} as const;

function SettingsError({ error }: { error: CallNinaError }) {
  const { t } = useTranslation();
  return (
    <Feedback live="assertive" tone="error">
      <div>
        <p>{t(error.messageKey)}</p>
        <DiagnosticCode>
          {t("startup.diagnostic")}: {error.reference.code} · {error.reference.correlationId}
        </DiagnosticCode>
      </div>
    </Feedback>
  );
}

export function SettingsPage({
  readiness,
  onRunSetup,
  selectedTab,
  onTabChange,
  onLearningLanguageChange,
  adapter = desktopSettingsAdapter,
  onDataRootChanged = () => {
    window.location.reload();
  },
}: {
  readiness: Readiness;
  onRunSetup: () => void;
  onOpenPersonalData: () => void;
  selectedTab: string;
  onTabChange: (tab: string) => void;
  onLearningLanguageChange?: (language: Language) => void;
  adapter?: DesktopSettingsAdapter;
  onDataRootChanged?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [folderOpen, setFolderOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [accountOptionsOpen, setAccountOptionsOpen] = useState(false);
  const [account, setAccount] = useState<Account>();
  const [loginId, setLoginId] = useState<LoginId>();
  const [accounts, setAccounts] = useState<Accounts>();
  const [selectedRegistration, setSelectedRegistration] = useState<string>();
  const [persisted, setPersisted] = useState<DesktopSettingsResult>();
  const [draft, setDraft] = useState<DesktopSettingsValue>();
  const lastPersisted = useRef<DesktopSettingsResult | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [notice, setNotice] = useState<string>();
  const [integrationFailure, setIntegrationFailure] = useState<string>();
  const [integrationNotice, setIntegrationNotice] = useState<string>();
  const [dataRootSelection, setDataRootSelection] = useState<DataRootSelection>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [integration, setIntegration] = useState<Integration>();
  const integrationReadRevision = useRef(0);
  const integrationActionPending = useRef(false);

  const refreshIntegration = useCallback(async () => {
    if (integrationActionPending.current) return;
    const revision = ++integrationReadRevision.current;
    try {
      const result = await invokeDesktop("codex/integration/read", {});
      if (revision === integrationReadRevision.current) setIntegration(result);
    } catch (cause) {
      if (revision !== integrationReadRevision.current) return;
      setIntegration(undefined);
      setError(normalizeDesktopError(cause).detail);
    }
  }, []);

  const refreshRuntime = useCallback(async () => {
    const [accountResult, accountsResult] = await Promise.allSettled([
      invokeDesktop("chatgpt/account/read", {}),
      invokeDesktop("chatgpt/accounts/read", {}),
    ]);
    setAccount(
      accountResult.status === "fulfilled"
        ? accountResult.value
        : { status: "unavailable", reason: "runtime-not-ready" },
    );
    setAccounts(accountsResult.status === "fulfilled" ? accountsResult.value : undefined);
    const failure = [accountResult, accountsResult].find((result) => result.status === "rejected");
    if (failure?.status === "rejected") setError(normalizeDesktopError(failure.reason).detail);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const settings = adapter.available() ? await adapter.read() : undefined;
      if (settings) {
        const previous = lastPersisted.current;
        lastPersisted.current = settings;
        setPersisted(settings);
        setDraft((current) => {
          if (
            !current ||
            !previous ||
            JSON.stringify(previous.settings.learningScope) !==
              JSON.stringify(settings.settings.learningScope)
          )
            return settings.settings;
          const merged = { ...settings.settings };
          for (const key of Object.keys(current) as (keyof DesktopSettingsValue)[]) {
            if (
              key !== "uiLocale" &&
              JSON.stringify(current[key]) !== JSON.stringify(previous.settings[key])
            )
              Object.assign(merged, { [key]: current[key] });
          }
          return merged;
        });
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setLoading(false);
    }
    // Provider failures cannot prevent local settings from loading.
    void refreshIntegration();
    void refreshRuntime();
  }, [adapter, refreshRuntime, refreshIntegration]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "account-login" &&
        ["complete", "cancelled", "failed"].includes(event.state.status)
      ) {
        setLoginId(undefined);
        setNotice(undefined);
        if (event.state.status === "failed") setError(event.state.error);
        if (event.state.status === "complete") setSelectedRegistration(undefined);
        void refreshRuntime();
      } else if (
        event.event === "state-invalidated" &&
        ["account", "models", "rate-limits", "ai-connections"].includes(event.scope)
      ) {
        // Immediate connection saves must not reload the independent profile draft.
        void refreshRuntime();
      } else if (event.event === "state-invalidated" && event.scope === "settings") {
        void load();
      }
    });
    return () => {
      window.clearTimeout(initialLoad);
      unsubscribe();
    };
  }, [load, refreshRuntime]);

  const dirty = useMemo(
    () =>
      Boolean(draft && persisted && JSON.stringify(draft) !== JSON.stringify(persisted.settings)),
    [draft, persisted],
  );

  const save = async () => {
    if (!draft || !persisted || !dirty) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await adapter.update(persisted.updatedAt, draft);
      lastPersisted.current = next;
      setPersisted(next);
      setDraft(next.settings);
      await i18n.changeLanguage(next.settings.uiLocale);
      setNotice(i18n.t("settings.saved"));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const selectTarget = async (targetLanguage: Language) => {
    if (!persisted || !draft || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      let current = persisted;
      if (dirty) {
        current = await adapter.update(current.updatedAt, draft);
        lastPersisted.current = current;
        setPersisted(current);
        setDraft(current.settings);
        await i18n.changeLanguage(current.settings.uiLocale);
      }
      const next = await invokeDesktop("learner-settings/select-language", {
        expectedGeneration: current.dataRoot.generation,
        targetLanguage,
      });
      lastPersisted.current = next;
      setPersisted(next);
      setDraft(next.settings);
      onLearningLanguageChange?.(next.settings.learningScope.targetLanguage);
      setNotice(t("settings.languageSelected"));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    if (busy || loginId) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("chatgpt/account/login/start", {
        registrationId: (selectedRegistration ?? accounts?.selectedId) || null,
      });
      setLoginId(result.loginId);
      setNotice(t("settings.loginStarted"));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (busy || loginId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setAccount(await invokeDesktop("chatgpt/account/logout", {}));
      void refreshRuntime();
      setNotice(t("settings.loggedOut"));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
      void refreshRuntime();
    } finally {
      setBusy(false);
    }
  };

  const cancelLogin = async () => {
    if (busy || !loginId) return;
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("chatgpt/account/login/cancel", { loginId });
      setLoginId(undefined);
      void refreshRuntime();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const manageIntegration = async (action: "install" | "refresh" | "uninstall") => {
    if (integrationActionPending.current) return;
    integrationActionPending.current = true;
    // An older status read must not overwrite the verified action result.
    integrationReadRevision.current += 1;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setIntegrationFailure(undefined);
    setIntegrationNotice(undefined);
    try {
      const result = await invokeDesktop("codex/integration/action", { action });
      setIntegration(result.status);
      if (result.result === "failed") setIntegrationFailure(t("settings.plugin.actionFailed"));
      else setIntegrationNotice(result.steps.at(-1));
    } catch {
      setIntegrationFailure(t("settings.plugin.actionFailed"));
    } finally {
      integrationActionPending.current = false;
      setBusy(false);
    }
  };

  const chooseDataRoot = async () => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await invokeDesktop("data-root/choose", {
        ...(persisted ? { expectedGeneration: persisted.dataRoot.generation } : {}),
      });
      if (result.status === "selected") setDataRootSelection(result);
      else setNotice(t("settings.dataSwitchCancelled"));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const confirmDataRoot = async () => {
    if (!dataRootSelection) return;
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("data-root/confirm", { selectionId: dataRootSelection.selectionId });
      await onDataRootChanged();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const readDiagnostics = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setDiagnostics(await invokeDesktop("diagnostics/read", {}));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const clearLogs = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("logs/clear", {});
      setDiagnostics((current) => (current ? { ...current, logFileCount: 0 } : current));
      setNotice(t("settings.logsCleared", { count: result.clearedFileCount }));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const exportDiagnostics = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result: DiagnosticsExport = await invokeDesktop("diagnostics/export", {});
      if (result.status === "exported") setNotice(t("settings.diagnosticsExported", result));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      width="form"
      className={styles.settingsPage}
      data-settings-root={persisted?.dataRoot.generation}
      data-settings-language={persisted?.settings.learningScope.targetLanguage}
      data-settings-ready={Boolean(persisted) && !loading && !busy && !dirty && !connectionPending}
      actions={
        <ActionGroup>
          <Button
            variant="quiet"
            isDisabled={loading || busy || dirty || connectionPending || Boolean(loginId)}
            onPress={onRunSetup}
          >
            {t("onboarding.runAgain")}
          </Button>
        </ActionGroup>
      }
      title={t("settings.title")}
      refresh={{
        onRefresh: load,
        busy: loading || busy,
        disabled: dirty || connectionPending || Boolean(loginId),
      }}
    >
      {loading && <LoadingState live>{t("settings.loading")}</LoadingState>}
      {error && <SettingsError error={error} />}
      {notice && (
        <Feedback live="polite" tone="success">
          {notice}
        </Feedback>
      )}

      <Tabs
        selectedKey={selectedTab === "speech" ? "ai" : selectedTab}
        onSelectionChange={onTabChange}
        label={t("settings.title")}
        items={[
          {
            id: "profile",
            label: t("settings.tabs.profile"),
            icon: <BookOpen aria-hidden="true" />,
            children: (
              <>
                {draft && (
                  <LearningProfileFields
                    value={draft}
                    language={draft.learningScope.targetLanguage}
                    disabled={busy}
                    onLanguage={(language) => void selectTarget(language)}
                    onChange={(key, value) => {
                      setDraft((current) => (current ? { ...current, [key]: value } : current));
                    }}
                  />
                )}
              </>
            ),
          },
          {
            id: "ai",
            label: t("settings.tabs.ai"),
            icon: <Plug aria-hidden="true" />,
            children: (
              <div className={styles.aiSetup}>
                <Section className={styles.aiConnections} aria-label={t("settings.aiTitle")}>
                  <ConnectionSettings
                    surface={false}
                    active={selectedTab === "ai" || selectedTab === "speech"}
                    disabled={busy || Boolean(loginId)}
                    onPendingChange={setConnectionPending}
                    chatgptConnected={account ? account.status === "signed-in" : undefined}
                    chatgptAccess={({ dirty: connectionDirty }) => {
                      const blocked = busy || Boolean(loginId) || connectionDirty;
                      return (
                        <div className={styles.accountAccess}>
                          <div className={styles.accountSummary}>
                            <p role="status" className={styles.connectionStatus}>
                              {account?.status === "signed-in" ? (
                                <CircleCheck aria-hidden="true" />
                              ) : (
                                <CircleHelp aria-hidden="true" />
                              )}
                              {account
                                ? t(`settings.account.${account.status}`)
                                : t("settings.notReported")}
                            </p>
                            <InfoHint label={t("settings.privacyTitle")}>
                              <p>{t("connectionSettings.cost.chatgpt")}</p>
                              <p>{t("settings.sessionPrivacy")}</p>
                            </InfoHint>
                          </div>
                          {account?.status !== "signed-in" && (
                            <ActionGroup>
                              <Button
                                variant="primary"
                                isDisabled={blocked || !account || account.status === "unavailable"}
                                onPress={() => void login()}
                              >
                                <UserRound aria-hidden="true" />
                                {t("settings.login")}
                              </Button>
                            </ActionGroup>
                          )}
                          {loginId && (
                            <ActionGroup>
                              <span role="status">{t("onboarding.login.waiting")}</span>
                              <Button
                                variant="primary"
                                isDisabled={busy}
                                onPress={() => void cancelLogin()}
                              >
                                {t("onboarding.cancelLogin")}
                              </Button>
                            </ActionGroup>
                          )}
                          {account?.status === "unavailable" && (
                            <p>{t("connectionSettings.chatgptLoginUnavailable")}</p>
                          )}
                          {accounts?.remoteRevocationPending && (
                            <Feedback tone="warning" live="polite">
                              {t("settings.chatgptRevocationPending")}
                            </Feedback>
                          )}
                          <div className={styles.accountTools}>
                            <Button
                              variant="secondary"
                              onPress={() =>
                                void invokeDesktop("chatgpt/usage/open", {}).catch(
                                  (cause: unknown) => {
                                    setError(normalizeDesktopError(cause).detail);
                                  },
                                )
                              }
                            >
                              <Gauge aria-hidden="true" />
                              {t("settings.chatgptUsageLink")}
                            </Button>
                            <Button
                              variant="secondary"
                              onPress={() => {
                                setAccountOptionsOpen(true);
                              }}
                            >
                              <UserRound aria-hidden="true" />
                              {t("settings.accountOptions")}
                            </Button>
                          </div>
                          <ModalDialog
                            isOpen={accountOptionsOpen}
                            onOpenChange={setAccountOptionsOpen}
                            title={t("settings.accountOptions")}
                          >
                            <div className={styles.accountOptions}>
                              {account?.status === "signed-in" && account.planType && (
                                <p>{t("settings.plan", { plan: account.planType })}</p>
                              )}
                              <SelectField
                                label={t("settings.chatgptAccount")}
                                disabled={blocked}
                                value={selectedRegistration ?? accounts?.selectedId ?? ""}
                                onChange={(event) => {
                                  setSelectedRegistration(event.currentTarget.value);
                                }}
                              >
                                <option value="">{t("settings.chatgptNewAccount")}</option>
                                {accounts?.registrations.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.label}
                                  </option>
                                ))}
                              </SelectField>
                              <ActionGroup>
                                <Button
                                  variant="primary"
                                  isDisabled={
                                    blocked || !account || account.status === "unavailable"
                                  }
                                  onPress={() => void login()}
                                >
                                  {t("settings.login")}
                                </Button>
                                {account?.status === "signed-in" && (
                                  <Button
                                    variant="quiet"
                                    isDisabled={blocked}
                                    onPress={() => void logout()}
                                  >
                                    <LogOut aria-hidden="true" />
                                    {t("settings.logout")}
                                  </Button>
                                )}
                              </ActionGroup>
                              <p>{t("settings.sessionPrivacy")}</p>
                              <Button
                                variant="secondary"
                                onPress={() => {
                                  setAccountOptionsOpen(false);
                                }}
                              >
                                {t("actions.close")}
                              </Button>
                            </div>
                          </ModalDialog>
                          {connectionDirty && <p>{t("settings.saveBeforeAccount")}</p>}
                        </div>
                      );
                    }}
                  />
                </Section>
                <SpeechSettings language={draft?.learningScope.targetLanguage ?? "de"} />
                <Section title={t("setupUx.speakingPractice")}>
                  <LiveConversationProvider />
                  <ActionGroup>
                    <span role="status">
                      {integration?.status === "available"
                        ? t(`settings.plugin.${integration.plugin}`)
                        : t("settings.codexUnavailable")}
                    </span>
                    <Button
                      variant="secondary"
                      onPress={() => {
                        setIntegrationOpen(true);
                      }}
                    >
                      {t("setupUx.manage")}
                    </Button>
                  </ActionGroup>
                </Section>
                <ModalDialog
                  closeLabel={t("actions.close")}
                  isOpen={integrationOpen}
                  title={t("setupUx.speakingPractice")}
                  onOpenChange={setIntegrationOpen}
                >
                  <section
                    className={styles.optionalIntegration}
                    aria-labelledby="codex-integration-title"
                  >
                    <div className={styles.integrationCopy}>
                      <div className={styles.integrationHeading}>
                        <AudioLines aria-hidden="true" />
                        <h3 id="codex-integration-title">
                          {t("settings.externalIntegrationTitle")}
                        </h3>
                        <InfoHint label={t("settings.externalIntegrationTitle")}>
                          <p>{t("settings.externalIntegrationHelp")}</p>
                        </InfoHint>
                      </div>
                      <p className={styles.integrationStatus} role="status">
                        {integration === undefined
                          ? t("settings.notReported")
                          : integration.status === "available"
                            ? t(`settings.plugin.${integration.plugin}`)
                            : t("settings.codexUnavailable")}
                      </p>
                      {integration?.status === "available" && (
                        <p className={styles.integrationDetail}>
                          {t("settings.codexVersion", { version: integration.codexVersion })}
                        </p>
                      )}
                    </div>
                    {integration?.status === "available" && (
                      <>
                        <ActionGroup>
                          {integration.plugin === "not-installed" && (
                            <Button
                              variant="primary"
                              isDisabled={busy}
                              onPress={() => void manageIntegration("install")}
                            >
                              {t("settings.plugin.actions.install")}
                            </Button>
                          )}
                          {integration.plugin !== "not-installed" && (
                            <Button
                              variant="secondary"
                              isDisabled={busy}
                              onPress={() => void manageIntegration("refresh")}
                            >
                              {t("settings.plugin.actions.refresh")}
                            </Button>
                          )}
                          {integration.plugin === "installed" && (
                            <Button
                              variant="quiet"
                              isDisabled={busy}
                              onPress={() => void manageIntegration("uninstall")}
                            >
                              {t("settings.plugin.actions.uninstall")}
                            </Button>
                          )}
                        </ActionGroup>
                      </>
                    )}
                    {(integrationFailure || integrationNotice) && (
                      <div className={styles.integrationFeedback}>
                        {integrationFailure ? (
                          <Feedback live="assertive" tone="error">
                            {integrationFailure}
                          </Feedback>
                        ) : (
                          <Feedback live="polite" tone="success">
                            {integrationNotice}
                          </Feedback>
                        )}
                      </div>
                    )}
                  </section>
                </ModalDialog>
              </div>
            ),
          },
          {
            id: "data",
            label: t("settings.tabs.data"),
            icon: <ShieldCheck aria-hidden="true" />,
            children: (
              <>
                <PersonalDataPage
                  embedded
                  onDataCleared={() => void load()}
                  folderAction={
                    <Button
                      variant="secondary"
                      isDisabled={busy || dirty || connectionPending}
                      onPress={() => {
                        setFolderOpen(true);
                      }}
                    >
                      {t("setupUx.change")}
                    </Button>
                  }
                />
                <ModalDialog
                  closeLabel={t("actions.close")}
                  isOpen={folderOpen}
                  title={t("settings.dataSwitch")}
                  isDismissable={!busy}
                  onOpenChange={setFolderOpen}
                >
                  <Section className={styles.settingsSection} aria-labelledby="settings-data-title">
                    <h2 id="settings-data-title">{t("settings.dataTitle")}</h2>
                    {readiness.dataRoot.status === "ready" && (
                      <dl className={styles.detailList}>
                        <div>
                          <dt>{t("settings.dataFolder")}</dt>
                          <dd>{readiness.dataRoot.displayName}</dd>
                        </div>
                      </dl>
                    )}
                    {!dataRootSelection ? (
                      <Button
                        variant="primary"
                        isDisabled={busy}
                        onPress={() => void chooseDataRoot()}
                      >
                        {t("settings.dataSwitch")}
                      </Button>
                    ) : (
                      <div
                        className={styles.switchConfirmation}
                        role="group"
                        aria-label={t("settings.dataSwitchConfirmTitle")}
                      >
                        <p>
                          {t("settings.dataSwitchConfirm", {
                            name: dataRootSelection.displayName,
                            generation: dataRootSelection.generation,
                          })}
                        </p>
                        {dataRootSelection.warnings.length > 0 && (
                          <ItemList>
                            {dataRootSelection.warnings.map((warning) => (
                              <li key={warning}>{t(dataRootWarningKeys[warning])}</li>
                            ))}
                          </ItemList>
                        )}
                        <ActionGroup>
                          <Button
                            variant="primary"
                            isDisabled={busy}
                            onPress={() => void confirmDataRoot()}
                          >
                            {t("settings.dataSwitchConfirmAction")}
                          </Button>
                          <Button
                            variant="secondary"
                            isDisabled={busy}
                            onPress={() => {
                              setDataRootSelection(undefined);
                            }}
                          >
                            {t("actions.cancel")}
                          </Button>
                        </ActionGroup>
                      </div>
                    )}
                  </Section>
                </ModalDialog>
              </>
            ),
          },
          {
            id: "diagnostics",
            label: t("settings.tabs.diagnostics"),
            icon: <Activity aria-hidden="true" />,
            children: (
              <>
                <Section
                  className={styles.settingsSection}
                  aria-labelledby="settings-diagnostics-title"
                >
                  <h2 id="settings-diagnostics-title">{t("settings.diagnosticsTitle")}</h2>
                  <SettingsRow
                    title={t("setupUx.checkApp")}
                    action={
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void readDiagnostics()}
                      >
                        {t("setupUx.runCheck")}
                      </Button>
                    }
                  >
                    {diagnostics && <span role="status">{t("setupUx.storageReadable")}</span>}
                  </SettingsRow>
                  <SettingsRow
                    title={t("setupUx.supportReport")}
                    action={
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void exportDiagnostics()}
                      >
                        {t("setupUx.exportReport")}
                      </Button>
                    }
                  />
                  <Button
                    variant="quiet"
                    onPress={() => {
                      setTechnicalOpen(true);
                    }}
                  >
                    {t("setupUx.technicalDetails")}
                  </Button>
                  <ModalDialog
                    closeLabel={t("actions.close")}
                    isOpen={technicalOpen}
                    title={t("setupUx.technicalDetails")}
                    onOpenChange={setTechnicalOpen}
                  >
                    {diagnostics && (
                      <dl className={styles.detailList}>
                        <div>
                          <dt>{t("settings.diagnosticsGeneration")}</dt>
                          <dd>{diagnostics.dataRootGeneration}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.diagnosticsSchema")}</dt>
                          <dd>{diagnostics.databaseSchemaVersion}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.diagnosticsDatabase")}</dt>
                          <dd>{diagnostics.journalMode.toUpperCase()}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.diagnosticsLogs")}</dt>
                          <dd>{diagnostics.logFileCount}</dd>
                        </div>
                      </dl>
                    )}
                    <ActionGroup>
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void readDiagnostics()}
                      >
                        {t("setupUx.runCheck")}
                      </Button>
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void clearLogs()}
                      >
                        {t("settings.clearLogs")}
                      </Button>
                    </ActionGroup>
                  </ModalDialog>
                </Section>
              </>
            ),
          },
        ]}
      />

      {draft && (selectedTab === "profile" || dirty) && (
        <div
          className={styles.settingsActions}
          role="group"
          aria-label={t("settings.profileTitle")}
        >
          <Button
            variant="secondary"
            isDisabled={busy || !persisted || !dirty}
            onPress={() => {
              if (persisted) setDraft(persisted.settings);
            }}
          >
            {t("settings.discard")}
          </Button>
          <Button variant="primary" isDisabled={busy || !dirty} onPress={() => void save()}>
            <Save aria-hidden="true" />
            {t("settings.save")}
          </Button>
        </div>
      )}
    </Page>
  );
}
