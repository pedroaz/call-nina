import { useCallback, useEffect, useRef, useState } from "react";
import {
  utcInstantSchema,
  type DesktopIpcResponse,
  type CallNinaError,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import {
  Button,
  DiagnosticCode,
  Feedback,
  FieldGroup,
  LoadingState,
} from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import type { DesktopSettingsResult, DesktopSettingsValue } from "./settings-adapter.js";
import i18n from "./i18n.js";
import styles from "./ProfileOnboarding.module.css";

type Readiness = Extract<DesktopIpcResponse, { status: "ok"; channel: "app/readiness" }>["result"];
type Account = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "codex/account/read" }
>["result"];
type LoginId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "codex/account/login/start" }
>["result"]["loginId"];
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
    uiLocale: i18n.resolvedLanguage === "de" ? "de" : "en-US",
  });
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
  const [loginId, setLoginId] = useState<LoginId>();
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
      const state = await invokeDesktop("app/readiness", {});
      setIntegration(state.codex);
      setAccount(await invokeDesktop("codex/account/read", {}));
      setConnectionFailed(false);
    } catch (cause) {
      setConnectionFailed(true);
      throw cause;
    } finally {
      setChecking(false);
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
        await i18n.changeLanguage(settings.settings.uiLocale);
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setLoading(false);
    }
    // Provider inspection is optional; local setup never waits for authentication.
    void refreshConnection().catch(() => undefined);
  }, [refreshConnection]);
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
        if (event.event === "state-invalidated" && event.scope === "account")
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
  const save = async (): Promise<DesktopSettingsResult | undefined> => {
    if (!generation || !choices.everydayLifeGoal.trim()) return persisted;
    let current = persisted;
    if (!current) {
      await invokeDesktop("learner-profile/start-onboarding", {
        targetLanguage: "de",
        ...choices,
        everydayLifeGoal: choices.everydayLifeGoal.trim(),
        expectedGeneration: generation,
        placement: { status: "skipped" },
      });
      current = await invokeDesktop("learner-settings/read", {});
    } else if (
      Object.entries(choices).some(
        ([key, value]) => current?.settings[key as keyof Choices] !== value,
      )
    ) {
      // Preserve all settings outside this wizard and let the backend reject a stale timestamp.
      current = await invokeDesktop("learner-settings/update", {
        expectedUpdatedAt: current.updatedAt,
        settings: {
          ...current.settings,
          ...choices,
          everydayLifeGoal: choices.everydayLifeGoal.trim(),
        },
      });
    }
    setPersisted(current);
    await i18n.changeLanguage(choices.uiLocale);
    return current;
  };
  const move = (destination: number) =>
    void attempt(async () => {
      if (step === 1 && !choices.everydayLifeGoal.trim()) {
        if (destination > step) return;
        setNotice(t("onboarding.unsavedGoal"));
      } else await save();
      setStep(destination);
    });
  const exit = () =>
    void attempt(async () => {
      if (choices.everydayLifeGoal.trim()) await save();
      onExit?.();
    });
  const finish = () =>
    void attempt(async () => {
      const current = await save();
      if (!current || !generation) return;
      await invokeDesktop("learner-profile/finish-onboarding", {
        expectedGeneration: generation,
        expectedUpdatedAt: utcInstantSchema.parse(current.updatedAt),
      });
      onComplete();
    });
  const connect = (method: "browser" | "device-code") =>
    void attempt(async () => {
      const result = await invokeDesktop("codex/account/login/start", { method });
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
  const connected =
    !connectionFailed && integration.status === "available" && account.status === "signed-in";
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
          <p>
            {connectionFailed
              ? t("onboarding.checkFailed")
              : integration.status === "unavailable"
                ? t(`onboarding.runtime.${integration.reason}`)
                : accountSummary}
          </p>
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
    <div className={styles.app}>
      <div className={styles.topActions}>
        <Button
          isDisabled={busy || loading}
          onPress={() => {
            const locale = choices.uiLocale === "en-US" ? "de" : "en-US";
            change("uiLocale", locale);
            void i18n.changeLanguage(locale);
          }}
        >
          {choices.uiLocale === "en-US" ? "Deutsch" : "English"}
        </Button>
      </div>
      <main className={styles.startup}>
        <section
          className={`${styles.startupCard} ${styles.onboardingCard}`}
          aria-labelledby="setup-title"
        >
          <p className={styles.eyebrow}>
            {t("onboarding.progress", { current: step + 1, total: steps.length })}
          </p>
          <h1 id="setup-title" ref={heading} tabIndex={-1}>
            {t(`onboarding.steps.${steps[step] ?? "connection"}`)}
          </h1>
          <p>{t(`onboarding.guidance.${steps[step] ?? "connection"}`)}</p>
          {step === 0 && (
            <p>
              {t("onboarding.selectedFolder", {
                folder: readiness.dataRoot.status === "ready" ? readiness.dataRoot.displayName : "",
              })}
            </p>
          )}
          {step === 0 && onExit && <small>{t("onboarding.folderSettings")}</small>}
          {loading ? (
            <LoadingState live>{t("startup.loading")}</LoadingState>
          ) : (
            <>
              {step === 0 && (
                <fieldset disabled={busy} className={styles.onboardingSection}>
                  <legend>{t("onboarding.accountTitle")}</legend>
                  <p>{t("providerAccess.identityBoundary")}</p>
                  {connectionStatus}
                  {loginStatus && <p role="status">{t(`onboarding.login.${loginStatus}`)}</p>}
                  <ActionGroup>
                    {account.status !== "signed-in" &&
                      integration.status === "available" &&
                      !loginId && (
                        <>
                          <Button
                            isDisabled={busy}
                            onPress={() => {
                              connect("browser");
                            }}
                          >
                            {t("onboarding.connectBrowser")}
                          </Button>
                          <Button
                            isDisabled={busy}
                            onPress={() => {
                              connect("device-code");
                            }}
                          >
                            {t("onboarding.connectDevice")}
                          </Button>
                        </>
                      )}
                    {loginId && (
                      <Button
                        isDisabled={busy}
                        onPress={() =>
                          void attempt(async () => {
                            if (!loginId) return;
                            await invokeDesktop("codex/account/login/cancel", { loginId });
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
                <fieldset disabled={busy} className={styles.onboardingSection}>
                  <legend>{t("onboarding.pluginTitle")}</legend>
                  <p>{t(`onboarding.plugin.${integration.plugin}`)}</p>
                  <p>{t("onboarding.pluginOptional")}</p>
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
                </fieldset>
              )}
              {step === 1 && (
                <fieldset disabled={busy} className={styles.onboardingSection}>
                  <legend>{t("onboarding.startTitle")}</legend>
                  <FieldGroup>
                    <span>{t("onboarding.level")}</span>
                    <select
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
                    </select>
                  </FieldGroup>
                  <p>{t("onboarding.levelHint")}</p>
                  <FieldGroup>
                    <span>{t("onboarding.goal")}</span>
                    <textarea
                      aria-label={t("onboarding.goal")}
                      required
                      maxLength={500}
                      rows={4}
                      value={choices.everydayLifeGoal}
                      onChange={(event) => {
                        change("everydayLifeGoal", event.currentTarget.value);
                      }}
                    />
                    <small>{t("onboarding.goalHint")}</small>
                  </FieldGroup>
                  {!choices.everydayLifeGoal.trim() && <p>{t("onboarding.goalRequired")}</p>}
                </fieldset>
              )}
              {step === 2 && (
                <fieldset disabled={busy} className={styles.onboardingSection}>
                  <legend>{t("onboarding.teachingTitle")}</legend>
                  <FieldGroup>
                    <span>{t("onboarding.teachingTitle")}</span>
                    <select
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
                    </select>
                  </FieldGroup>
                  <p>{t(`onboarding.profiles.${choices.defaultTeachingProfileId}.body`)}</p>
                  <FieldGroup>
                    <span>{t("onboarding.explanationLanguage")}</span>
                    <select
                      aria-label={t("onboarding.explanationLanguage")}
                      value={choices.explanationLanguage}
                      onChange={(event) => {
                        change("explanationLanguage", event.currentTarget.value as "en-US" | "de");
                      }}
                    >
                      {["en-US", "de"].map((language) => (
                        <option key={language} value={language}>
                          {t(`onboarding.languages.${language}`)}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>
                  <FieldGroup>
                    <span>{t("onboarding.interfaceLanguage")}</span>
                    <select
                      aria-label={t("onboarding.interfaceLanguage")}
                      value={choices.uiLocale}
                      onChange={(event) => {
                        const locale = event.currentTarget.value as "en-US" | "de";
                        change("uiLocale", locale);
                        void i18n.changeLanguage(locale);
                      }}
                    >
                      {["en-US", "de"].map((language) => (
                        <option key={language} value={language}>
                          {t(`onboarding.languages.${language}`)}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>
                  <p>{t("onboarding.localeIndependent")}</p>
                </fieldset>
              )}
              {step === 3 && (
                <fieldset disabled={busy} className={styles.onboardingSection}>
                  <legend>{t("onboarding.steps.review")}</legend>
                  {connectionStatus}
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
                    {t(
                      `onboarding.languages.${choices.explanationLanguage === "en-US" ? "en" : choices.explanationLanguage}`,
                    )}
                  </p>
                  <p>
                    {t("onboarding.interfaceLanguage")}:{" "}
                    {t(
                      `onboarding.languages.${choices.uiLocale === "en-US" ? "en" : choices.uiLocale}`,
                    )}
                  </p>
                  {!connected && (
                    <Button
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
                    isDisabled={busy || (step === 1 && !choices.everydayLifeGoal.trim())}
                    onPress={() => {
                      move(step + 1);
                    }}
                  >
                    {t("onboarding.next")}
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
                  <Button isDisabled={busy} onPress={exit}>
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
                isDisabled={busy}
                onPress={() => {
                  setError(undefined);
                  void load();
                }}
              >
                {t("onboarding.reloadSaved")}
              </Button>
              {onExit && (
                <Button variant="secondary" isDisabled={busy} onPress={onExit}>
                  {t("onboarding.leaveUnsaved")}
                </Button>
              )}
            </Feedback>
          )}
        </section>
      </main>
    </div>
  );
}
