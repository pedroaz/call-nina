import {
  languageCapabilities,
  languageDefinitions,
  languageIds,
  type Language,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { SelectControl, FieldGroup } from "./components/ui/index.js";

export function LanguageSelect({
  label,
  value,
  onChange,
  interfaceOnly = false,
  disabled = false,
}: {
  label: string;
  value: Language;
  onChange: (language: Language) => void;
  interfaceOnly?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <FieldGroup>
      <span>{label}</span>
      <SelectControl
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.value as Language);
        }}
      >
        {languageIds
          .filter((language) => !interfaceOnly || languageCapabilities[language].interface)
          .map((language) => (
            <option key={language} value={language}>
              {t(`languages.${language}`, { defaultValue: languageDefinitions[language].name })}
            </option>
          ))}
      </SelectControl>
    </FieldGroup>
  );
}
