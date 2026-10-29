import { useCallback, useEffect, useRef, useState } from "react";
import {
  languageDefinitions,
  utcInstantSchema,
  type Language,
  type DesktopIpcResponse,
  type CallNinaError,
  type CourseUnit,
} from "@call-nina/contracts";
import { courseActivityStatus } from "@call-nina/domain";
import { ArrowRight, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Feedback, LoadingState, Card } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { LearningProfileFields, type LearningChoices } from "./LearningProfileFields.js";
import { ConnectionSettings } from "./ConnectionSettings.js";
import { SpeechSettings } from "./SpeechSettings.js";
import { Nina } from "./components/ui/Nina.js";
import { LanguageSelect } from "./LanguageSelect.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import type { DesktopSettingsResult } from "./settings-adapter.js";
import type { PathDestination } from "./learningPathNavigation.js";
import type { LearningPathSnapshot } from "./useLearningPath.js";
import i18n from "./i18n.js";
import styles from "./ProfileOnboarding.module.css";

type Readiness = Extract<DesktopIpcResponse, { status: "ok"; channel: "app/readiness" }>["result"];
type Account = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/read" }
>["result"];
type LoginId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/login/start" }
>["result"]["loginId"];
export function ProfileOnboarding({
  readiness,
  onComplete,
  onExit,
}: {
  readiness: Readiness;
  onComplete: (destination?: PathDestination) => void;
  onExit?: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const [persisted, setPersisted] = useState<DesktopSettingsResult>();
  const [choices, setChoices] = useState<LearningChoices>({
    approximateLevel: "a2",
    everydayLifeGoal: t("setupUx.goals.everyday"),
    defaultTeachingProfileId: "conversation-partner",
    explanationLanguage: "en-US",
    uiLocale: (i18n.resolvedLanguage ?? "en-US") as Language,
  });
  const [targetLanguage, setTargetLanguage] = useState<Language>("de");
  const [enrollCourse, setEnrollCourse] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [connectionPending, setConnectionPending] = useState(false);
  const [account, setAccount] = useState<Account>();
  const [loginId, setLoginId] = useState<LoginId>();
  const [catalog, setCatalog] = useState<LearningPathSnapshot>();
  const [catalogError, setCatalogError] = useState(false);
  const generation =
    readiness.dataRoot.status === "ready" ? readiness.dataRoot.generation : undefined;
  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await invokeDesktop("learner-profile/read", {});
      if (profile.status === "ready") {
        const next = await invokeDesktop("learner-settings/read", {});
        setPersisted(next);
        setChoices(next.settings);
        setTargetLanguage(next.settings.learningScope.targetLanguage);
        setEnrollCourse(Boolean(next.settings.learningScope.courseId));
        await i18n.changeLanguage(next.settings.uiLocale);
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    if (!loading) heading.current?.focus();
  }, [step, loading]);
  useEffect(() => {
    const refresh = () =>
      void invokeDesktop("chatgpt/account/read", {})
        .then(setAccount)
        .catch(() => undefined);
    refresh();
    return subscribeDesktop((event) => {
      if (event.event === "data-root-changed") window.location.reload();
      if (event.event === "state-invalidated" && event.scope === "account") refresh();
      if (event.event === "account-login" && event.loginId === loginId) {
        if (event.state.status === "failed") setError(event.state.error);
        if (["complete", "failed", "cancelled"].includes(event.state.status)) {
          setLoginId(undefined);
          refresh();
        }
      }
    });
  }, [loginId]);
  const change = <K extends keyof LearningChoices>(key: K, value: LearningChoices[K]) => {
    setChoices((current) => ({ ...current, [key]: value }));
  };
  const selectTarget = (language: Language) => {
    if (!persisted) {
      setTargetLanguage(language);
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
      setTargetLanguage(language);
      setEnrollCourse(Boolean(next.settings.learningScope.courseId));
      setCatalog(undefined);
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
        ([key, value]) => saved.settings[key as keyof LearningChoices] !== value,
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
  const cancelLogin = async () => {
    if (loginId) {
      await invokeDesktop("chatgpt/account/login/cancel", { loginId });
      setLoginId(undefined);
    }
  };
  const readCatalog = async () => {
    setCatalogError(false);
    try {
      setCatalog(await invokeDesktop("learning-path/read", {}));
    } catch {
      setCatalogError(true);
    }
  };
  const move = (next: number) =>
    void attempt(async () => {
      if (connectionPending || !choices.everydayLifeGoal.trim()) return;
      await cancelLogin();
      await save();
      if (next === 2) await readCatalog();
      setStep(next);
    });
  const finish = (destination?: PathDestination) =>
    void attempt(async () => {
      if (connectionPending) return;
      await cancelLogin();
      let current = await save();
      if (!current || !generation) return;
      if (destination && !onExit && !current.settings.learningScope.courseId) {
        current = await invokeDesktop("learner-settings/update", {
          expectedUpdatedAt: current.updatedAt,
          settings: {
            ...current.settings,
            learningScope: {
              ...current.settings.learningScope,
              courseId: languageDefinitions[targetLanguage].structuredCourseId,
            },
          },
        });
      }
      await invokeDesktop("learner-profile/finish-onboarding", {
        expectedGeneration: generation,
        expectedUpdatedAt: utcInstantSchema.parse(current.updatedAt),
      });
      onComplete(destination);
    });
  const course = catalog?.course;
  const eligible =
    course?.units.filter(
      (unit) =>
        unit.kind !== "launchpad" &&
        unit.activities.some((activity) =>
          ["explanation", "reading", "practice"].includes(activity.delivery),
        ) &&
        unit.prerequisites.every((id) => {
          const prerequisite = course.units.find((entry) => entry.id === id);
          return prerequisite?.activities.every(
            (activity) =>
              catalog !== undefined &&
              courseActivityStatus(catalog.state, {
                version: course.version,
                unitId: id,
                activityKey: activity.id,
                mode: "course",
              }) === "completed",
          );
        }),
    ) ?? [];
  const first: CourseUnit | undefined =
    eligible.find(
      (unit) =>
        course?.paths.find((path) => path.id === unit.stage)?.level.toLowerCase() ===
        choices.approximateLevel,
    ) ?? eligible[0];
  const locale = choices.uiLocale === "en-US" ? "en" : choices.uiLocale;
  const titles = [
    "setupUx.onboardingProfile",
    "setupUx.onboardingOptional",
    "setupUx.onboardingLesson",
  ];
  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <span className={styles.brand}>{t("app.name")}</span>
        <LanguageSelect
          label={t("onboarding.interfaceLanguage")}
          value={choices.uiLocale}
          interfaceOnly
          disabled={busy || loading}
          onChange={(language) => {
            change("uiLocale", language);
            void i18n.changeLanguage(language);
          }}
        />
      </header>
      <main className={styles.content}>
        <p className={styles.progress}>
          {t("onboarding.progress", { current: step + 1, total: onExit ? 2 : 3 })}
        </p>
        <div className={styles.heading}>
          <h1 ref={heading} tabIndex={-1} data-focus-anchor>
            {t(titles[step] ?? "onboarding.title")}
          </h1>
          {step === 2 && <Nina />}
        </div>
        {loading ? (
          <LoadingState live>{t("startup.loading")}</LoadingState>
        ) : (
          <>
            {step === 0 && (
              <LearningProfileFields
                value={choices}
                language={targetLanguage}
                disabled={busy}
                onboarding
                onLanguage={selectTarget}
                onChange={change}
              />
            )}
            <div hidden={step !== 1} className={styles.options}>
              <p>{t("setupUx.optionalLater")}</p>
              <ConnectionSettings
                active={step === 1}
                disabled={busy}
                onPendingChange={setConnectionPending}
                chatgptConnected={account?.status === "signed-in"}
                chatgptAccess={() => (
                  <div className={styles.options}>
                    <p role="status">
                      {account
                        ? t(`settings.account.${account.status}`)
                        : t("settings.notReported")}
                    </p>
                    {loginId ? (
                      <ActionGroup>
                        <span role="status">{t("onboarding.login.waiting")}</span>
                        <Button variant="secondary" onPress={() => void attempt(cancelLogin)}>
                          {t("onboarding.cancelLogin")}
                        </Button>
                      </ActionGroup>
                    ) : (
                      account?.status !== "signed-in" && (
                        <Button
                          variant="primary"
                          isDisabled={busy || !account || account.status === "unavailable"}
                          onPress={() =>
                            void attempt(async () => {
                              const result = await invokeDesktop("chatgpt/account/login/start", {
                                registrationId: (await invokeDesktop("chatgpt/accounts/read", {}))
                                  .selectedId,
                              });
                              setLoginId(result.loginId);
                            })
                          }
                        >
                          {t("settings.login")}
                        </Button>
                      )
                    )}
                  </div>
                )}
              />
              <SpeechSettings language={targetLanguage} />
            </div>
            {step === 2 && (
              <div className={styles.options}>
                <div className={styles.summary}>
                  <span>
                    {t(`languages.${targetLanguage}`)} ·{" "}
                    {t(`setupUx.levels.${choices.approximateLevel}`)}
                  </span>
                  <Button
                    variant="quiet"
                    onPress={() => {
                      move(0);
                    }}
                  >
                    {t("setupUx.edit")}
                  </Button>
                </div>
                {first ? (
                  <Card variant="muted" className={styles.lesson}>
                    <BookOpen aria-hidden="true" />
                    <div>
                      <h2>{first.title[locale]}</h2>
                      <p>{first.scenario[locale]}</p>
                    </div>
                  </Card>
                ) : (
                  <p>{t(catalogError ? "setupUx.catalogFailed" : "setupUx.exploreFirst")}</p>
                )}
                {catalogError && (
                  <Button variant="secondary" onPress={() => void attempt(readCatalog)}>
                    {t("actions.retry")}
                  </Button>
                )}
              </div>
            )}
            {connectionPending && (
              <Feedback live="polite">{t("onboarding.connectionDraft")}</Feedback>
            )}
            <footer className={styles.footer}>
              <ActionGroup>
                {step > 0 && (
                  <Button
                    variant="secondary"
                    isDisabled={busy || connectionPending}
                    onPress={() => {
                      move(step - 1);
                    }}
                  >
                    {t("onboarding.back")}
                  </Button>
                )}
                {onExit && step === 0 && (
                  <Button
                    variant="quiet"
                    isDisabled={busy || connectionPending}
                    onPress={() =>
                      void attempt(async () => {
                        await cancelLogin();
                        if (choices.everydayLifeGoal.trim()) await save();
                        onExit();
                      })
                    }
                  >
                    {t("onboarding.returnSettings")}
                  </Button>
                )}
              </ActionGroup>
              {onExit && step === 1 ? (
                <Button
                  variant="primary"
                  isDisabled={busy || connectionPending}
                  onPress={() => {
                    finish();
                  }}
                >
                  {t("onboarding.returnSettings")}
                </Button>
              ) : step < 2 ? (
                <Button
                  variant="primary"
                  trailingIcon={<ArrowRight aria-hidden="true" />}
                  isDisabled={busy || connectionPending || !choices.everydayLifeGoal.trim()}
                  onPress={() => {
                    move(step + 1);
                  }}
                >
                  {t(step === 1 ? "setupUx.continueLearning" : "onboarding.next")}
                </Button>
              ) : (
                <div className={styles.finish}>
                  <Button
                    variant="primary"
                    isDisabled={busy || connectionPending}
                    trailingIcon={<ArrowRight aria-hidden="true" />}
                    onPress={() => {
                      finish(
                        first
                          ? { kind: "lesson", unitId: first.id, stage: first.stage }
                          : { kind: "library" },
                      );
                    }}
                  >
                    {t(
                      onExit
                        ? "onboarding.returnSettings"
                        : first
                          ? "setupUx.openLesson"
                          : "pathLibrary.title",
                    )}
                  </Button>
                  {!onExit && first && (
                    <Button
                      variant="quiet"
                      isDisabled={busy}
                      onPress={() => {
                        finish({ kind: "library" });
                      }}
                    >
                      {t("pathLibrary.title")}
                    </Button>
                  )}
                </div>
              )}
            </footer>
          </>
        )}
        {error && (
          <Feedback tone="error" live="assertive">
            <p>{t(error.messageKey)}</p>
            <Button variant="secondary" onPress={() => void load()}>
              {t("onboarding.reloadSaved")}
            </Button>
          </Feedback>
        )}
      </main>
    </div>
  );
}
