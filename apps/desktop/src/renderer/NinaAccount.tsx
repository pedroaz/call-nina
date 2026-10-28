import { Clock3, CircleAlert } from "lucide-react";
import { Disclosure } from "./components/ui/Disclosure.js";
import { ClerkProvider, useClerk, useSession, useSignIn, useUser } from "@clerk/electron/react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ninaPublicConfiguration,
  type NinaLoginDiagnostic,
  type NinaAccountState,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { invokeDesktop } from "./ipc.js";
import { Button, TextField, CheckboxField, Muted, DiagnosticCode } from "./components/ui/index.js";
import { ActionGroup, Section } from "./components/layout/index.js";
import styles from "./SettingsPage.module.css";

function loginReason(cause: unknown): NinaLoginDiagnostic["reason"] {
  if (typeof cause !== "object" || cause === null) return "unknown";
  const errors = "errors" in cause && Array.isArray(cause.errors) ? cause.errors : [cause];
  for (const error of errors) {
    if (typeof error !== "object" || error === null || !("code" in error)) continue;
    switch (error.code) {
      case "form_password_incorrect":
      case "form_identifier_not_found":
        return "credentials";
      case "too_many_requests":
        return "rate-limit";
      case "network_error":
        return "network";
      case "additional-step":
        return "additional-step";
    }
  }
  return "unknown";
}
function reportLogin(diagnostic: NinaLoginDiagnostic) {
  void invokeDesktop("nina-account/diagnostic", diagnostic).catch(() => undefined);
}

// Keep a failed/unsaved draft across settings navigation, never in browser storage.
let loginDraft = { username: "", password: "" };
let draftChanged = false;
let loginRequestPending = false;

