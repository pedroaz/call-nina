import { Button } from "@call-nina/browser-ui";
import { copy, languages, type Locale } from "./locales";

export function LanguageSelector({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  return (
    <div className="language-switch" role="group" aria-label={copy[locale].language}>
      {languages.map(({ code, label }) => (
        <Button
          key={code}
          density="compact"
          variant="quiet"
          lang={code}
          aria-pressed={locale === code}
          onPress={() => onChange(code)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
