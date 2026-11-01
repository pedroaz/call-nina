import type { CallNinaError } from "@call-nina/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import { useUsageAnalytics } from "../../runtime/usage-analytics.js";
import { Section } from "../../components/layout/index.js";
import { Button, Disclosure, SwitchField } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";

export function AnalyticsPrivacyDetails() {
  const { t } = useTranslation();
  return (
    <Disclosure label={t("usageAnalytics.details")}>
      <p>{t("usageAnalytics.privacy")}</p>
      <p>{t("usageAnalytics.delivery")}</p>
    </Disclosure>
  );
}

export function UsageAnalyticsSettings() {
  const { t } = useTranslation();
  const analytics = useUsageAnalytics();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const displayedError = error ?? analytics.error;
  if (analytics.value && !analytics.value.available) return null;
  const update = async (enabled: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("analytics/consent", { enabled });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      await analytics.refresh();
      setBusy(false);
    }
  };
  return (
    <Section aria-labelledby="usage-analytics-heading">
      <h2 id="usage-analytics-heading">{t("usageAnalytics.title")}</h2>
      <SwitchField
        isSelected={analytics.value?.consent === "enabled"}
        isDisabled={busy || !analytics.value}
        onChange={(enabled) => void update(enabled)}
      >
        {t("usageAnalytics.share")}
      </SwitchField>
      <p>{t("usageAnalytics.description")}</p>
      <AnalyticsPrivacyDetails />
      {displayedError && (
        <OperationError error={displayedError}>
          <Button variant="secondary" onPress={() => void analytics.refresh()}>
            {t("actions.retry")}
          </Button>
        </OperationError>
      )}
    </Section>
  );
}
