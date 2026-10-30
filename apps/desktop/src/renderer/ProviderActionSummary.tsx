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
  operation: ProviderOperation | readonly ProviderOperation[];
  hasImage?: boolean;
  busy?: boolean;
  previousOperationId?: CorrelationId | undefined;
}) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<readonly ProviderAccess[]>();
  const [idleAccess, setIdleAccess] = useState<readonly ProviderAccess[]>();
  if (!busy && idleAccess !== access) setIdleAccess(access);
  useEffect(() => {
    let alive = true;
    let serial = 0;
    const load = async () => {
      const current = ++serial;
      try {
        const operations = typeof operation === "string" ? [operation] : operation;
        const next = await Promise.allSettled(
          operations.map((operation, index) =>
            invokeDesktop("provider/access/read", {
              operation,
              hasImage,
              ...(index === 0 && previousOperationId ? { previousOperationId } : {}),
            }),
          ),
        );
        if (alive && serial === current)
          setAccess(
            next.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
          );
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
  const reasons = [
    ...new Set(
      (shown ?? []).flatMap((access) => (access.status === "unavailable" ? [access.reason] : [])),
    ),
  ];
  if (!reasons.length) return null;
  return (
    <div className={styles.summary} role="status" aria-live="polite">
      {reasons.map((reason) => (
        <span key={reason}>{t(`providerAccess.reasons.${reason}`)}</span>
      ))}
      <Button
        variant="quiet"
        onPress={() => window.dispatchEvent(new Event(openProviderSettingsEvent))}
      >
        {t("settings.aiTitle")}
      </Button>
    </div>
  );
}
