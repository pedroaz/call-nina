import { CircleCheck, CircleMinus, CircleAlert, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiConnection } from "@call-nina/contracts";
import type { ProviderView } from "./useProviderView.js";
import { useNinaAccountState } from "./NinaAccount.js";
import styles from "./ConnectionSettings.module.css";

export function ProviderStatus({
  route,
  view,
  chatgptConnected,
}: {
  route: AiConnection["routeId"];
  view: ProviderView;
  chatgptConnected?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const nina = useNinaAccountState();
  const connection = view.settings.connections.find((entry) => entry.routeId === route);
  const status = view.availability.find((entry) => entry.connectionId === connection?.id)?.status;
  let label = "disconnected";
  let tone = "neutral";
  let Icon = CircleMinus;
  if (route === "claude-code") label = "notImplemented";
  else if (route === "chatgpt" || route === "managed") {
    const connected =
      route === "chatgpt" ? (chatgptConnected ?? status === "available") : nina.identity.signedIn;
    if (connected) {
      label = "connected";
      tone = "ready";
      Icon = CircleCheck;
    }
  } else if (route === "local") {
    label = view.offlineModel.snapshot.state === "installed" ? "installed" : "notInstalled";
    if (label === "installed") Icon = CircleCheck;
  } else if (connection?.secretRef) {
    label = "configured";
    Icon = KeyRound;
  } else label = "keyRequired";
  if (route === "managed" && !nina.identity.loaded) label = "checkingConnection";
  if (route === "managed" && nina.identity.pending) {
    label = "signInIncomplete";
    tone = "neutral";
    Icon = CircleAlert;
  }
  if (route === "managed" && nina.identity.signedIn && !nina.identity.pending) {
    if (nina.status !== "signed-in") {
      label = nina.status === "expired" ? "signInRequired" : "checkingConnection";
      if (nina.status === "unavailable") label = "connectionUnavailable";
      tone = "neutral";
      Icon = CircleAlert;
    }
  }
  const issue =
    status &&
    !["available", "configured", "inactive", "credential-required", "account-required"].includes(
      status,
    );
  return (
    <div className={styles.providerStatus}>
      <span className={styles.statusLabel} data-tone={tone}>
        <Icon aria-hidden="true" />
        {t(`providers.${label}`)}
      </span>
      {issue && (
        <span className={styles.statusIssue}>
          <CircleAlert aria-hidden="true" />
          {t(`connectionSettings.status.${status}`)}
        </span>
      )}
      {route === "managed" &&
        nina.identity.signedIn &&
        !nina.identity.pending &&
        (nina.status === "unavailable" || nina.status === "expired") && (
          <span className={styles.statusIssue}>
            <CircleAlert aria-hidden="true" />
            {t(`ninaAccount.${nina.status}`)}
          </span>
        )}
      {route === "managed" &&
        nina.identity.signedIn &&
        !nina.identity.pending &&
        nina.status === "signed-in" &&
        (!nina.access?.inferenceEnabled || nina.access.eligibility !== "approved") && (
          <span className={styles.statusIssue}>
            {t(
              nina.access?.eligibility === "approved"
                ? "ninaAccount.pending"
                : "providers.accessRequired",
            )}
          </span>
        )}
    </div>
  );
}
