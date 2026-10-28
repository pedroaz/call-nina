import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw } from "lucide-react";
import { Page, Section, ActionGroup } from "./components/layout/index.js";
import { Button, Feedback } from "./components/ui/index.js";
import { NinaAccountSettings, useNinaAccountState } from "./NinaAccount.js";
import { invokeDesktop } from "./ipc.js";
export function MobilePage() {
  const { t, i18n } = useTranslation();
  const account = useNinaAccountState();
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<string>();
  const [message, setMessage] = useState<string>();
  const identity = useRef(account.access?.userId);
  identity.current = account.access?.userId;
  useEffect(() => {
    let cancelled = false;
    setPublished(undefined);
    setMessage(undefined);
    if (account.status === "signed-in")
      void invokeDesktop("mobile-sync/read", {})
        .then((result) => {
          if (!cancelled && result.status === "synced") setPublished(result.publishedAt);
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account.access?.userId, account.status]);
  const sync = async () => {
    if (busy) return;
    const user = identity.current;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await invokeDesktop("mobile-sync/publish", {});
      if (identity.current !== user) return;
      if (result.status === "synced") {
        setPublished(result.publishedAt);
        setMessage(t("mobile.synced"));
      } else if (result.status === "failed") setMessage(t(`mobile.errors.${result.reason}`));
    } catch {
      if (identity.current === user) setMessage(t("mobile.errors.unavailable"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title={t("nav.mobile")}>
      <Section title={t("mobile.download")}>
        <ActionGroup>
          <Button variant="secondary" leadingIcon={<Download aria-hidden="true" />} isDisabled>
            {t("mobile.download")}
          </Button>
        </ActionGroup>
      </Section>
      <Section title={t("mobile.sync")}>
        {account.status !== "signed-in" && <NinaAccountSettings />}
        <ActionGroup>
          <Button
            variant="primary"
            leadingIcon={<RefreshCw aria-hidden="true" />}
            isDisabled={busy || account.status !== "signed-in"}
            onPress={() => void sync()}
          >
            {t(busy ? "mobile.syncing" : "mobile.sync")}
          </Button>
        </ActionGroup>
        {published && (
          <p>{t("mobile.lastSync", { time: new Date(published).toLocaleString(i18n.language) })}</p>
        )}
        {message && <Feedback live="polite">{message}</Feedback>}
      </Section>
    </Page>
  );
}
