import { AnalyticsPrivacyDetails } from "../../learning/privacy/UsageAnalytics.js";
import { InterviewChoices, InterviewLayout, InterviewProgress } from "@call-nina/browser-ui";
import { languageDefinitions, languageIds, type Language } from "@call-nina/contracts";
import ninaCelebration from "@call-nina/design-system/brand/nina-celebration.png";
import ninaListening from "@call-nina/design-system/brand/nina-listening.png";
import ninaThinking from "@call-nina/design-system/brand/nina-thinking.png";
import ninaWelcome from "@call-nina/design-system/brand/nina-welcome.png";
import { ArrowRight, BookOpen } from "lucide-react";
import { useRef, useState } from "react";
import { ActionGroup } from "../../components/layout/index.js";
import {
  Button,
  LoadingState,
  SelectControl,
  SwitchField,
  TextAreaField,
  TextField,
} from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { type LearningChoices } from "../../learning/profile/LearningProfileFields.js";
import { ConnectionSettings } from "../../learning/providers/ConnectionSettings.js";
import i18n from "../../runtime/i18n.js";
import { invokeDesktop } from "../../runtime/ipc.js";
import { OnboardingConnections } from "./OnboardingConnections.js";
import styles from "./ProfileOnboarding.module.css";
import { type ProfileOnboardingProps } from "./ProfileOnboarding.types.js";

import { useProfileOnboardingController } from "./useProfileOnboardingController.js";

export function ProfileOnboarding(props: ProfileOnboardingProps) {
  const model = useProfileOnboardingController(props);
  const [connectionReady, setConnectionReady] = useState(false);
  const connectionContinuation = useRef<(() => Promise<boolean>) | null>(null);
  const {
    loading,
    includeConsent,
    analyticsConsent,
    chooseAnalytics,
    t,
    step,
    complete,
    move,
    continueDisabled,
    choices,
    titles,
    targetLanguage,
    blocked,
    change,
    persisted,
    explanationTouched,
    pose,
    back,
    setStep,
    onExit,
    first,
    finish,
    languageOptions,
    selectTarget,
    goalChoice,
    goalOptions,
    setGoalChoice,
    customGoal,
    setCustomGoal,
    setExplanationTouched,
    busy,
    setConnectionPending,
    account,
    loginId,
    attempt,
    cancelLogin,
    setLoginId,
    locale,
    catalogError,
    readCatalog,
    error,
    load,
  } = model;
  return (
    <main className={styles.app}>
      {loading ? (
        <LoadingState live>{t("startup.loading")}</LoadingState>
      ) : (
        <InterviewLayout
          focusKey={step}
          onContinue={
            step === 5 || step === 6
              ? undefined
              : step === 7
                ? complete
                : () => {
                    move(step + 1);
                  }
          }
          continueDisabled={continueDisabled}
          title={t(
            `interview.${step === 7 && choices.learnerName.trim() ? "lessonTitleNamed" : (titles[step] ?? "nameTitle")}`,
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
                {languageIds.map((language) => (
                  <option key={language} value={language}>
                    {languageDefinitions[language].name}
                  </option>
                ))}
              </SelectControl>
            </>
          }
          progress={
            <InterviewProgress
              current={step + 1 - (!includeConsent && step === 7 ? 1 : 0)}
              total={includeConsent ? 8 : 7}
              label={t("onboarding.progress", {
                current: step + 1 - (!includeConsent && step === 7 ? 1 : 0),
                total: includeConsent ? 8 : 7,
              })}
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
            step === 7 ? (
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
                  <Button
                    variant={connectionReady ? "primary" : "quiet"}
                    isDisabled={blocked}
                    onPress={() => {
                      if (!connectionReady) move(6);
                      else
                        void connectionContinuation.current?.().then((saved) => {
                          if (saved) move(6);
                        });
                    }}
                  >
                    {t(connectionReady ? "actions.continue" : "interview.setupLater")}
                  </Button>
                ) : step === 6 ? (
                  <Button
                    isDisabled={blocked}
                    onPress={() => {
                      chooseAnalytics(analyticsConsent === "enabled", true);
                    }}
                  >
                    {t("actions.continue")}
                  </Button>
                ) : step === 7 ? (
                  <>
                    {!onExit && first && (
                      <Button
                        variant="quiet"
                        isDisabled={blocked}
                        onPress={() => {
                          finish({ kind: "library" });
                        }}
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
                    onPress={() => {
                      move(step + 1);
                    }}
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
              onChange={(event) => {
                change("learnerName", event.target.value);
              }}
            />
          )}
          {step === 1 && (
            <InterviewChoices
              label={t("onboarding.targetLanguage")}
              value={targetLanguage}
              options={languageOptions}
              disabled={blocked}
              onChange={(value) => {
                selectTarget(value as Language);
              }}
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
              onChange={(value) => {
                change("approximateLevel", value as LearningChoices["approximateLevel"]);
              }}
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
                    onReadyChange={setConnectionReady}
                    continuationRef={connectionContinuation}
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
                                uiLocale: choices.uiLocale,
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
              <SwitchField
                isSelected={analyticsConsent === "enabled"}
                isDisabled={blocked}
                onChange={(enabled) => {
                  chooseAnalytics(enabled);
                }}
              >
                {t("usageAnalytics.share")}
              </SwitchField>
              <p>{t("usageAnalytics.description")}</p>
              <p>{t("usageAnalytics.anonymous")}</p>
              <AnalyticsPrivacyDetails />
            </>
          )}
          {step === 7 && (
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
                      onPress={() => {
                        finish({ kind: "lesson", unitId: first.id, stage: first.stage });
                      }}
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
