import { Globe, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Language } from "@call-nina/contracts";
import { UtilityPopover } from "./components/ui/index.js";
import { LanguageSelect } from "./LanguageSelect.js";
import { InterfaceLanguage } from "./InterfaceLanguage.js";
import styles from "./SidebarLanguages.module.css";

export function SidebarLanguages({
  language,
  disabled,
  notice,
  collapsed,
  onLanguage,
}: {
  language: Language | undefined;
  disabled: boolean;
  notice?: string | undefined;
  collapsed: boolean;
  onLanguage: (language: Language) => void;
}) {
  const { t, i18n } = useTranslation();
  const interfaceLanguage = i18n.resolvedLanguage ?? "en-US";
  const summary = [language, interfaceLanguage]
    .filter((value) => value !== undefined)
    .map((value) => t(`languages.${value}`))
    .join(" · ");

  // Unmount the portal with its hidden trigger when navigation collapses.
  if (collapsed) return null;

  return (
    <UtilityPopover
      label={t("setupUx.languages")}
      triggerClassName={styles.trigger}
      placement="right bottom"
      leadingIcon={<Globe aria-hidden="true" />}
      trailingIcon={<ChevronUp aria-hidden="true" />}
      triggerContent={
        <span className={styles.copy}>
          <span>{t("setupUx.languages")}</span>
          <span className={styles.summary}>{summary}</span>
        </span>
      }
    >
      {language && (
        <LanguageSelect
          label={t("onboarding.targetLanguage")}
          value={language}
          disabled={disabled}
          onChange={onLanguage}
        />
      )}
      {notice && <p>{notice}</p>}
      <InterfaceLanguage />
    </UtilityPopover>
  );
}
