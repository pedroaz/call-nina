import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@call-nina/contracts";
import { LanguageSelect } from "./LanguageSelect.js";
import { invokeDesktop } from "./ipc.js";

export function InterfaceLanguage() {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = async (uiLocale: Language) => {
    setBusy(true);
    setFailed(false);
    try {
      const current = await invokeDesktop("learner-settings/read", {});
      await invokeDesktop("learner-settings/update", {
        expectedUpdatedAt: current.updatedAt,
        settings: { ...current.settings, uiLocale },
      });
      await i18n.changeLanguage(uiLocale);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <LanguageSelect
        label={t("settings.uiLocale")}
        interfaceOnly
        value={(i18n.resolvedLanguage ?? "en-US") as Language}
        disabled={busy}
        onChange={(language) => void change(language)}
      />
      {failed && <p role="alert">{t("settings.saveFailed")}</p>}
    </div>
  );
}
