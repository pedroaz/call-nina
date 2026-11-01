import { ninaPublicConfiguration, type NinaAccountState } from "@call-nina/contracts";
import { ClerkProvider, useSession, useUser } from "@clerk/electron/react";
import { UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup, Section } from "../../components/layout/index.js";
import { Button, ModalDialog } from "../../components/ui/index.js";
import { invokeDesktop } from "../../runtime/ipc.js";
import {
  AccountContext,
  AccountDialogContext,
  AccountIdentityContext,
  useNinaAccountDialog,
  useNinaAccountState,
} from "./account-context.js";
import { accountSession } from "./account-session.js";
import styles from "./Account.module.css";
import { AccountForm } from "./AccountForm.js";

export { useNinaAccountDialog, useNinaAccountState } from "./account-context.js";
function SessionObserver({ children }: { children: ReactNode }) {
  const { user, isLoaded: identityLoaded } = useUser();
  const { isLoaded, session } = useSession();
  const [state, setState] = useState<NinaAccountState>({ status: "signed-out", access: null });
  const [synchronizedSession, setSynchronizedSession] = useState<string | null>();
  const [changing, setChanging] = useState(accountSession.changing);
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let queued = false;
    const isCurrent = (version: number) => !cancelled && version === accountSession.version;
    const accept = (next: NinaAccountState, version: number) => {
      if (!isCurrent(version)) return;
      setState(next);
      setSynchronizedSession(session?.id ?? null);
    };
    const sync = async () => {
      if (cancelled || !isLoaded || accountSession.changing) return;
      if (running) {
        queued = true;
        return;
      }
      const version = accountSession.version;
      running = true;
      try {
        if (session?.status === "pending") {
          const next = await invokeDesktop("nina-account/update", {
            status: "signing-in",
            token: null,
          });
          accept(next, version);
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const token = await Promise.race([
          session ? session.getToken({ skipCache: true }) : Promise.resolve(null),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("OD_NINA_TOKEN_TIMEOUT"));
            }, 10000);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
        if (session && !token) throw new Error("OD_NINA_TOKEN_UNAVAILABLE");
        if (!isCurrent(version)) return;
        const result = await invokeDesktop("nina-account/update", {
          status: token ? "signed-in" : "signed-out",
          token,
        });
        accept(result, version);
      } catch {
        if (isCurrent(version)) {
          accept({ status: "unavailable", access: null }, version);
          await invokeDesktop("nina-account/update", { status: "unavailable", token: null }).catch(
            () => undefined,
          );
        }
      } finally {
        running = false;
        if (queued) {
          queued = false;
          void sync();
        }
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 30000);
    const onSync = () => {
      setChanging(accountSession.changing);
      void sync();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onSync();
    };
    window.addEventListener("focus", onSync);
    window.addEventListener("online", onSync);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribeAccount = accountSession.subscribe(onSync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onSync);
      window.removeEventListener("online", onSync);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribeAccount();
    };
  }, [isLoaded, session, session?.status]);
  return (
    <AccountIdentityContext.Provider
      value={{
        loaded: identityLoaded && isLoaded,
        signedIn: Boolean(user),
        pending: session?.status === "pending",
        username: user?.username ?? null,
        ready: synchronizedSession === (session?.id ?? null),
        changing,
      }}
    >
      <AccountContext.Provider value={state}>{children}</AccountContext.Provider>
    </AccountIdentityContext.Provider>
  );
}
export function NinaAccountProvider({ children }: { children: ReactNode }) {
  if (!ninaPublicConfiguration.publishableKey)
    return <AccountDialogProvider>{children}</AccountDialogProvider>;
  return (
    <ClerkProvider
      publishableKey={ninaPublicConfiguration.publishableKey}
      telemetry={false}
      routerPush={() => {}}
      routerReplace={() => {}}
    >
      <SessionObserver>
        <AccountDialogProvider>{children}</AccountDialogProvider>
      </SessionObserver>
    </ClerkProvider>
  );
}
function AccountDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);
  return (
    <AccountDialogContext.Provider
      value={{
        open: () => {
          setOpen(true);
        },
        isOpen,
      }}
    >
      {children}
      <ModalDialog
        isOpen={isOpen}
        onOpenChange={setOpen}
        keepMounted
        title={t("ninaAccount.title")}
        closeLabel={t("actions.close")}
      >
        {ninaPublicConfiguration.publishableKey ? (
          <AccountForm />
        ) : (
          <p role="status">{t("ninaAccount.unconfigured")}</p>
        )}
      </ModalDialog>
    </AccountDialogContext.Provider>
  );
}
export function NinaAccountSettings() {
  const { t } = useTranslation();
  const { open } = useNinaAccountDialog();
  const account = useNinaAccountState();
  return (
    <Section className={styles.ninaAccount} aria-label={t("ninaAccount.title")}>
      <ActionGroup>
        <Button variant="secondary" leadingIcon={<UserRound aria-hidden="true" />} onPress={open}>
          {t(
            account.status === "expired"
              ? "ninaAccount.signInAgain"
              : account.identity.signedIn
                ? "ninaAccount.manageAccount"
                : "ninaAccount.signIn",
          )}
        </Button>
      </ActionGroup>
    </Section>
  );
}
