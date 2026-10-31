import { ninaPublicConfiguration } from "@call-nina/contracts";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Tooltip } from "../components/ui/Button.js";
import { useNinaAccountDialog, useNinaAccountState } from "../learning/account/NinaAccount.js";
import styles from "./SidebarAccount.module.css";

function accountStatusKey(account: ReturnType<typeof useNinaAccountState>) {
  const { identity } = account;
  if (!ninaPublicConfiguration.publishableKey) return "ninaAccount.statusUnavailable";
  if (!identity.loaded || identity.changing) return "ninaAccount.checking";
  if (identity.pending) return "providers.signInIncomplete";
  if (!identity.ready) return "ninaAccount.checking";
  if (account.status === "expired") return "ninaAccount.signInAgain";
  if (account.status === "unavailable") return "ninaAccount.statusUnavailable";
  if (account.status === "signing-in") return "ninaAccount.signing-in";
  if (identity.signedIn)
    return account.status === "signed-in" ? "ninaAccount.widgetSignedIn" : "ninaAccount.checking";
  return "ninaAccount.signIn";
}

export function SidebarAccount({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const account = useNinaAccountState();
  const { open, isOpen } = useNinaAccountDialog();
  const { identity } = account;
  const status = t(accountStatusKey(account));
  const name = identity.username ?? t("ninaAccount.title");
  const label = [t("ninaAccount.title"), identity.username, status].filter(Boolean).join(" · ");
  const control = (
    <Button
      className={`${styles.trigger} ${collapsed ? styles.collapsed : ""}`}
      variant="quiet"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      leadingIcon={<UserRound aria-hidden="true" />}
      onPress={open}
    >
      {collapsed ? (
        <span className={styles.hiddenLabel}>{label}</span>
      ) : (
        <span className={styles.copy}>
          <span>{name}</span>
          <span className={styles.status} aria-live="polite">
            {status}
          </span>
        </span>
      )}
    </Button>
  );
  return collapsed ? <Tooltip label={label}>{control}</Tooltip> : control;
}
