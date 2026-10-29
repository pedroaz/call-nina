import styles from "./ProviderActionSummary.module.css";
import { useEffect, useState } from "react";
import type { ProviderAccess, ProviderOperation, CorrelationId } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { invokeDesktop, subscribeDesktop } from "./ipc.js";
import { Button } from "./components/ui/index.js";

export const openProviderSettingsEvent = "nina-open-provider-settings";
export function ProviderActionSummary({
  operation,
  hasImage = false,
  busy = false,
  previousOperationId,
}: {
  operation: ProviderOperation;
  hasImage?: boolean;
  busy?: boolean;
  previousOperationId?: CorrelationId | undefined;
}) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<ProviderAccess>();
  const [idleAccess, setIdleAccess] = useState<ProviderAccess>();
  if (!busy && idleAccess !== access) setIdleAccess(access);
  useEffect(() => {
    let alive = true;
    let serial = 0;
    const load = async () => {
      const current = ++serial;
      try {
        const next = await invokeDesktop("provider/access/read", {
          operation,
          hasImage,
          ...(previousOperationId ? { previousOperationId } : {}),
        });
        if (alive && serial === current) setAccess(next);
      } catch {
        if (alive && serial === current) setAccess(undefined);
      }
    };
    void load();
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "data-root-changed" ||
        (event.event === "state-invalidated" && ["ai-connections", "account"].includes(event.scope))
      )
        void load();
    });
    return () => {
      alive = false;
      ++serial;
      unsubscribe();
    };
  }, [operation, hasImage, busy, previousOperationId]);
  const shown = busy ? (idleAccess ?? access) : access;
  if (shown?.status !== "unavailable") return null;
  return (
    <div className={styles.summary} role="status" aria-live="polite">
      <span>{t(`providerAccess.reasons.${shown.reason}`)}</span>
      <Button
        variant="quiet"
        onPress={() => window.dispatchEvent(new Event(openProviderSettingsEvent))}
      >
        {t("settings.aiTitle")}
      </Button>
    </div>
  );
}
