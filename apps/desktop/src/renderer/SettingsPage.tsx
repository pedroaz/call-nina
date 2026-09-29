import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopIpcResponse, CallNinaError } from "@call-nina/contracts";
import {
  defaultModelPreferences,
  modelWorkloads,
  resolveModelPreference,
  type ModelPreferences,
  type ModelWorkload,
} from "@call-nina/domain";
import { RotateCcw, Save, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Tabs,
  InfoHint,
  DiagnosticCode,
  Button,
  Feedback,
  FieldGroup,
  LoadingState,
  ItemList,
  Muted,
} from "./components/ui/index.js";
import { ActionGroup, Page } from "./components/layout/index.js";

import styles from "./SettingsPage.module.css";
import i18n from "./i18n.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import {
  desktopSettingsAdapter,
  replaceWorkloadPreference,
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
  { status: "ok"; channel: "codex/account/read" }
>["result"];
type Catalog = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "codex/models/read" }
>["result"];
type Limits = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "codex/rate-limits/read" }
>["result"];
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

function modelValue(preference: ModelPreferences[ModelWorkload]): string {
  return preference.model.mode === "automatic" ? "automatic" : `exact:${preference.model.modelId}`;
}

export function SettingsPage({
  readiness,
  onRunSetup,
  onOpenPersonalData,
  selectedTab,
  onTabChange,
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
  adapter?: DesktopSettingsAdapter;
  onDataRootChanged?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [account, setAccount] = useState<Account>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [limits, setLimits] = useState<Limits>();
  const [persisted, setPersisted] = useState<DesktopSettingsResult>();
  const [draft, setDraft] = useState<DesktopSettingsValue>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
    const [accountResult, catalogResult, limitsResult] = await Promise.allSettled([
      invokeDesktop("codex/account/read", {}),
      invokeDesktop("codex/models/read", {}),
      invokeDesktop("codex/rate-limits/read", {}),
    ]);
    setAccount(
      accountResult.status === "fulfilled"
        ? accountResult.value
        : { status: "unavailable", reason: "runtime-not-ready" },
    );
    setCatalog(catalogResult.status === "fulfilled" ? catalogResult.value : undefined);
    setLimits(
      limitsResult.status === "fulfilled"
        ? limitsResult.value
        : { status: "unavailable", reason: "runtime-not-ready" },
    );
    const failure = [accountResult, catalogResult, limitsResult].find(
      (result) => result.status === "rejected",
    );
    if (failure?.status === "rejected") setError(normalizeDesktopError(failure.reason).detail);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    void refreshIntegration();
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
    void refreshRuntime();
  }, [adapter, refreshRuntime, refreshIntegration]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "account-login" &&
        ["complete", "cancelled", "failed"].includes(event.state.status)
      ) {
        void refreshRuntime();
      } else if (
        event.event === "state-invalidated" &&
        ["account", "models", "rate-limits"].includes(event.scope)
      ) {
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

  const login = async () => {
    setBusy(true);
    try {
      await invokeDesktop("codex/account/login/start", { method: "browser" });
      setNotice(t("settings.loginStarted"));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      setAccount(await invokeDesktop("codex/account/logout", {}));
      setLimits(undefined);
      setNotice(t("settings.loggedOut"));
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

  const setModel = (workload: ModelWorkload, value: string) => {
    if (!draft) return;
    const current = draft.modelPreferences[workload];
    const model =
      value === "automatic"
        ? { mode: "automatic" as const }
        : { mode: "exact" as const, modelId: value.slice(6) };
    setProfile(
      "modelPreferences",
      replaceWorkloadPreference(draft.modelPreferences, workload, { ...current, model }),
    );
  };

  const setEffort = (workload: ModelWorkload, value: string) => {
    if (!draft) return;
    const current = draft.modelPreferences[workload];
    const effort =
      value === "semantic:fast" || value === "semantic:balanced" || value === "semantic:deep"
        ? { mode: "semantic" as const, effort: value.slice(9) as "fast" | "balanced" | "deep" }
        : { mode: "exact" as const, effortId: value };
    setProfile(
      "modelPreferences",
      replaceWorkloadPreference(draft.modelPreferences, workload, { ...current, effort }),
    );
  };

  return (
    <Page
      className={styles.settingsPage}

      title={t("settings.title")}
      refresh={{ onRefresh: load, busy: loading || busy, disabled: dirty }}
    >
      <ActionGroup>
        <Button isDisabled={loading || busy || dirty} onPress={onRunSetup}>
          {t("onboarding.runAgain")}
        </Button>
        <Button
          variant="secondary"
          isDisabled={loading || busy || dirty}
          onPress={onOpenPersonalData}
        >
          {t("nav.personalData")}
        </Button>
        {dirty && <span>{t("onboarding.saveSettingsFirst")}</span>}
      </ActionGroup>
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
            children: (
              <>
                <Card as="section" aria-labelledby="settings-profile-title">
                  <h2 id="settings-profile-title">{t("settings.profileTitle")}</h2>
                  {!draft ? (
                    <Muted as="p">{t("settings.persistenceUnavailable")}</Muted>
                  ) : (
                    <div className={styles.settingsControls}>
                      <FieldGroup>
                        <span>{t("onboarding.level")}</span>
                        <select
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
                        </select>
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
                        <select
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
                        </select>
                      </FieldGroup>
                      <FieldGroup>
                        <span>{t("onboarding.explanationLanguage")}</span>
                        <select
                          value={draft.explanationLanguage}
                          onChange={(event) => {
                            setProfile(
                              "explanationLanguage",
                              event.currentTarget.value as "en" | "de",
                            );
                          }}
                        >
                          <option value="en">{t("onboarding.languages.en")}</option>
                          <option value="de">{t("onboarding.languages.de")}</option>
                        </select>
                      </FieldGroup>
                      <FieldGroup>
                        <span>{t("settings.uiLocale")}</span>
                        <select
                          aria-label={t("settings.uiLocale")}
                          value={draft.uiLocale}
                          onChange={(event) => {
                            setProfile("uiLocale", event.currentTarget.value as "en" | "de");
                          }}
                        >
                          <option value="en">English</option>
                          <option value="de">Deutsch</option>
                        </select>
                        <small>{t("settings.localeSeparate")}</small>
                      </FieldGroup>
                    </div>
                  )}
                </Card>
              </>
            ),
          },
          {
            id: "models",
            label: t("settings.tabs.models"),
            children: (
              <>
                <Card as="section" aria-labelledby="settings-models-title">
                  <h2 id="settings-models-title">{t("settings.modelsTitle")}</h2>
                  <p>{t("providerAccess.selectedRoute")}</p>
                  <p>{t("providerAccess.preferences")}</p>
                  {!draft ? (
                    <Muted as="p">{t("settings.persistenceUnavailable")}</Muted>
                  ) : (
                    modelWorkloads.map((workload) => {
                      const preference = draft.modelPreferences[workload];
                      const savedModelId =
                        preference.model.mode === "exact" ? preference.model.modelId : undefined;
                      const modelResolution = catalog
                        ? resolveModelPreference(workload, preference, catalog)
                        : undefined;
                      const effectiveModelId =
                        modelResolution && modelResolution.resolution.status !== "unavailable"
                          ? modelResolution.resolution.effectiveModelId
                          : undefined;
                      const automaticResolution = catalog
                        ? resolveModelPreference(
                            workload,
                            { ...preference, model: { mode: "automatic" } },
                            catalog,
                          ).resolution
                        : undefined;
                      const automaticModel =
                        automaticResolution && automaticResolution.status !== "unavailable"
                          ? catalog?.models.find(
                              ({ id }) => id === automaticResolution.effectiveModelId,
                            )
                          : undefined;
                      const selectedModel = effectiveModelId
                        ? catalog?.models.find(({ id }) => id === effectiveModelId)
                        : undefined;
                      const efforts = selectedModel?.supportedReasoningEfforts ?? [];
                      const resolvedEffortId =
                        modelResolution && modelResolution.resolution.status !== "unavailable"
                          ? modelResolution.resolution.effectiveEffortId
                          : undefined;
                      const unavailableModelId =
                        savedModelId && !catalog?.models.some(({ id }) => id === savedModelId)
                          ? savedModelId
                          : undefined;
                      const savedEffortId =
                        preference.effort.mode === "exact" ? preference.effort.effortId : undefined;
                      const unavailableEffortId =
                        savedEffortId && (!selectedModel || !efforts.includes(savedEffortId))
                          ? savedEffortId
                          : undefined;
                      return (
                        <fieldset
                          className={styles.modelRow}
                          key={workload}
                          data-workload={workload}
                          data-effective-model={effectiveModelId}
                          data-effective-effort={resolvedEffortId}
                          data-default-effort={selectedModel?.defaultReasoningEffort}
                        >
                          <legend>{t(`settings.workloads.${workload}`)}</legend>
                          <FieldGroup>
                            <span>{t("settings.model")}</span>
                            <select
                              value={modelValue(preference)}
                              onChange={(event) => {
                                setModel(workload, event.currentTarget.value);
                              }}
                            >
                              <option value="automatic">
                                {t("modelControl.automatic", {
                                  model: automaticModel?.displayName ?? t("settings.notReported"),
                                })}
                              </option>
                              {unavailableModelId ? (
                                <option value={`exact:${unavailableModelId}`}>
                                  {t("settings.unavailableSavedModel", {
                                    model: unavailableModelId,
                                  })}
                                </option>
                              ) : null}
                              {catalog?.models.map((model) => (
                                <option key={model.id} value={`exact:${model.id}`}>
                                  {model.displayName}
                                </option>
                              ))}
                            </select>
                          </FieldGroup>
                          <FieldGroup>
                            <span>{t("settings.effort")}</span>
                            <select
                              value={
                                preference.effort.mode === "semantic"
                                  ? `semantic:${preference.effort.effort}`
                                  : preference.effort.effortId
                              }
                              onChange={(event) => {
                                setEffort(workload, event.currentTarget.value);
                              }}
                            >
                              {(["fast", "balanced", "deep"] as const).map((effort) => (
                                <option key={effort} value={`semantic:${effort}`}>
                                  {t(`settings.semanticEfforts.${effort}`)}
                                </option>
                              ))}
                              {unavailableEffortId && (
                                <option value={unavailableEffortId}>
                                  {t("settings.unavailableSavedEffort", {
                                    effort: unavailableEffortId,
                                  })}
                                </option>
                              )}
                              {efforts.map((effort) => (
                                <option key={effort} value={effort}>
                                  {t(`settings.exactEfforts.${effort}`, { defaultValue: effort })}
                                </option>
                              ))}
                            </select>
                          </FieldGroup>
                          {modelResolution &&
                            modelResolution.resolution.status !== "unavailable" &&
                            modelResolution.resolution.unavailableAutomaticModelId && (
                              <Feedback live="off" tone="warning">
                                {t("settings.automaticFallback", {
                                  model: modelResolution.resolution.unavailableAutomaticModelId,
                                  effective: selectedModel?.displayName,
                                })}
                              </Feedback>
                            )}
                          {unavailableModelId || unavailableEffortId ? (
                            <Feedback live="off" tone="warning">
                              {t("settings.savedModelFallback")}
                            </Feedback>
                          ) : null}
                        </fieldset>
                      );
                    })
                  )}
                </Card>
              </>
            ),
          },
          {
            id: "account",
            label: t("settings.tabs.account"),
            children: (
              <>
                <Card as="section" aria-labelledby="settings-account-title">
                  <h2 id="settings-account-title">{t("settings.accountTitle")}</h2>
                  <p>{t("providerAccess.identityBoundary")}</p>
                  <p>{t("providerAccess.localAvailable")}</p>
                  <p>
                    {account ? t(`settings.account.${account.status}`) : t("settings.notReported")}
                  </p>
                  {account?.status === "signed-in" && account.planType && (
                    <p>{t("settings.plan", { plan: account.planType })}</p>
                  )}
                  <ActionGroup>
                    {account?.status === "signed-in" ? (
                      <Button isDisabled={busy} onPress={() => void logout()}>
                        {t("settings.logout")}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        isDisabled={busy || integration?.status !== "available"}
                        onPress={() => void login()}
                      >
                        <UserRound aria-hidden="true" />
                        {t("settings.login")}
                      </Button>
                    )}
                  </ActionGroup>
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
                            isDisabled={busy}
                            onPress={() => void manageIntegration("uninstall")}
                          >
                            {t("settings.plugin.actions.uninstall")}
                          </Button>
                        )}
                      </ActionGroup>
                    </>
                  )}
                </Card>
                <Card as="section" aria-labelledby="settings-limits-title">
                  <h2 id="settings-limits-title">{t("settings.limitsTitle")}</h2>
                  {limits && (limits.status === "available" || limits.status === "limited") ? (
                    <ItemList>
                      {limits.buckets.map((bucket) => (
                        <li key={bucket.limitId}>
                          <strong>{bucket.limitId}</strong>
                          {bucket.primary?.usedPercent == null
                            ? ""
                            : ` · ${String(bucket.primary.usedPercent)}%`}
                        </li>
                      ))}
                    </ItemList>
                  ) : (
                    <Muted as="p">{t("settings.notReported")}</Muted>
                  )}
                </Card>
              </>
            ),
          },
          {
            id: "data",
            label: t("settings.tabs.data"),
            children: (
              <>
                <Card as="section" aria-labelledby="settings-data-title">
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
                    <Button isDisabled={busy} onPress={() => void chooseDataRoot()}>
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
                </Card>
                <Card as="section" aria-labelledby="settings-privacy-title">
                  <h2 id="settings-privacy-title">{t("settings.privacyTitle")}</h2>
                  <p>
                    <strong>{t("folder.privacyTitle")}</strong> — {t("folder.privacyBody")}
                  </p>
                  <p>
                    <strong>{t("folder.cloudTitle")}</strong> — {t("folder.cloudBody")}
                  </p>
                </Card>
              </>
            ),
          },
          {
            id: "diagnostics",
            label: t("settings.tabs.diagnostics"),
            children: (
              <>
                <Card as="section" aria-labelledby="settings-diagnostics-title">
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
                    <Button isDisabled={busy} onPress={() => void readDiagnostics()}>
                      {t("settings.runDiagnostics")}
                    </Button>
                    <Button isDisabled={busy} onPress={() => void exportDiagnostics()}>
                      {t("settings.exportDiagnostics")}
                    </Button>
                    <Button isDisabled={busy} onPress={() => void clearLogs()}>
                      {t("settings.clearLogs")}
                    </Button>
                  </ActionGroup>
                </Card>
              </>
            ),
          },
        ]}
      />

      {draft && (selectedTab === "profile" || selectedTab === "models" || dirty) && (
        <div className={styles.settingsActions}>
          {selectedTab === "models" && (
            <Button
              isDisabled={busy}
              onPress={() => {
                setProfile("modelPreferences", defaultModelPreferences);
              }}
            >
              <RotateCcw aria-hidden="true" />
              {t("settings.restoreModels")}
            </Button>
          )}
          <Button
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
