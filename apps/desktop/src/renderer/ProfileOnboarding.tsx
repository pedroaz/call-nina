import startupStyles from "./Startup.module.css";
import { Disclosure } from "./components/ui/Disclosure.js";
import { Nina } from "./components/ui/Nina.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  languageDefinitions,
  type Language,
  utcInstantSchema,
  type DesktopIpcResponse,
  type CallNinaError,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import {
  SelectControl,
  Button,
  Card,
  CheckboxField,
  DiagnosticCode,
  Feedback,
  FieldGroup,
  LoadingState,
  TextAreaField,
} from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import type { DesktopSettingsResult, DesktopSettingsValue } from "./settings-adapter.js";
import i18n from "./i18n.js";
import styles from "./ProfileOnboarding.module.css";
import { ConnectionSettings } from "./ConnectionSettings.js";
import { LanguageSelect } from "./LanguageSelect.js";

type Readiness = Extract<DesktopIpcResponse, { status: "ok"; channel: "app/readiness" }>["result"];
type Account = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/read" }
>["result"];
type LoginId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/login/start" }
>["result"]["loginId"];
type Connections = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "ai-connections/read" }
>["result"];
type Choices = Pick<
  DesktopSettingsValue,
  | "approximateLevel"
  | "everydayLifeGoal"
  | "defaultTeachingProfileId"
  | "explanationLanguage"
  | "uiLocale"
>;
const steps = ["connection", "goal", "defaults", "review"] as const;

