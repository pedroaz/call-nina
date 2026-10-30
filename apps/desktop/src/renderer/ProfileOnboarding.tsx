import { OperationError } from "./OperationError.js";
import { useCallback, useEffect, useState } from "react";
import {
  languageDefinitions,
  languageIds,
  utcInstantSchema,
  type Language,
  type DesktopIpcResponse,
  type CallNinaError,
  type CourseUnit,
} from "@call-nina/contracts";
import { courseActivityStatus } from "@call-nina/domain";
import { ArrowRight, BookOpen, MessageCircle, Plane, Briefcase, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  LoadingState,
  TextField,
  TextAreaField,
  SelectControl,
} from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { type LearningChoices } from "./LearningProfileFields.js";
import { ConnectionSettings } from "./ConnectionSettings.js";
import { OnboardingConnections } from "./OnboardingConnections.js";
import { InterviewLayout, InterviewProgress, InterviewChoices } from "@call-nina/browser-ui";
import ninaWelcome from "@call-nina/design-system/brand/nina-welcome.png";
import ninaListening from "@call-nina/design-system/brand/nina-listening.png";
import ninaThinking from "@call-nina/design-system/brand/nina-thinking.png";
import ninaCelebration from "@call-nina/design-system/brand/nina-celebration.png";
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
  const [goalChoice, setGoalChoice] = useState("everyday");
  const [customGoal, setCustomGoal] = useState("");
  const [explanationTouched, setExplanationTouched] = useState(false);
  const initialLocale = (
    i18n.resolvedLanguage === "en" ? "en-US" : (i18n.resolvedLanguage ?? "en-US")
  ) as Language;
  const [persisted, setPersisted] = useState<DesktopSettingsResult>();
  const [choices, setChoices] = useState<LearningChoices>({
    learnerName: "",
    approximateLevel: "a2",
    everydayLifeGoal: t("setupUx.goals.everyday"),
    defaultTeachingProfileId: "conversation-partner",
    explanationLanguage: initialLocale,
    uiLocale: initialLocale,
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
        setCustomGoal(next.settings.everydayLifeGoal);
        setTargetLanguage(next.settings.learningScope.targetLanguage);
        setEnrollCourse(Boolean(next.settings.learningScope.courseId));
        await i18n.changeLanguage(next.settings.uiLocale);
        setGoalChoice(
          ["everyday", "travel", "work"].find(
            (goal) => next.settings.everydayLifeGoal === i18n.t(`setupUx.goals.${goal}`),
          ) ?? "custom",
        );
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
      setCustomGoal(next.settings.everydayLifeGoal);
      setTargetLanguage(language);
      setGoalChoice(
        ["everyday", "travel", "work"].find(
          (goal) => next.settings.everydayLifeGoal === i18n.t(`setupUx.goals.${goal}`),
        ) ?? "custom",
      );
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
      if (connectionPending || (next > step && step === 2 && !choices.everydayLifeGoal.trim()))
        return;
      await cancelLogin();
      if (step >= 4 || persisted) await save();
      if (next === 6) await readCatalog();
      setStep(next);
    });
  const finish = (destination?: PathDestination) =>
    void attempt(async () => {
      if (connectionPending) return;
      await cancelLogin();
      let current = await save();
      if (!current || !generation) return;
      if (destination && !current.settings.learningScope.courseId) {
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
    "nameTitle",
    "languageTitle",
    "goalTitle",
    "levelTitle",
    "explanationTitle",
    "connectionTitle",
    "lessonTitle",
  ];
  const languageOptions = languageIds.map((language) => ({
    value: language,
    label: t(`languages.${language}`),
  }));
  const goalOptions = [
    { value: "everyday", label: t("interview.goals.everyday"), icon: <MessageCircle /> },
    { value: "travel", label: t("interview.goals.travel"), icon: <Plane /> },
    { value: "work", label: t("interview.goals.work"), icon: <Briefcase /> },
    { value: "custom", label: t("interview.goals.custom"), icon: <Pencil /> },
  ];
  const pose =
    step === 6
      ? "celebration"
      : step === 2
        ? (
            {
              everyday: "listening",
              travel: "welcome",
              work: "thinking",
              custom: "thinking",
            } as const
          )[goalChoice as "everyday" | "travel" | "work" | "custom"]
        : step === 0
          ? "welcome"
          : step === 5
            ? "listening"
            : "thinking";
  const blocked = busy || connectionPending;
  const continueDisabled = blocked || (step === 2 && !choices.everydayLifeGoal.trim());
  const complete = () => finish();
  const back = (
    <div>
      {step > 0 && (
        <Button variant="quiet" isDisabled={blocked} onPress={() => move(step - 1)}>
          {t("onboarding.back")}
        </Button>
      )}
      {onExit && step === 0 && (
        <Button
          variant="quiet"
          isDisabled={blocked}
          onPress={() =>
            void attempt(async () => {
              await cancelLogin();
              if (choices.everydayLifeGoal.trim()) await save();
              onExit();
            })
          }
        >
          {t("interview.goHome")}
        </Button>
      )}
    </div>
  );
  return (
    <main className={styles.app}>
      {loading ? (
        <LoadingState live>{t("startup.loading")}</LoadingState>
      ) : (
        <InterviewLayout
          focusKey={step}
          onContinue={step === 5 ? undefined : step === 6 ? complete : () => move(step + 1)}
          continueDisabled={continueDisabled}
          title={t(
            `interview.${step === 6 && choices.learnerName.trim() ? "lessonTitleNamed" : titles[step]}`,
            { language: t(`languages.${targetLanguage}`), name: choices.learnerName },
          )}
          description={step === 5 ? t("interview.connectionDescription") : undefined}
          toolbar={
            <>
              <span className={styles.brand}>{t("app.name")}</span>
              <SelectControl
                aria-label={t("onboarding.interfaceLanguage")}
                value={choices.uiLocale}
                disabled={blocked}
                onChange={(event) => {
                  change("uiLocale", event.target.value as Language);
                  if (!persisted && !explanationTouched)
                    change("explanationLanguage", event.target.value as Language);
                  void i18n.changeLanguage(event.target.value);
                }}
              >
                {languageIds
                  .filter((language) => languageDefinitions[language])
                  .map((language) => (
                    <option key={language} value={language}>
                      {languageDefinitions[language].name}
                    </option>
                  ))}
              </SelectControl>
            </>
          }
          progress={
            <InterviewProgress
              current={step + 1}
              total={7}
              label={t("onboarding.progress", { current: step + 1, total: 7 })}
            />
          }
          artwork={
            <img
              src={
                {
                  welcome: ninaWelcome,
                  listening: ninaListening,
                  thinking: ninaThinking,
                  celebration: ninaCelebration,
                }[pose]
              }
              alt=""
              width={320}
              height={320}
            />
          }
          context={
            step === 6 ? (
              <p>
                {t(`languages.${targetLanguage}`)} ·{" "}
                {t(`setupUx.levels.${choices.approximateLevel}`)}
              </p>
            ) : undefined
          }
          actions={
            <>
              {back}
              <div>
                {step === 0 && (
                  <Button
                    variant="quiet"
                    isDisabled={blocked}
                    onPress={() => {
                      change("learnerName", "");
                      setStep(1);
                    }}
                  >
                    {t("interview.skipName")}
                  </Button>
                )}
                {step === 5 ? (
                  <Button variant="quiet" isDisabled={blocked} onPress={() => move(6)}>
                    {t("interview.setupLater")}
                  </Button>
                ) : step === 6 ? (
                  <>
                    {!onExit && first && (
                      <Button
                        variant="quiet"
                        isDisabled={blocked}
                        onPress={() => finish({ kind: "library" })}
                      >
                        {t("pathLibrary.title")}
                      </Button>
                    )}
                    <Button
                      isDisabled={blocked}
                      trailingIcon={<ArrowRight aria-hidden="true" />}
                      onPress={complete}
                    >
                      {t("interview.goHome")}
                    </Button>
                  </>
                ) : (
                  <Button
                    trailingIcon={<ArrowRight aria-hidden="true" />}
                    isDisabled={continueDisabled}
                    onPress={() => move(step + 1)}
                  >
                    {t("interview.continue")}
                  </Button>
                )}
              </div>
            </>
          }
        >
          {step === 0 && (
            <TextField
              label={t("interview.nameLabel")}
              placeholder={t("interview.namePlaceholder")}
              value={choices.learnerName}
              maxLength={100}
              autoComplete="given-name"
              disabled={blocked}
              onChange={(event) => change("learnerName", event.target.value)}
            />
          )}
          {step === 1 && (
            <InterviewChoices
              label={t("onboarding.targetLanguage")}
              value={targetLanguage}
              options={languageOptions}
              disabled={blocked}
              onChange={(value) => selectTarget(value as Language)}
            />
          )}
          {step === 2 && (
            <>
              <InterviewChoices
                label={t("onboarding.goal")}
                value={goalChoice}
                options={goalOptions}
                disabled={blocked}
                onChange={(goal) => {
                  setGoalChoice(goal);
                  if (goal !== "custom") change("everydayLifeGoal", t(`setupUx.goals.${goal}`));
                  else change("everydayLifeGoal", customGoal);
                }}
              />
              {goalChoice === "custom" && (
                <TextAreaField
                  label={t("setupUx.customGoal")}
                  value={choices.everydayLifeGoal}
                  maxLength={500}
                  rows={3}
                  disabled={blocked}
                  onChange={(event) => {
                    setCustomGoal(event.target.value);
                    change("everydayLifeGoal", event.target.value);
                  }}
                />
              )}
            </>
          )}
          {step === 3 && (
            <InterviewChoices
              label={t("onboarding.level")}
              value={choices.approximateLevel}
              disabled={blocked}
              options={(["a1", "a2", "b1", "b2"] as const).map((level) => ({
                value: level,
                label: t(`interview.levels.${level}`),
                description: t(`setupUx.levels.${level}`),
              }))}
              onChange={(value) =>
                change("approximateLevel", value as LearningChoices["approximateLevel"])
              }
            />
          )}
          {step === 4 && (
            <InterviewChoices
              label={t("onboarding.explanationLanguage")}
              value={choices.explanationLanguage}
              options={languageOptions}
              disabled={blocked}
              onChange={(value) => {
                setExplanationTouched(true);
                change("explanationLanguage", value as Language);
              }}
            />
          )}
          {step === 5 && (
            <>
              <ConnectionSettings
                active
                disabled={busy}
                onBusyChange={setConnectionPending}
                chatgptConnected={account?.status === "signed-in"}
                overview={(props) => (
                  <OnboardingConnections
                    {...props}
                    chatgptConnected={account?.status === "signed-in"}
                    onUse={() => move(6)}
                  />
                )}
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
            </>
          )}
          {step === 6 && (
            <>
              {first ? (
                <div className={styles.lesson}>
                  <BookOpen aria-hidden="true" />
                  <div>
                    <h2>{first.title[locale]}</h2>
                    <p>{first.scenario[locale]}</p>
                    <Button
                      className={styles.lessonAction}
                      variant="secondary"
                      isDisabled={blocked}
                      trailingIcon={<ArrowRight aria-hidden="true" />}
                      onPress={() =>
                        finish({ kind: "lesson", unitId: first.id, stage: first.stage })
                      }
                    >
                      {t("interview.goToExercise")}
                    </Button>
                  </div>
                </div>
              ) : (
                <p>{t(catalogError ? "setupUx.catalogFailed" : "setupUx.exploreFirst")}</p>
              )}
              {catalogError && (
                <Button variant="secondary" onPress={() => void attempt(readCatalog)}>
                  {t("actions.retry")}
                </Button>
              )}
            </>
          )}
          {error && (
            <OperationError error={error}>
              <Button variant="secondary" onPress={() => void load()}>
                {t("onboarding.reloadSaved")}
              </Button>
            </OperationError>
          )}
        </InterviewLayout>
      )}
    </main>
  );
}
