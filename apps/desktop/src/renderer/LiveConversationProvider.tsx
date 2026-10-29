import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProviderView } from "./useProviderView.js";
import { SelectField } from "./components/ui/index.js";
import { invokeDesktop } from "./ipc.js";

export function LiveConversationProvider() {
  const view = useProviderView();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = async (value: string) => {
    if (!view) return;
    setBusy(true);
    setFailed(false);
    try {
      await invokeDesktop("ai-connections/update", {
        expectedGeneration: view.expectedGeneration,
        expectedRevision: view.settings.revision,
        action: {
          kind: "routing",
          routing: {
            ...view.settings.routing,
            liveConversation: value === "codex" ? "codex" : null,
          },
        },
      });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SelectField
        label={t("providers.provider")}
        disabled={busy || !view}
        value={view?.settings.routing.liveConversation ?? ""}
        onChange={(event) => void change(event.target.value)}
      >
        <option value="">{t("providers.unassigned")}</option>
        <option value="codex">Codex</option>
      </SelectField>
      {failed && <p role="alert">{t("settings.saveFailed")}</p>}
    </>
  );
}