export function ProfileOnboarding({
  readiness,
  onComplete,
  onExit,
}: {
  readiness: Readiness;
  onComplete: () => void;
  onExit?: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const [persisted, setPersisted] = useState<DesktopSettingsResult>();
  const [choices, setChoices] = useState<Choices>({
    approximateLevel: "a2",
    everydayLifeGoal: "",
    defaultTeachingProfileId: "conversation-partner",
    explanationLanguage: "en-US",
    uiLocale: (i18n.resolvedLanguage ?? "en-US") as Language,
  });
  const [targetLanguage, setTargetLanguage] = useState<Language>("de");
  const [enrollCourse, setEnrollCourse] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [notice, setNotice] = useState<string>();
  const [account, setAccount] = useState<Account>({
    status: "unavailable",
    reason: "runtime-not-ready",
  });
  const [checking, setChecking] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [integration, setIntegration] = useState(readiness.codex);
  const [connections, setConnections] = useState<Connections>();
  const [loginId, setLoginId] = useState<LoginId>();
  const [connectionPending, setConnectionPending] = useState(false);
  const [loginStatus, setLoginStatus] = useState<string>();
  const generation =
    readiness.dataRoot.status === "ready" ? readiness.dataRoot.generation : undefined;

  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const refreshConnection = useCallback(async () => {
    setChecking(true);
    try {
      const [accountState, connectionState] = await Promise.all([
        invokeDesktop("chatgpt/account/read", {}),
        invokeDesktop("ai-connections/read", {}),
      ]);
      setAccount(accountState);
      if (accountState.status === "signed-in") {
        setLoginStatus(undefined);
        setLoginId(undefined);
      }
      setConnections(connectionState);
      setConnectionFailed(false);
    } catch (cause) {
      setConnectionFailed(true);
      throw cause;
    } finally {
      setChecking(false);
    }
  }, []);
  const refreshExternalIntegration = useCallback(async () => {
    try {
      setIntegration(await invokeDesktop("codex/integration/read", {}));
    } catch {
      // The optional external Voice/plugin installation is independent of setup.
    }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await invokeDesktop("learner-profile/read", {});
      if (profile.status === "ready") {
        const settings = await invokeDesktop("learner-settings/read", {});
        setPersisted(settings);
        setChoices(settings.settings);
        setTargetLanguage(settings.settings.learningScope.targetLanguage);
        setEnrollCourse(Boolean(settings.settings.learningScope.courseId));
        await i18n.changeLanguage(settings.settings.uiLocale);
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setLoading(false);
    }
    // Provider inspection is optional; local setup never waits for authentication.
    void refreshConnection().catch(() => undefined);
    void refreshExternalIntegration();
  }, [refreshConnection, refreshExternalIntegration]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    if (!loading) heading.current?.focus();
  }, [step, loading]);
  useEffect(
    () =>
      subscribeDesktop((event) => {
        if (event.event === "data-root-changed") {
          window.location.reload();
          return;
        }
        if (
          event.event === "state-invalidated" &&
          ["account", "settings", "ai-connections"].includes(event.scope)
        )
          void refreshConnection().catch((cause: unknown) => {
            setError(normalizeDesktopError(cause).detail);
          });
        if (event.event === "account-login" && event.loginId === loginId) {
          setLoginStatus(event.state.status);
          if (event.state.status === "failed") setError(event.state.error);
          if (["complete", "failed", "cancelled"].includes(event.state.status)) {
            setLoginId(undefined);
            void refreshConnection().catch((cause: unknown) => {
              setError(normalizeDesktopError(cause).detail);
            });
          }
        }
      }),
    [loginId, refreshConnection],
  );

  const change = <K extends keyof Choices>(key: K, value: Choices[K]) => {
    setChoices((current) => ({ ...current, [key]: value }));
  };
  const selectTarget = (language: Language) => {
    if (!persisted) {
      setTargetLanguage(language);
      setEnrollCourse(false);
      return;
    }
    void attempt(async () => {
      const saved = await save();
      if (!saved) return;
      const next = await invokeDesktop("learner-settings/select-language", {
        expectedGeneration: saved.dataRoot.generation,
        targetLanguage: language,
      });
      setPersisted(next);
      setChoices(next.settings);
      setTargetLanguage(next.settings.learningScope.targetLanguage);
      setEnrollCourse(Boolean(next.settings.learningScope.courseId));
    });
  };
  async function save(): Promise<DesktopSettingsResult | undefined> {
    if (!generation || !choices.everydayLifeGoal.trim()) return persisted;
    let current = persisted;
    if (!current) {
      await invokeDesktop("learner-profile/start-onboarding", {
        targetLanguage,
        ...choices,
        everydayLifeGoal: choices.everydayLifeGoal.trim(),
        expectedGeneration: generation,
        placement: { status: "skipped" },
      });
      current = await invokeDesktop("learner-settings/read", {});
    }
    const saved = current;
    if (
      Object.entries(choices).some(
        ([key, value]) => saved.settings[key as keyof Choices] !== value,
      ) ||
      enrollCourse !== Boolean(saved.settings.learningScope.courseId)
    ) {
      // Preserve all settings outside this wizard and let the backend reject a stale timestamp.
      current = await invokeDesktop("learner-settings/update", {
        expectedUpdatedAt: current.updatedAt,
        settings: {
          ...current.settings,
          ...choices,
          everydayLifeGoal: choices.everydayLifeGoal.trim(),
          learningScope: {
            ...current.settings.learningScope,
            courseId: enrollCourse ? languageDefinitions[targetLanguage].structuredCourseId : null,
          },
        },
      });
    }
    setPersisted(current);
    await i18n.changeLanguage(choices.uiLocale);
    return current;
  }
  const cancelPendingLogin = async () => {
    if (!loginId) return;
    await invokeDesktop("chatgpt/account/login/cancel", { loginId });
    setLoginId(undefined);
    setLoginStatus("cancelled");
  };
  const move = (destination: number) =>
    void attempt(async () => {
      if (connectionPending) return;
      if (step === 0) await cancelPendingLogin();
      if (step === 1 && !choices.everydayLifeGoal.trim()) {
        if (destination > step) return;
        setNotice(t("onboarding.unsavedGoal"));
      } else await save();
      setStep(destination);
    });
  const exit = () =>
    void attempt(async () => {
      if (connectionPending) return;
      await cancelPendingLogin();
      if (choices.everydayLifeGoal.trim()) await save();
      onExit?.();
    });
  const finish = () =>
    void attempt(async () => {
      if (connectionPending) return;
      await cancelPendingLogin();
      const current = await save();
      if (!current || !generation) return;
      await invokeDesktop("learner-profile/finish-onboarding", {
        expectedGeneration: generation,
        expectedUpdatedAt: utcInstantSchema.parse(current.updatedAt),
      });
      onComplete();
    });
  const connect = () =>
    void attempt(async () => {
      const result = await invokeDesktop("chatgpt/account/login/start", {
        registrationId: (await invokeDesktop("chatgpt/accounts/read", {})).selectedId,
      });
      setLoginId(result.loginId);
      setLoginStatus("waiting");
    });
  const accountSummary =
    account.status === "signed-in"
      ? t("onboarding.accountConnected", { plan: account.planType ?? t("onboarding.planUnknown") })
      : account.status === "expired"
        ? t("onboarding.accountExpired")
        : account.status === "signed-out"
          ? t("onboarding.accountSignedOut")
          : account.status === "unsupported"
            ? t("onboarding.accountUnsupported")
            : t("onboarding.accountUnavailable");
  const activeRoute = connections?.settings.connections.find(
    (entry) => entry.id === connections.settings.activeConnectionId,
  )?.routeId;
  const activeConnection = connections?.availability.find(
    (entry) => entry.connectionId === connections.settings.activeConnectionId,
  );
  const connected = !connectionFailed && activeConnection?.status === "available";
  const connectionStatus = (
    <Feedback
      className={styles.connectionStatus}
      live="polite"
      tone={checking ? "info" : connected ? "success" : "warning"}
    >
      <strong>
        {t(
          checking
            ? "onboarding.checking"
            : connected
              ? "onboarding.connected"
              : "onboarding.connectionNeeded",
        )}
      </strong>
      {!checking && (
        <>
          {!connected && (
            <p>
              {connectionFailed
                ? t("onboarding.checkFailed")
                : !connections?.settings.activeConnectionId
                  ? t("providerAccess.reasons.connection-required")
                  : activeRoute === "chatgpt" && account.status !== "signed-in"
                    ? accountSummary
                    : t(
                        `connectionSettings.status.${activeConnection?.status ?? "runtime-unavailable"}`,
                      )}
            </p>
          )}
          <p>
            {t(
              connected
                ? step === 3
                  ? "onboarding.readyToFinish"
                  : "onboarding.readyToContinue"
                : "onboarding.connectionOptional",
            )}
          </p>
          {connectionChecked && !connectionFailed && <p>{t("onboarding.checkComplete")}</p>}
        </>
      )}
    </Feedback>
  );
  return (
    <div className={startupStyles.app}>
      <div className={startupStyles.topActions}>
        <LanguageSelect
          label={t("onboarding.interfaceLanguage")}
          value={choices.uiLocale}
          interfaceOnly
          disabled={busy || loading}
          onChange={(locale) => {
            change("uiLocale", locale);
            void i18n.changeLanguage(locale);
          }}
        />
      </div>
      <main className={startupStyles.startup}>
        <Card
          as="section"
          className={`${startupStyles.startupCard} ${styles.onboardingCard}`}
          aria-labelledby="setup-title"
        >
          <p className={styles.eyebrow}>
            {t("onboarding.progress", { current: step + 1, total: steps.length })}
          </p>
          <div className={styles.heading}>
            <h1 id="setup-title" ref={heading} tabIndex={-1}>
              {t(`onboarding.steps.${steps[step] ?? "connection"}`)}
            </h1>
            <Nina />
          </div>
          <p>{t(`onboarding.guidance.${steps[step] ?? "connection"}`)}</p>
          {loading ? (
            <LoadingState live>{t("startup.loading")}</LoadingState>
          ) : (
            <>
              <div hidden={step !== 0}>
                <Disclosure
                  className={styles.accessOptions}
                  variant="plain"
                  label={<> {t("onboarding.accessOptions")} </>}
                >
                  <p>{t("onboarding.accessIntro")}</p>
                  <ConnectionSettings
                    active={step === 0}
                    disabled={busy || Boolean(loginId)}
                    onPendingChange={setConnectionPending}
                    authHelp={t("onboarding.chatgptAuthHelp")}
                  />
                </Disclosure>
                {connectionPending && (
                  <Feedback live="polite">{t("onboarding.connectionDraft")}</Feedback>
                )}
              </div>
              {step === 0 && (
                <fieldset disabled={busy} className={styles.onboardingSection}>
                  <legend>{t("onboarding.accountTitle")}</legend>
                  <p>{t("providerAccess.identityBoundary")}</p>

                  {connectionStatus}
                  {loginStatus && account.status !== "signed-in" && (
                    <p role="status">{t(`onboarding.login.${loginStatus}`)}</p>
                  )}
                  <ActionGroup>
                    {account.status !== "signed-in" && !loginId && (
                      <>
                        <Button
                          variant="primary"
                          isDisabled={busy || connectionPending || account.status === "unavailable"}
                          onPress={() => {
                            connect();
                          }}
                        >
                          {t("onboarding.connectBrowser")}
                        </Button>
                      </>
                    )}
                    {loginId && (
                      <Button
                        variant="primary"
                        isDisabled={busy}
                        onPress={() =>
                          void attempt(async () => {
                            if (!loginId) return;
                            await invokeDesktop("chatgpt/account/login/cancel", { loginId });
                            setLoginId(undefined);
                            setLoginStatus("cancelled");
                          })
                        }
                      >
                        {t("onboarding.cancelLogin")}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      isDisabled={busy || checking}
                      onPress={() =>
                        void attempt(async () => {
                          setConnectionChecked(false);
                          await refreshConnection();
                          setConnectionChecked(true);
                        })
                      }
                    >
                      {t(checking ? "onboarding.checking" : "onboarding.checkConnection")}
                    </Button>
                  </ActionGroup>
                </fieldset>
              )}
              {step === 0 && integration.status === "available" && (
                <Disclosure
                  className={styles.accessOptions}
                  variant="plain"
                  label={<> {t("onboarding.pluginTitle")} </>}
                >
                  <p>{t("settings.externalIntegrationHelp")}</p>
                  <p>{t(`onboarding.plugin.${integration.plugin}`)}</p>
                  {integration.plugin !== "installed" && (
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() =>
                        void attempt(async () => {
                          const result = await invokeDesktop("codex/integration/action", {
                            action: integration.plugin === "not-installed" ? "install" : "refresh",
                          });
                          setIntegration(result.status);
                          setNotice(
                            t(
                              result.result === "failed"
                                ? "settings.plugin.actionFailed"
                                : "onboarding.pluginReady",
                            ),
                          );
                        })
                      }
                    >
                      {t(
                        `onboarding.pluginActions.${integration.plugin === "not-installed" ? "install" : "refresh"}`,
                      )}
                    </Button>
                  )}
                </Disclosure>
              )}
              {step === 0 && integration.status === "unavailable" && (
                <p>{t("settings.codexUnavailable")}</p>
              )}
              {step === 1 && (
                <fieldset disabled={busy} className={styles.onboardingSection}>
                  <legend>{t("onboarding.startTitle")}</legend>
                  <LanguageSelect
                    label={t("onboarding.targetLanguage")}
                    value={targetLanguage}
                    disabled={busy}
                    onChange={selectTarget}
                  />
                  {
                    <CheckboxField
                      checked={enrollCourse}
                      onChange={(event) => {
                        setEnrollCourse(event.currentTarget.checked);
                      }}
                    >
                      {t("onboarding.enrollCourse")}
                    </CheckboxField>
                  }
                  <FieldGroup>
                    <span>{t("onboarding.level")}</span>
                    <SelectControl
                      aria-label={t("onboarding.level")}
                      value={choices.approximateLevel}
                      onChange={(event) => {
                        change(
                          "approximateLevel",
                          event.currentTarget.value as Choices["approximateLevel"],
                        );
                      }}
                    >
                      {(["a1", "a2", "b1", "b2"] as const).map((level) => (
                        <option key={level} value={level}>
                          {level.toUpperCase()}
                        </option>
                      ))}
                    </SelectControl>
                  </FieldGroup>
                  <p>{t("onboarding.levelHint")}</p>
                  <TextAreaField
                    label={t("onboarding.goal")}
                    aria-label={t("onboarding.goal")}
                    description={t("onboarding.goalHint")}
                    error={
                      choices.everydayLifeGoal.trim() ? undefined : t("onboarding.goalRequired")
                    }
                    required
                    maxLength={500}
                    rows={4}
                    value={choices.everydayLifeGoal}
                    onChange={(event) => {
                      change("everydayLifeGoal", event.currentTarget.value);
                    }}
                  />
                </fieldset>
              )}
              {step === 2 && (
                <fieldset
                  disabled={busy}
                  className={styles.onboardingSection}
                  aria-labelledby="setup-title"
                >
                  <FieldGroup>
                    <span>{t("onboarding.teachingTitle")}</span>
                    <SelectControl
                      aria-label={t("onboarding.teachingTitle")}
                      value={choices.defaultTeachingProfileId}
                      onChange={(event) => {
                        change(
                          "defaultTeachingProfileId",
                          event.currentTarget.value as Choices["defaultTeachingProfileId"],
                        );
                      }}
                    >
                      {(["conversation-partner", "strict-corrector"] as const).map((style) => (
                        <option key={style} value={style}>
                          {t(`onboarding.profiles.${style}.title`)}
                        </option>
                      ))}
                    </SelectControl>
                  </FieldGroup>
                  <p>{t(`onboarding.profiles.${choices.defaultTeachingProfileId}.body`)}</p>
                  <LanguageSelect
                    label={t("onboarding.explanationLanguage")}
                    value={choices.explanationLanguage}
                    disabled={busy}
                    onChange={(language) => {
                      change("explanationLanguage", language);
                    }}
                  />
                  <p>{t("onboarding.localeIndependent")}</p>
                </fieldset>
              )}
              {step === 3 && (
                <fieldset
                  disabled={busy}
                  className={styles.onboardingSection}
                  aria-labelledby="setup-title"
                >
                  {connectionStatus}
                  <p>
                    <strong>{t("onboarding.targetLanguage")}: </strong>
                    {t(`languages.${targetLanguage}`)}
                  </p>
                  <p>
                    <strong>{t("onboarding.level")}: </strong>
                    {choices.approximateLevel.toUpperCase()}
                  </p>
                  <p>
                    <strong>{t("onboarding.goal")}: </strong>
                    {choices.everydayLifeGoal}
                  </p>
                  <p>{t(`onboarding.profiles.${choices.defaultTeachingProfileId}.title`)}</p>
                  <p>
                    {t("onboarding.explanationLanguage")}:{" "}
                    {t(`languages.${choices.explanationLanguage}`)}
                  </p>
                  <p>
                    {t("onboarding.interfaceLanguage")}: {t(`languages.${choices.uiLocale}`)}
                  </p>
                  {!connected && (
                    <Button
                      variant="primary"
                      isDisabled={busy || checking}
                      onPress={() => {
                        move(0);
                      }}
                    >
                      {t("onboarding.returnConnection")}
                    </Button>
                  )}
                </fieldset>
              )}
              <ActionGroup>
                {step > 0 && (
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => {
                      move(step - 1);
                    }}
                  >
                    {t("onboarding.back")}
                  </Button>
                )}
                {step < 3 ? (
                  <Button
                    variant="primary"
                    isDisabled={
                      busy || connectionPending || (step === 1 && !choices.everydayLifeGoal.trim())
                    }
                    onPress={() => {
                      move(step + 1);
                    }}
                  >
                    {t(
                      step === 0 && !connections?.settings.activeConnectionId
                        ? "onboarding.skipAccess"
                        : "onboarding.next",
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    isDisabled={busy || !choices.everydayLifeGoal.trim()}
                    onPress={finish}
                  >
                    {t("onboarding.finish")}
                  </Button>
                )}
                {onExit && (
                  <Button variant="secondary" isDisabled={busy || connectionPending} onPress={exit}>
                    {t("onboarding.returnSettings")}
                  </Button>
                )}
              </ActionGroup>
            </>
          )}
          {notice && <Feedback live="polite">{notice}</Feedback>}
          {error && (
            <Feedback live="assertive" tone="error">
              <p>{t(error.messageKey)}</p>
              <DiagnosticCode>
                {error.reference.code} · {error.reference.correlationId}
              </DiagnosticCode>
              <Button
                variant="primary"
                isDisabled={busy || connectionPending}
                onPress={() => {
                  setError(undefined);
                  void load();
                }}
              >
                {t("onboarding.reloadSaved")}
              </Button>
              {onExit && (
                <Button variant="secondary" isDisabled={busy || connectionPending} onPress={exit}>
                  {t("onboarding.leaveUnsaved")}
                </Button>
              )}
            </Feedback>
          )}
        </Card>
      </main>
    </div>
  );
}
