import type { ReactNode } from "react";
import { Component, useState } from "react";
import { type DesktopIpcResponse, type CallNinaError } from "@call-nina/contracts";
import { Languages, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import styles from "./Startup.module.css";
import { ActionGroup } from "./components/layout/index.js";
import {
  Button,
  CheckboxContainer,
  DiagnosticCode,
  Feedback,
  Muted,
} from "./components/ui/index.js";
import i18n from "./i18n.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";

type Readiness = Extract<DesktopIpcResponse, { status: "ok"; channel: "app/readiness" }>["result"];
type Selection = Extract<
  Extract<DesktopIpcResponse, { status: "ok"; channel: "data-root/choose" }>["result"],
  { status: "selected" }
>;

const warningKeys = {
  "git-worktree": "folder.warningGit",
  "broad-permissions": "folder.warningBroad",
  "install-directory": "folder.warningInstall",
  "integration-restart-required": "folder.warningRestart",
} as const;

export function LanguageButton() {
  const { t } = useTranslation();
  return (
    <Button
      className={styles.languageButton}
      onPress={() => void i18n.changeLanguage(i18n.language === "de" ? "en" : "de")}
    >
      <Languages aria-hidden="true" />
      {t("actions.switchLanguage")}
    </Button>
  );
}

function Diagnostic({ error }: { error: CallNinaError }) {
  const { t } = useTranslation();
  return (
    <DiagnosticCode data-testid="diagnostic-reference">
      {t("startup.diagnostic")}: {error.reference.code} · {error.reference.correlationId}
    </DiagnosticCode>
  );
}

export function OperationError({ error }: { error: CallNinaError }) {
  const { t } = useTranslation();
  return (
    <Feedback live="assertive" tone="error">
      <div>
        <p>{t(error.messageKey)}</p>
        <Diagnostic error={error} />
      </div>
    </Feedback>
  );
}

type BoundaryProps = Readonly<{
  children: ReactNode;
  title: string;
  body: string;
  close: string;
}>;
type BoundaryState = Readonly<{ failed: boolean }>;

export class ViewBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Feedback live="assertive" tone="error">
        <div>
          <strong>{this.props.title}</strong>
          <p>{this.props.body}</p>
          <Button
            onPress={() => {
              this.setState({ failed: false });
            }}
          >
            {this.props.close}
          </Button>
        </div>
      </Feedback>
    );
  }
}

export function StartupFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.app}>
      <div className={styles.topActions}>
        <LanguageButton />
      </div>
      <main className={styles.startup}>{children}</main>
    </div>
  );
}

export function FolderOnboarding({ onReady }: { onReady: () => Promise<void> }) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<Selection>();
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();

  const choose = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("data-root/choose", {});
      if (result.status === "cancelled") {
        setNotice(t("folder.cancelled"));
        setSelection(undefined);
      } else {
        setNotice(undefined);
        setSelection(result);
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!selection || !confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("data-root/confirm", { selectionId: selection.selectionId });
      await onReady();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StartupFrame>
      <section className={styles.startupCard} aria-labelledby="folder-title">
        <p className={styles.eyebrow}>{t("app.name")}</p>
        <h1 id="folder-title">{t("startup.firstTitle")}</h1>
        <Muted as="p">{t("startup.firstBody")}</Muted>
        {!selection ? (
          <>
            {notice && <p role="status">{notice}</p>}
            {error && <OperationError error={error} />}
            <ActionGroup>
              <Button variant="primary" isDisabled={busy} onPress={() => void choose()}>
                <ShieldCheck aria-hidden="true" />
                {t("actions.choose")}
              </Button>
            </ActionGroup>
          </>
        ) : (
          <>
            <p>
              <strong>{t("folder.selected")}:</strong> {selection.displayName}
            </p>
            {selection.warnings.length > 0 && (
              <ul className={styles.warningList}>
                {selection.warnings.map((warning) => (
                  <li key={warning}>{t(warningKeys[warning])}</li>
                ))}
              </ul>
            )}
            <div className={styles.privacyGrid}>
              <section>
                <ShieldCheck aria-hidden="true" />
                <h2>{t("folder.privacyTitle")}</h2>
                <p>{t("folder.privacyBody")}</p>
              </section>
              <section>
                <Sparkles aria-hidden="true" />
                <h2>{t("folder.cloudTitle")}</h2>
                <p>{t("folder.cloudBody")}</p>
              </section>
            </div>
            <CheckboxContainer>
              <input
                checked={confirmed}
                onChange={(event) => {
                  setConfirmed(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <span>{t("folder.confirmCheck")}</span>
            </CheckboxContainer>
            {error && <OperationError error={error} />}
            <ActionGroup>
              <Button
                variant="primary"
                isDisabled={!confirmed || busy}
                onPress={() => void confirm()}
              >
                {t("actions.confirm")}
              </Button>
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => {
                  setSelection(undefined);
                  setConfirmed(false);
                }}
              >
                {t("actions.cancel")}
              </Button>
            </ActionGroup>
          </>
        )}
      </section>
    </StartupFrame>
  );
}

export function StartupError(props: {
  readiness: Readiness;
  retry: () => Promise<void>;
  recover: () => void;
}) {
  const { t } = useTranslation();
  const { readiness } = props;
  if (readiness.dataRoot.status !== "unavailable") return null;
  const copy = {
    "schema-newer": ["startup.schemaTitle", "startup.schemaBody"],
    "database-busy": ["startup.lockedTitle", "startup.lockedBody"],
    stale: ["startup.staleTitle", "startup.staleBody"],
    missing: ["startup.missingTitle", "startup.missingBody"],
    invalid: ["startup.unavailableTitle", "startup.unavailableBody"],
    "database-failed": ["startup.unavailableTitle", "startup.unavailableBody"],
  } as const;
  const [title, body] = copy[readiness.dataRoot.reason];
  return (
    <StartupFrame>
      <section className={styles.startupCard} aria-labelledby="startup-error-title">
        <TriangleAlert aria-hidden="true" />
        <h1 id="startup-error-title">{t(title)}</h1>
        <p>{t(body)}</p>
        <Muted as="p">{t("startup.noBlank")}</Muted>
        <Diagnostic error={readiness.dataRoot.error} />
        <ActionGroup>
          <Button variant="primary" onPress={() => void props.retry()}>
            {t("actions.retry")}
          </Button>
          <Button onPress={props.recover}>{t("actions.chooseAnother")}</Button>
        </ActionGroup>
      </section>
    </StartupFrame>
  );
}

export function CodexBanner({ readiness }: { readiness: Readiness }) {
  const { t } = useTranslation();
  if (readiness.codex.status === "available") return null;
  const message =
    readiness.codex.reason === "missing"
      ? "codex.missing"
      : readiness.codex.reason === "unsupported-version"
        ? "codex.unsupported"
        : "codex.unavailable";
  return (
    <Feedback live="off" tone="warning">
      <div>
        {t(message)}
        <Diagnostic error={readiness.codex.error} />
      </div>
    </Feedback>
  );
}
