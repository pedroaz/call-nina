import { SettingsRow } from "./SettingsRow.js";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type { Language } from "@call-nina/contracts";
import type { DesktopSettingsValue } from "./settings-adapter.js";
import { LanguageSelect } from "./LanguageSelect.js";
import { Button, ModalDialog, SelectField, TextAreaField } from "./components/ui/index.js";
import { Section } from "./components/layout/index.js";
import styles from "./SettingsPage.module.css";

export type LearningChoices = Pick<
  DesktopSettingsValue,
  | "approximateLevel"
  | "everydayLifeGoal"
  | "defaultTeachingProfileId"
  | "explanationLanguage"
  | "uiLocale"
>;

export function LearningProfileFields({
  value,
  language,
  disabled,
  onboarding = false,
  onLanguage,
  onChange,
}: {
  value: LearningChoices;
  language: Language;
  disabled: boolean;
  onboarding?: boolean;
  onLanguage: (language: Language) => void;
  onChange: <K extends keyof LearningChoices>(key: K, value: LearningChoices[K]) => void;
}) {
  const { t } = useTranslation();
  const goals = ["everyday", "travel", "work"] as const;
  const preset = goals.find((goal) => value.everydayLifeGoal === t(`setupUx.goals.${goal}`));
  const [custom, setCustom] = useState(false);
  const [preferences, setPreferences] = useState(false);
  return (
    <>
      <Section {...(onboarding ? {} : { title: t("setupUx.yourLearning") })}>
        <div className={styles.settingsControls}>
          <LanguageSelect
            label={t("onboarding.targetLanguage")}
            value={language}
            disabled={disabled}
            onChange={onLanguage}
          />
          <SelectField
            label={t("onboarding.level")}
            value={value.approximateLevel}
            disabled={disabled}
            onChange={(event) => {
              onChange(
                "approximateLevel",
                event.target.value as LearningChoices["approximateLevel"],
              );
            }}
          >
            {(["a1", "a2", "b1", "b2"] as const).map((level) => (
              <option key={level} value={level}>
                {t(`setupUx.levels.${level}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            className={onboarding ? undefined : styles.learningGoal}
            label={t("onboarding.goal")}
            value={custom || !preset ? "custom" : preset}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              setCustom(next === "custom");
              if (next !== "custom") onChange("everydayLifeGoal", t(`setupUx.goals.${next}`));
            }}
          >
            {goals.map((goal) => (
              <option key={goal} value={goal}>
                {t(`setupUx.goals.${goal}`)}
              </option>
            ))}
            <option value="custom">{t("setupUx.customGoal")}</option>
          </SelectField>
          {(custom || !preset) && (
            <TextAreaField
              className={onboarding ? undefined : styles.learningGoal}
              label={t("setupUx.customGoal")}
              value={value.everydayLifeGoal}
              disabled={disabled}
              rows={2}
              maxLength={500}
              onChange={(event) => {
                onChange("everydayLifeGoal", event.target.value);
              }}
            />
          )}
        </div>
      </Section>
      <Section title={t("setupUx.languages")}>
        <div className={styles.settingsControls}>
          <LanguageSelect
            label={t("onboarding.explanationLanguage")}
            value={value.explanationLanguage}
            disabled={disabled}
            onChange={(next) => {
              onChange("explanationLanguage", next);
            }}
          />
          {!onboarding && (
            <LanguageSelect
              label={t("settings.uiLocale")}
              value={value.uiLocale}
              interfaceOnly
              disabled={disabled}
              onChange={(next) => {
                onChange("uiLocale", next);
              }}
            />
          )}
        </div>
      </Section>
      <SettingsRow
        title={t("setupUx.learningPreferences")}
        action={
          <Button
            variant="quiet"
            onPress={() => {
              setPreferences(true);
            }}
          >
            {t("setupUx.change")}
          </Button>
        }
      >
        <span>{t(`onboarding.profiles.${value.defaultTeachingProfileId}.title`)}</span>
      </SettingsRow>
      <ModalDialog
        closeLabel={t("actions.close")}
        isOpen={preferences}
        title={t("setupUx.learningPreferences")}
        onOpenChange={setPreferences}
      >
        <SelectField
          label={t("settings.teachingProfile")}
          value={value.defaultTeachingProfileId}
          disabled={disabled}
          onChange={(event) => {
            onChange(
              "defaultTeachingProfileId",
              event.target.value as LearningChoices["defaultTeachingProfileId"],
            );
          }}
        >
          <option value="conversation-partner">
            {t("onboarding.profiles.conversation-partner.title")}
          </option>
          <option value="strict-corrector">
            {t("onboarding.profiles.strict-corrector.title")}
          </option>
        </SelectField>
      </ModalDialog>
    </>
  );
}
