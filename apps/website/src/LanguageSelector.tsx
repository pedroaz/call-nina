import { SelectControl } from "@call-nina/browser-ui";
import { copy, languages, type Locale } from "./locales";

export function LanguageSelector({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <SelectControl
      className="language-switch"
      aria-label={copy[locale].language}
      value={locale}
      onChange={(event) => {
        onChange(event.target.value as Locale);
      }}
    >
      {languages.map(({ code, label }) => (
        <option key={code} value={code} lang={code}>
          {label}
        </option>
      ))}
    </SelectControl>
  );
}
