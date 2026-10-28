import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw } from "lucide-react";
import { Page, Section, ActionGroup } from "./components/layout/index.js";
import { Button, Feedback } from "./components/ui/index.js";
import { NinaAccountSettings, useNinaAccountState } from "./NinaAccount.js";
import { invokeDesktop } from "./ipc.js";

export function MobilePage() {
  const account = useNinaAccountState();
  return (
    <MobileAccountPage
      key={`${account.status}:${account.access?.userId ?? ""}`}
      account={account}
    />
  );
}
function MobileAccountPage({ account }: { account: ReturnType<typeof useNinaAccountState> }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<string>();
  const [message, setMessage] = useState<string>();
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
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
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await invokeDesktop("mobile-sync/publish", {});
      if (!mounted.current) return;
      if (result.status === "synced") {
        setPublished(result.publishedAt);
        setMessage(t("mobile.synced"));
      } else if (result.status === "failed") setMessage(t(`mobile.errors.${result.reason}`));
    } catch {
      if (mounted.current) setMessage(t("mobile.errors.unavailable"));
    } finally {
      if (mounted.current) setBusy(false);
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