const syncEvent = "nina-account-sync";
let transitionVersion = 0;
let changingAccount = false;
function accountTransition(changing: boolean) {
  changingAccount = changing;
  transitionVersion++;
  if (!changing) window.dispatchEvent(new Event(syncEvent));
}
const AccountContext = createContext<NinaAccountState>({ status: "signed-out", access: null });
const AccountIdentityContext = createContext<{
  loaded: boolean;
  signedIn: boolean;
  pending: boolean;
}>({
  loaded: true,
  signedIn: false,
  pending: false,
});
export function useNinaAccountState() {
  const account = useContext(AccountContext);
  const identity = useContext(AccountIdentityContext);
  return { ...account, identity };
}
function SessionObserver({ children }: { children: ReactNode }) {
  const { user, isLoaded: identityLoaded } = useUser();
  const { isLoaded, session } = useSession();
  const [state, setState] = useState<NinaAccountState>({ status: "signed-out", access: null });
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const sync = async () => {
      if (running || !isLoaded || changingAccount) return;
      const version = transitionVersion;
      running = true;
      try {
        if (session?.status === "pending") {
          const next = await invokeDesktop("nina-account/update", {
            status: "signing-in",
            token: null,
          });
          if (!cancelled && version === transitionVersion) setState(next);
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const token = await Promise.race([
          session ? session.getToken({ skipCache: true }) : Promise.resolve(null),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("OD_NINA_TOKEN_TIMEOUT")), 10000);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
        if (session && !token) throw new Error("OD_NINA_TOKEN_UNAVAILABLE");
        if (cancelled || version !== transitionVersion) return;
        const result = await invokeDesktop("nina-account/update", {
          status: token ? "signed-in" : "signed-out",
          token,
        });
        if (!cancelled && version === transitionVersion) setState(result);
      } catch {
        if (!cancelled && version === transitionVersion) {
          setState({ status: "unavailable", access: null });
          await invokeDesktop("nina-account/update", { status: "unavailable", token: null }).catch(
            () => undefined,
          );
        }
      } finally {
        running = false;
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 30000);
    window.addEventListener("focus", sync);
    window.addEventListener(syncEvent, sync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener(syncEvent, sync);
    };
  }, [isLoaded, session, session?.status]);
  return (
    <AccountIdentityContext.Provider
      value={{
        loaded: identityLoaded,
        signedIn: Boolean(user),
        pending: session?.status === "pending",
      }}
    >
      <AccountContext.Provider value={state}>{children}</AccountContext.Provider>
    </AccountIdentityContext.Provider>
  );
}
export function NinaAccountProvider({ children }: { children: ReactNode }) {
  if (!ninaPublicConfiguration.publishableKey) return children;
  return (
    <ClerkProvider
      publishableKey={ninaPublicConfiguration.publishableKey}
      telemetry={false}
      routerPush={() => {}}
      routerReplace={() => {}}
    >
      <SessionObserver>{children}</SessionObserver>
    </ClerkProvider>
  );
}
export function NinaAccountSettings() {
  const { t } = useTranslation();
  return (
    <Section className={styles.ninaAccount} aria-labelledby="nina-account-title">
      <header className={styles.ninaAccountIntro}>
        <h2 id="nina-account-title">{t("ninaAccount.title")}</h2>
      </header>
      {ninaPublicConfiguration.publishableKey ? (
        <AccountForm />
      ) : (
        <p role="status">{t("ninaAccount.unconfigured")}</p>
      )}
    </Section>
  );
}
function AccountForm() {
  const { t } = useTranslation();
  const { signIn } = useSignIn();
  const { session } = useSession();
  const { user, isLoaded } = useUser();
  const clerk = useClerk();
  const account = useContext(AccountContext);
  const [username, setUsername] = useState(loginDraft.username);
  const [password, setPassword] = useState(loginDraft.password);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [savingFailed, setSavingFailed] = useState(false);
  const [savingConnectionFailed, setSavingConnectionFailed] = useState(false);
  useEffect(() => {
    if (savingFailed)
      reportLogin({
        stage: "storage",
        outcome: "failed",
        reason: savingConnectionFailed ? "network" : "unknown",
      });
  }, [savingFailed, savingConnectionFailed]);
  const [cancelled, setCancelled] = useState(false);
  const [settling, setSettling] = useState(loginRequestPending);
  const attempt = useRef<AbortController | null>(null);
  const readyWait = useRef<(() => void) | null>(null);
  const loaded = useRef(isLoaded);
  loaded.current = isLoaded;
  const draftEdited = useRef(draftChanged);
  const saveVersion = useRef(0);
  useEffect(() => {
    if (cancelled) formRef.current?.querySelector("input")?.focus();
  }, [cancelled]);
  const saveDraft = async (nextUsername: string, nextPassword: string) => {
    const version = ++saveVersion.current;
    let connectionFailed = false;
    const result = await invokeDesktop("nina-account/credentials/save", {
      username: nextUsername,
      password: nextPassword,
    }).catch(() => {
      connectionFailed = true;
      return { saved: false };
    });
    if (version === saveVersion.current) {
      setSavingFailed(!result.saved);
      setSavingConnectionFailed(connectionFailed);
    }
    return result.saved;
  };
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setSavingFailed(true);
    }, 15000);
    void invokeDesktop("nina-account/credentials/read", {}).then(
      (result) => {
        window.clearTimeout(timer);
        if (!active) return;
        if (!draftEdited.current && result.credentials) {
          loginDraft = result.credentials;
          setUsername(result.credentials.username);
          setPassword(result.credentials.password);
        }
        if (!draftEdited.current) {
          setSavingFailed(!result.available);
          setSavingConnectionFailed(false);
        }
      },
      () => {
        window.clearTimeout(timer);
        if (active && !draftEdited.current) {
          setSavingFailed(true);
          setSavingConnectionFailed(true);
        }
      },
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState<NinaLoginDiagnostic>();
  useEffect(() => {
    if (isLoaded) readyWait.current?.();
  }, [isLoaded]);
  useEffect(() => {
    const syncPending = () => setSettling(loginRequestPending);
    window.addEventListener(syncEvent, syncPending);
    return () => {
      window.removeEventListener(syncEvent, syncPending);
      attempt.current?.abort();
    };
  }, []);
  const cancelLogin = () => {
    attempt.current?.abort();
    setBusy(false);
    setCancelled(true);
    setError(false);
    setProgress(undefined);
  };
  const waitForReady = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (loaded.current) {
        resolve();
        return;
      }
      const finish = (failure?: Error) => {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        readyWait.current = null;
        if (failure) reject(failure);
        else resolve();
      };
      const abort = () => finish(new Error("OD_NINA_LOGIN_CANCELLED"));
      const timer = window.setTimeout(() => finish(new Error("OD_NINA_LOGIN_NOT_READY")), 15000);
      readyWait.current = () => finish();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  const step = async <T,>(
    stage: NinaLoginDiagnostic["stage"],
    work: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> => {
    if (signal.aborted) throw new Error("OD_NINA_LOGIN_CANCELLED");
    const started = { stage, outcome: "started", reason: "none" } as const;
    setProgress(started);
    reportLogin(started);
    const timer = window.setTimeout(() => {
      if (signal.aborted) return;
      const slow = { stage, outcome: "slow", reason: "none" } as const;
      setProgress(slow);
      reportLogin(slow);
    }, 15000);
    try {
      const result = await work();
      if (signal.aborted) throw new Error("OD_NINA_LOGIN_CANCELLED");
      const completed = { stage, outcome: "completed", reason: "none" } as const;
      setProgress(completed);
      reportLogin(completed);
      return result;
    } catch (cause) {
      if (signal.aborted) throw cause;
      const failed = { stage, outcome: "failed", reason: loginReason(cause) } as const;
      setProgress(failed);
      reportLogin(failed);
      throw cause;
    } finally {
      window.clearTimeout(timer);
    }
  };
  const login = async () => {
    if (loginRequestPending || busy) return;
    const controller = new AbortController();
    attempt.current = controller;
    const { signal } = controller;
    loginRequestPending = true;
    accountTransition(true);
    setSettling(true);
    setBusy(true);
    setCancelled(false);
    setError(false);
    // Saving must never hold up authentication or cancellation.
    void saveDraft(username, password);
    try {
      if (!loaded.current) await step("initialization", () => waitForReady(signal), signal);
      await step(
        "desktop",
        () => invokeDesktop("nina-account/update", { status: "signing-in", token: null }),
        signal,
      );
      await step(
        "credentials",
        async () => {
          const result = await signIn.password({ identifier: username, password });
          if (result.error) throw result.error;
          if (signIn.status !== "complete") {
            const needsVerification = [
              "needs_first_factor",
              "needs_second_factor",
              "needs_new_password",
            ].includes(signIn.status ?? "");
            throw Object.assign(new Error("OD_NINA_LOGIN_INCOMPLETE"), {
              code: needsVerification ? "additional-step" : "unknown",
            });
          }
        },
        signal,
      );
      // Cancel is no longer offered once session activation begins.
      await step(
        "session",
        async () => {
          const completed = await signIn.finalize();
          if (completed.error) throw completed.error;
        },
        signal,
      );
    } catch {
      if (!signal.aborted) setError(true);
      void invokeDesktop("nina-account/update", { status: "signed-out", token: null }).catch(
        () => undefined,
      );
    } finally {
      loginRequestPending = false;
      setSettling(false);
      setBusy(false);
      accountTransition(false);
    }
  };
  const logout = async () => {
    accountTransition(true);
    setBusy(true);
    setError(false);
    try {
      await invokeDesktop("nina-account/update", { status: "signed-out", token: null });
      await clerk.signOut();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      accountTransition(false);
    }
  };
  const hasDetails = error || progress?.outcome === "slow";
  const statusText = cancelled
    ? t(settling ? "ninaAccount.cancellingRequest" : "ninaAccount.cancelled")
    : error
      ? progress?.stage === "initialization"
        ? t("ninaAccount.initializationFailed")
        : t("ninaAccount.loginFailedTitle")
      : busy && progress
        ? t(`ninaAccount.loginStage.${progress.stage}`)
        : "";
  const feedback = (
    <div className={styles.loginStatus} role="status" aria-live="polite">
      {error ? <CircleAlert aria-hidden="true" /> : busy ? <Clock3 aria-hidden="true" /> : null}
      <span>{statusText}</span>
    </div>
  );
  return (
    <div className={styles.accountAccess}>
      {user ? (
        <>
          {(busy || error) && feedback}
          <div className={styles.ninaAccountSummary}>
            <p>
              {session?.status === "pending" || account.status !== "signed-in"
                ? user.username
                : t("ninaAccount.signedIn", { username: user.username })}
            </p>
            <Button variant="secondary" isDisabled={busy} onPress={() => void logout()}>
              {t(account.status === "expired" ? "ninaAccount.signInAgain" : "ninaAccount.signOut")}
            </Button>
          </div>
          {session?.status === "pending" && (
            <div className={styles.pendingSession}>
              <p role="status">{t("providers.signInIncomplete")}</p>
              <p>{t("ninaAccount.expired")}</p>
            </div>
          )}
          {session?.status !== "pending" &&
            (account.status === "unavailable" || account.status === "expired") && (
              <p role="status">{t(`ninaAccount.${account.status}`)}</p>
            )}
          {account.access && (
            <>
              <p>{t(`ninaAccount.${account.access.eligibility}`)}</p>
              <p>{t("ninaAccount.remaining", { count: account.access.remainingActions })}</p>
              {!account.access.inferenceEnabled && <Muted>{t("ninaAccount.pending")}</Muted>}
            </>
          )}
        </>
      ) : (
        <form
          ref={formRef}
          className={styles.ninaAccountForm}
          onSubmit={(event) => {
            event.preventDefault();
            void login();
          }}
        >
          <Muted>{t("ninaAccount.description")}</Muted>
          <div className={styles.ninaAccountFields}>
            <TextField
              label={t("ninaAccount.username")}
              autoComplete="username"
              value={username}
              onChange={(event) => {
                draftEdited.current = true;
                draftChanged = true;
                loginDraft = { username: event.target.value, password };
                setUsername(event.target.value);
                void saveDraft(event.target.value, password);
              }}
              required
              maxLength={64}
              disabled={busy}
            />
            <TextField
              label={t("ninaAccount.password")}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                draftEdited.current = true;
                draftChanged = true;
                loginDraft = { username, password: event.target.value };
                setPassword(event.target.value);
                void saveDraft(username, event.target.value);
              }}
              required
              maxLength={256}
              disabled={busy}
            />
          </div>
          <CheckboxField
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          >
            {t("ninaAccount.showPassword")}
          </CheckboxField>
          <div className={styles.ninaAccountFooter}>
            {feedback}
            <ActionGroup>
              {busy && progress?.stage !== "session" && (
                <Button variant="quiet" onPress={cancelLogin}>
                  {t("ninaAccount.cancelLogin")}
                </Button>
              )}
              <Button
                type="submit"
                isDisabled={busy || settling || !username || !password}
                variant="primary"
              >
                {t(
                  busy
                    ? "ninaAccount.signing-in"
                    : error || cancelled
                      ? "ninaAccount.retry"
                      : "ninaAccount.signIn",
                )}
              </Button>
            </ActionGroup>
          </div>
          {hasDetails && (
            <Disclosure
              label={t("ninaAccount.diagnosticDetails")}
              variant="plain"
              density="compact"
            >
              {error &&
                progress?.stage !== "initialization" &&
                progress?.reason !== "none" &&
                progress && <Muted>{t(`ninaAccount.loginReason.${progress.reason}`)}</Muted>}
              {progress && (
                <DiagnosticCode>
                  NINA_LOGIN_{progress.stage.toUpperCase()}_{progress.outcome.toUpperCase()}
                </DiagnosticCode>
              )}
            </Disclosure>
          )}
        </form>
      )}
    </div>
  );
}
