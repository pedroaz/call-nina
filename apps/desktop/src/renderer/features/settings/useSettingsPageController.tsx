import { type CallNinaError, type Language } from "@call-nina/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, useNotifications } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { type ConnectionSettingsHandle } from "../../learning/providers/ConnectionSettings.js";
import i18n from "../../runtime/i18n.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "../../runtime/ipc.js";
import {
  desktopSettingsAdapter,
  type DesktopSettingsResult,
  type DesktopSettingsValue,
} from "../../runtime/settings-adapter.js";
import {
  type Account,
  type Accounts,
  type DataRootSelection,
  type LoginId,
  type SettingsPageProps,
} from "./SettingsPage.types.js";
import { useDiagnosticsSettings } from "./useDiagnosticsSettings.js";
import { useIntegrationSettings } from "./useIntegrationSettings.js";

export function useSettingsPageController({
  readiness,
  onRunSetup,
  selectedTab,
  onTabChange,
  onLearningLanguageChange,
  adapter = desktopSettingsAdapter,
  onDataRootChanged = () => {
    window.location.reload();
  },
}: SettingsPageProps) {
  const { t } = useTranslation();
  const { notify } = useNotifications();
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
  const connectionSettings = useRef<ConnectionSettingsHandle>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const statusCheckPending = useRef(false);
  const statusCheckRevision = useRef(0);
  const [statusCheckTimedOut, setStatusCheckTimedOut] = useState(false);
  const mounted = useRef(true);
  const readEpoch = useRef(0);
  const settingsReadRevision = useRef(0);
  const runtimeReadRevision = useRef(0);
  const [settingsReadError, setSettingsReadError] = useState<CallNinaError>();
  const [runtimeReadError, setRuntimeReadError] = useState<CallNinaError>();

  const [readingRuntime, setReadingRuntime] = useState(false);

  const [connectionBusy, setConnectionBusy] = useState(false);
  const [actionBusy, setBusy] = useState(false);
  const busy = actionBusy || checkingStatus;
  const [connectionPending, setConnectionPending] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [notice, setNotice] = useState<string>();

  const [dataRootSelection, setDataRootSelection] = useState<DataRootSelection>();

  const {
    integrationReadError,
    readingIntegration,
    integrationFailure,
    integrationNotice,
    integration,
    refreshIntegration,
    manageIntegration,
    resetIntegration,
    integrationPending,
  } = useIntegrationSettings({ mounted, readEpoch, setBusy, setError, setNotice });
  const { diagnostics, diagnosticsFailure, readDiagnostics, clearLogs, exportDiagnostics } =
    useDiagnosticsSettings({ setBusy, setError, actionBusy, checkingStatus });
  const refreshRuntime = useCallback(async () => {
    const revision = ++runtimeReadRevision.current;
    const epoch = readEpoch.current;
    setReadingRuntime(true);
    const [accountResult, accountsResult] = await Promise.allSettled([
      invokeDesktop("chatgpt/account/read", {}),
      invokeDesktop("chatgpt/accounts/read", {}),
    ]);
    if (!mounted.current || revision !== runtimeReadRevision.current || epoch !== readEpoch.current)
      return;
    if (accountResult.status === "fulfilled") setAccount(accountResult.value);
    if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value);
    const failure = [accountResult, accountsResult].find((result) => result.status === "rejected");
    setRuntimeReadError(
      failure?.status === "rejected" ? normalizeDesktopError(failure.reason).detail : undefined,
    );
    setReadingRuntime(false);
  }, []);
  const load = useCallback(async () => {
    const revision = ++settingsReadRevision.current;
    const epoch = readEpoch.current;
    setLoading(true);
    try {
      const settings = adapter.available() ? await adapter.read() : undefined;
      if (
        !mounted.current ||
        revision !== settingsReadRevision.current ||
        epoch !== readEpoch.current
      )
        return;
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
      setSettingsReadError(undefined);
    } catch (cause) {
      if (
        mounted.current &&
        revision === settingsReadRevision.current &&
        epoch === readEpoch.current
      )
        setSettingsReadError(normalizeDesktopError(cause).detail);
    } finally {
      if (
        mounted.current &&
        revision === settingsReadRevision.current &&
        epoch === readEpoch.current
      )
        setLoading(false);
    }
  }, [adapter]);
  const checkStatus = useCallback(async () => {
    if (
      statusCheckPending.current ||
      actionBusy ||
      connectionBusy ||
      loginId ||
      integrationPending()
    )
      return;
    statusCheckPending.current = true;
    const revision = ++statusCheckRevision.current;
    const epoch = readEpoch.current;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setStatusCheckTimedOut(false);
    setCheckingStatus(true);
    try {
      const finished = await Promise.race([
        Promise.allSettled([
          connectionSettings.current?.refreshStatus(),
          refreshRuntime(),
          refreshIntegration(),
        ]).then(() => true),
        new Promise<false>((resolve) => {
          deadline = setTimeout(() => {
            resolve(false);
          }, 30_000);
        }),
      ]);
      if (
        !finished &&
        mounted.current &&
        epoch === readEpoch.current &&
        revision === statusCheckRevision.current
      ) {
        setStatusCheckTimedOut(true);
      }
    } finally {
      clearTimeout(deadline);
      if (
        mounted.current &&
        epoch === readEpoch.current &&
        revision === statusCheckRevision.current
      ) {
        statusCheckPending.current = false;
        setCheckingStatus(false);
      }
    }
  }, [actionBusy, connectionBusy, loginId, refreshRuntime, refreshIntegration, integrationPending]);
  useEffect(() => {
    mounted.current = true;
    statusCheckPending.current = false;
    const initialLoad = window.setTimeout(() => {
      setCheckingStatus(false);
      void load();
      void refreshRuntime();
      void refreshIntegration();
    }, 0);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        readEpoch.current = readEpoch.current + 1;
        settingsReadRevision.current = settingsReadRevision.current + 1;
        runtimeReadRevision.current = runtimeReadRevision.current + 1;
        resetIntegration();
        lastPersisted.current = undefined;
        statusCheckPending.current = false;
        setCheckingStatus(false);
        setPersisted(undefined);
        setDraft(undefined);
        setAccount(undefined);
        setAccounts(undefined);

        void load();
        void refreshRuntime();
        void refreshIntegration();
      } else if (
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
        void refreshRuntime();
      } else if (event.event === "state-invalidated" && event.scope === "settings") {
        void load();
        void connectionSettings.current?.refreshStatus();
      }
    });
    return () => {
      mounted.current = false;
      statusCheckRevision.current = statusCheckRevision.current + 1;
      statusCheckPending.current = false;
      readEpoch.current = readEpoch.current + 1;
      window.clearTimeout(initialLoad);
      unsubscribe();
    };
  }, [load, refreshRuntime, refreshIntegration, resetIntegration]);
  useEffect(() => {
    if (selectedTab !== "ai" && selectedTab !== "speech") return;
    const initial = window.setTimeout(() => void checkStatus(), 0);
    const onFocus = () => void checkStatus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
    };
  }, [selectedTab, checkStatus]);
  const dirty = useMemo(
    () =>
      Boolean(draft && persisted && JSON.stringify(draft) !== JSON.stringify(persisted.settings)),
    [draft, persisted],
  );
  const save = async () => {
    if (!draft || !persisted || !dirty) return;
    settingsReadRevision.current = settingsReadRevision.current + 1;
    setLoading(false);
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await adapter.update(persisted.updatedAt, draft);
      lastPersisted.current = next;
      setPersisted(next);
      setDraft(next.settings);
      await i18n.changeLanguage(next.settings.uiLocale);
      notify({ message: "settings.saved", tone: "success" });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const selectTarget = async (targetLanguage: Language) => {
    if (!persisted || !draft || busy) return;
    settingsReadRevision.current = settingsReadRevision.current + 1;
    setLoading(false);
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
      notify({ message: "settings.languageSelected", tone: "success" });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const login = async () => {
    if (busy || loginId) return;
    runtimeReadRevision.current = runtimeReadRevision.current + 1;
    setReadingRuntime(false);
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("chatgpt/account/login/start", {
        uiLocale: i18n.language as Language,
        registrationId:
          accounts?.state.status === "unavailable"
            ? null
            : (selectedRegistration ?? accounts?.selectedId) || null,
      });
      setLoginId(result.loginId);
      setNotice("settings.loginStarted");
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    if (busy || loginId) return;
    runtimeReadRevision.current = runtimeReadRevision.current + 1;
    setReadingRuntime(false);
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setAccount(await invokeDesktop("chatgpt/account/logout", {}));
      void refreshRuntime();
      notify({ message: "settings.loggedOut", tone: "success" });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
      void refreshRuntime();
    } finally {
      setBusy(false);
    }
  };
  const cancelLogin = async () => {
    if (busy || !loginId) return;
    runtimeReadRevision.current = runtimeReadRevision.current + 1;
    setReadingRuntime(false);
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

  const chooseDataRoot = async () => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await invokeDesktop("data-root/choose", {
        uiLocale: i18n.language as Language,
        ...(persisted ? { expectedGeneration: persisted.dataRoot.generation } : {}),
      });
      if (result.status === "selected") setDataRootSelection(result);
      else setNotice("settings.dataSwitchCancelled");
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

  const runtimeFailure = runtimeReadError && (
    <OperationError error={runtimeReadError}>
      <Button
        variant="secondary"
        isPending={readingRuntime}
        isDisabled={busy || Boolean(loginId)}
        onPress={() => void refreshRuntime()}
      >
        {t("actions.retry")}
      </Button>
    </OperationError>
  );
  const integrationReadFailure = integrationReadError && (
    <OperationError error={integrationReadError}>
      <Button
        variant="secondary"
        isPending={readingIntegration}
        isDisabled={busy}
        onPress={() => void refreshIntegration()}
      >
        {t("actions.retry")}
      </Button>
    </OperationError>
  );
  return {
    persisted,
    loading,
    busy,
    dirty,
    connectionPending,
    loginId,
    onRunSetup,
    t,
    error,
    settingsReadError,
    load,
    notice: notice ? t(notice) : undefined,
    selectedTab,
    onTabChange,
    draft,
    selectTarget,
    setDraft,
    checkingStatus,
    actionBusy,
    connectionBusy,
    checkStatus,
    runtimeFailure,
    statusCheckTimedOut,
    connectionSettings,
    account,
    setConnectionPending,
    setConnectionBusy,
    login,
    cancelLogin,
    accounts,
    setError,
    setAccountOptionsOpen,
    accountOptionsOpen,
    selectedRegistration,
    setSelectedRegistration,
    logout,
    integrationOpen,
    integrationReadFailure,
    integration,
    manageIntegration,
    setIntegrationOpen,
    integrationFailure,
    integrationNotice,
    setFolderOpen,
    folderOpen,
    readiness,
    dataRootSelection,
    chooseDataRoot,
    confirmDataRoot,
    setDataRootSelection,
    technicalOpen,
    diagnosticsFailure,
    readDiagnostics,
    diagnostics,
    exportDiagnostics,
    setTechnicalOpen,
    clearLogs,
    save,
  };
}
