import { NinaAccountSettings } from "./NinaAccount.js";
import { Disclosure } from "./components/ui/Disclosure.js";
import { ConnectionSettings } from "./ConnectionSettings.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  languageDefinitions,
  type Language,
  type DesktopIpcResponse,
  type CallNinaError,
} from "@call-nina/contracts";
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
  SelectControl,
  Tabs,
  InfoHint,
  DiagnosticCode,
  Button,
  CheckboxField,
  Feedback,
  FieldGroup,
  SelectField,
  LoadingState,
  ItemList,
  Muted,
  ModalDialog,
} from "./components/ui/index.js";
import { ActionGroup, Page, Section } from "./components/layout/index.js";

import styles from "./SettingsPage.module.css";
import i18n from "./i18n.js";
import { LanguageSelect } from "./LanguageSelect.js";
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
  onOpenPersonalData,
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
  const [accountOptionsOpen, setAccountOptionsOpen] = useState(false);
  const [account, setAccount] = useState<Account>();
  const [loginId, setLoginId] = useState<LoginId>();
  const [accounts, setAccounts] = useState<Accounts>();
  const [selectedRegistration, setSelectedRegistration] = useState<string>();
  const [persisted, setPersisted] = useState<DesktopSettingsResult>();
  const [draft, setDraft] = useState<DesktopSettingsValue>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [notice, setNotice] = useState<string>();
  const [integrationFailure, setIntegrationFailure] = useState<string>();
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
        setPersisted(settings);
        setDraft(settings.settings);
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
        setPersisted(current);
        setDraft(current.settings);
        await i18n.changeLanguage(current.settings.uiLocale);
      }
      const next = await invokeDesktop("learner-settings/select-language", {
        expectedGeneration: current.dataRoot.generation,
        targetLanguage,
      });
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
    try {
      const result = await invokeDesktop("codex/integration/action", { action });
      setIntegration(result.status);
      if (result.result === "failed") setIntegrationFailure(t("settings.plugin.actionFailed"));
      else setNotice(result.steps.at(-1));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
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

  const setProfile = <Key extends keyof DesktopSettingsValue>(
    key: Key,
    value: DesktopSettingsValue[Key],
  ) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
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
          <Button
            variant="quiet"
            isDisabled={loading || busy || dirty || connectionPending || Boolean(loginId)}
            onPress={onOpenPersonalData}
          >
            {t("nav.personalData")}
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
      {(dirty || connectionPending) && (
        <Muted role="status">{t("onboarding.saveSettingsFirst")}</Muted>
      )}
      {loading && <LoadingState live>{t("settings.loading")}</LoadingState>}
      {error && <SettingsError error={error} />}
      {integrationFailure && (
        <Feedback live="assertive" tone="error">
          {integrationFailure}
        </Feedback>
      )}
      {notice && (
        <Feedback live="polite" tone="success">
          {notice}
        </Feedback>
      )}

      <Tabs
        selectedKey={selectedTab}
        onSelectionChange={onTabChange}
        label={t("settings.title")}
        items={[
          {
            id: "profile",
            label: t("settings.tabs.profile"),
            icon: <BookOpen aria-hidden="true" />,
            children: (
              <>
                <Section title={t("settings.profileTitle")}>
                  {!draft ? (
                    !loading && <Muted as="p">{t("settings.persistenceUnavailable")}</Muted>
                  ) : (
                    <div className={styles.settingsControls}>
                      <LanguageSelect
                        label={t("onboarding.targetLanguage")}
                        value={draft.learningScope.targetLanguage}
                        disabled={busy}
                        onChange={(language) => void selectTarget(language)}
                      />
                      <FieldGroup>
                        <span>{t("onboarding.level")}</span>
                        <SelectControl
                          value={draft.approximateLevel}
                          onChange={(event) => {
                            setProfile(
                              "approximateLevel",
                              event.currentTarget.value as DesktopSettingsValue["approximateLevel"],
                            );
                          }}
                        >
                          {["a1", "a2", "b1", "b2"].map((value) => (
                            <option key={value} value={value}>
                              {value.toUpperCase()}
                            </option>
                          ))}
                        </SelectControl>
                      </FieldGroup>
                      <FieldGroup>
                        <span>{t("onboarding.goal")}</span>
                        <textarea
                          rows={3}
                          maxLength={500}
                          value={draft.everydayLifeGoal}
                          onChange={(event) => {
                            setProfile("everydayLifeGoal", event.currentTarget.value);
                          }}
                        />
                      </FieldGroup>

                      <FieldGroup>
                        <span>{t("settings.teachingProfile")}</span>
                        <SelectControl
                          value={draft.defaultTeachingProfileId}
                          onChange={(event) => {
                            setProfile(
                              "defaultTeachingProfileId",
                              event.currentTarget
                                .value as DesktopSettingsValue["defaultTeachingProfileId"],
                            );
                          }}
                        >
                          <option value="conversation-partner">
                            {t("onboarding.profiles.conversation-partner.title")}
                          </option>
                          <option value="strict-corrector">
                            {t("onboarding.profiles.strict-corrector.title")}
                          </option>
                        </SelectControl>
                      </FieldGroup>
                      <LanguageSelect
                        label={t("onboarding.explanationLanguage")}
                        value={draft.explanationLanguage}
                        disabled={busy}
                        onChange={(language) => {
                          setProfile("explanationLanguage", language);
                        }}
                      />
                      <div>
                        <LanguageSelect
                          label={t("settings.uiLocale")}
                          value={draft.uiLocale}
                          interfaceOnly
                          disabled={busy}
                          onChange={(language) => {
                            setProfile("uiLocale", language);
                          }}
                        />
                      </div>
                      <div className={styles.coursePreference}>
                        {
                          <CheckboxField
                            checked={
                              draft.learningScope.courseId ===
                              languageDefinitions[draft.learningScope.targetLanguage]
                                .structuredCourseId
                            }
                            disabled={busy}
                            onChange={(event) => {
                              setProfile("learningScope", {
                                ...draft.learningScope,
                                courseId: event.currentTarget.checked
                                  ? languageDefinitions[draft.learningScope.targetLanguage]
                                      .structuredCourseId
                                  : null,
                              });
                            }}
                          >
                            {t("onboarding.enrollCourse")}
                          </CheckboxField>
                        }
                      </div>
                    </div>
                  )}
                </Section>
              </>
            ),
          },
          {
            id: "ai",
            label: t("settings.tabs.ai"),
            icon: <Plug aria-hidden="true" />,
            children: (
              <div className={styles.aiSetup}>
                <NinaAccountSettings />
                <Section className={styles.aiConnections} aria-label={t("settings.aiTitle")}>
                  <ConnectionSettings
                    surface={false}
                    active={selectedTab === "ai"}
                    disabled={busy || Boolean(loginId)}
                    onPendingChange={setConnectionPending}
                    chatgptAccess={({ active, saved, dirty: connectionDirty }) => {
                      const blocked = busy || Boolean(loginId) || connectionDirty;
                      if (!active)
                        return (
                          <p>
                            {t(saved ? "settings.activateBeforeLogin" : "settings.saveBeforeLogin")}
                          </p>
                        );
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
                            <ActionGroup>
                              <Button
                                variant="quiet"
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
                            </ActionGroup>
                            <Button variant="secondary" onPress={() => setAccountOptionsOpen(true)}>
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
                                onPress={() => setAccountOptionsOpen(false)}
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
                <Disclosure
                  className={styles.optionalIntegration}
                  variant="plain"
                  label={
                    <span className={styles.tabLabel}>
                      <AudioLines aria-hidden="true" />
                      {t("settings.externalIntegrationTitle")}
                    </span>
                  }
                >
                  <InfoHint label={t("settings.externalIntegrationTitle")}>
                    <p>{t("settings.externalIntegrationHelp")}</p>
                  </InfoHint>
                  <p>
                    {integration === undefined
                      ? t("settings.notReported")
                      : integration.status === "available"
                        ? t("settings.codexVersion", { version: integration.codexVersion })
                        : t("settings.codexUnavailable")}
                  </p>
                  {integration?.status === "available" && (
                    <>
                      <p>{t(`settings.plugin.${integration.plugin}`)}</p>
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
                            variant="primary"
                            isDisabled={busy}
                            onPress={() => void manageIntegration("refresh")}
                          >
                            {t("settings.plugin.actions.refresh")}
                          </Button>
                        )}
                        {integration.plugin === "installed" && (
                          <Button
                            variant="primary"
                            isDisabled={busy}
                            onPress={() => void manageIntegration("uninstall")}
                          >
                            {t("settings.plugin.actions.uninstall")}
                          </Button>
                        )}
                      </ActionGroup>
                    </>
                  )}
                </Disclosure>
              </div>
            ),
          },
          {
            id: "data",
            label: t("settings.tabs.data"),
            icon: <ShieldCheck aria-hidden="true" />,
            children: (
              <>
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
                <Section
                  className={styles.settingsSection}
                  aria-labelledby="settings-privacy-title"
                >
                  <h2 id="settings-privacy-title">{t("settings.privacyTitle")}</h2>
                  <p>
                    <strong>{t("folder.privacyTitle")}</strong> — {t("folder.privacyBody")}
                  </p>
                  <p>
                    <strong>{t("folder.cloudTitle")}</strong> — {t("folder.cloudBody")}
                  </p>
                </Section>
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
                  <InfoHint label={t("settings.diagnosticsTitle")}>
                    {t("settings.diagnosticsPrivacy")}
                  </InfoHint>
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
                      variant="primary"
                      isDisabled={busy}
                      onPress={() => void readDiagnostics()}
                    >
                      {t("settings.runDiagnostics")}
                    </Button>
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() => void exportDiagnostics()}
                    >
                      {t("settings.exportDiagnostics")}
                    </Button>
                    <Button variant="secondary" isDisabled={busy} onPress={() => void clearLogs()}>
                      {t("settings.clearLogs")}
                    </Button>
                  </ActionGroup>
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
