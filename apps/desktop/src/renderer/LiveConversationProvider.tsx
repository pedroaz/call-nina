import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useProviderView } from "./useProviderView.js";
import { SwitchField, Feedback } from "./components/ui/index.js";
import { SettingsRow } from "./SettingsRow.js";
import { MessageCircle } from "lucide-react";
import { invokeDesktop } from "./ipc.js";

export function LiveConversationProvider({
  status,
  action,
}: {
  status: ReactNode;
  action: ReactNode;
}) {
  const view = useProviderView();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = async (enabled: boolean) => {
    if (!view || busy) return;
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
            liveConversation: enabled ? "codex" : null,
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
      <SettingsRow
        icon={<MessageCircle aria-hidden="true" />}
        title="Codex"
        action={
          <>
            <SwitchField
              aria-label={`${t("setupUx.speakingPractice")}: Codex · ${t("providers.enabled")}`}
              isDisabled={busy || !view}
              isSelected={view?.settings.routing.liveConversation === "codex"}
              onChange={(enabled) => void change(enabled)}
            >
              {t("providers.enabled")}
            </SwitchField>
            {action}
          </>
        }
      >
        <span role="status">{status}</span>
      </SettingsRow>
      {failed && (
        <Feedback tone="error" live="assertive" density="compact">
          {t("settings.saveFailed")}
        </Feedback>
      )}
    </>
  );
}
