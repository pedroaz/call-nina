import { languageSchema, ninaPublicConfiguration, type CallNinaError } from "@call-nina/contracts";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Tooltip, ModalDialog } from "../components/ui/index.js";
import { OperationError } from "../components/ui/OperationError.js";
import { invokeDesktop, normalizeDesktopError } from "../runtime/ipc.js";

import styles from "../components/layout/AppShell.module.css";

export function SidebarFeedback() {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  if (!ninaPublicConfiguration.tallyFeedbackUrl) return null;
  const open = async () => {
    setBusy(true);
    try {
      const locale = languageSchema.safeParse(i18n.resolvedLanguage);
      await invokeDesktop("feedback/open", { locale: locale.success ? locale.data : "en-US" });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Tooltip label={t("productFeedback.send")}>
        <Button
          variant="quiet"
          density="compact"
          className={styles.navButton}
          aria-label={t("productFeedback.send")}
          isDisabled={busy}
          onPress={() => void open()}
        >
          <MessageSquarePlus aria-hidden="true" />
          <span className={styles.navLabel}>{t("productFeedback.send")}</span>
        </Button>
      </Tooltip>
      <ModalDialog
        isOpen={Boolean(error)}
        title={t("productFeedback.send")}
        closeLabel={t("actions.close")}
        onOpenChange={(isOpen) => {
          if (!isOpen) setError(undefined);
        }}
      >
        {error && <OperationError error={error} />}
      </ModalDialog>
    </>
  );
}
