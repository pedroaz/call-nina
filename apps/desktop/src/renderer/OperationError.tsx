import { useState, type ReactNode } from "react";
import type { CallNinaError } from "@call-nina/contracts";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  DiagnosticCode,
  Disclosure,
  Feedback,
  useNotifications,
} from "./components/ui/index.js";
import styles from "./OperationError.module.css";

export function ErrorReference({ error }: { error: CallNinaError }) {
  return (
    <ReferenceDetails
      key={`${error.reference.code}:${error.reference.correlationId}`}
      error={error}
    />
  );
}

function ReferenceDetails({ error }: { error: CallNinaError }) {
  const { t } = useTranslation();
  const { notify } = useNotifications();
  const [copyFailed, setCopyFailed] = useState(false);
  const [copying, setCopying] = useState(false);
  const copy = async () => {
    setCopying(true);
    setCopyFailed(false);
    try {
      const reference = `${error.reference.code} · ${error.reference.correlationId}`;
      try {
        await navigator.clipboard.writeText(reference);
      } catch {
        // Electron denies clipboard API permission requests. A user-initiated
        // copy event can supply plain text without expanding renderer privileges.
        const onCopy = (event: ClipboardEvent) => {
          event.clipboardData?.setData("text/plain", reference);
          event.preventDefault();
        };
        document.addEventListener("copy", onCopy);
        try {
          // Electron denies the modern clipboard API; retain this user-initiated fallback.
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          if (!document.execCommand("copy")) throw new Error("OD_REFERENCE_COPY_FAILED");
        } finally {
          document.removeEventListener("copy", onCopy);
        }
      }
      notify({ message: t("feedback.referenceCopied"), tone: "success" });
    } catch {
      setCopyFailed(true);
    } finally {
      setCopying(false);
    }
  };
  return (
    <Disclosure variant="inline" density="compact" label={t("feedback.technicalDetails")}>
      <div className={styles.reference}>
        <DiagnosticCode data-testid="diagnostic-reference">
          {error.reference.code} · {error.reference.correlationId}
        </DiagnosticCode>
        {error.kind === "ai-policy" && <p>{t("feedback.policySupport")}</p>}
        <Button
          variant="quiet"
          density="compact"
          isDisabled={copying}
          onPress={() => void copy()}
          leadingIcon={<Copy aria-hidden="true" />}
        >
          {t("feedback.copyReference")}
        </Button>
        {copyFailed && <p role="status">{t("feedback.copyFailed")}</p>}
      </div>
    </Disclosure>
  );
}

export function OperationError({
  error,
  children,
}: {
  error: CallNinaError;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (error.kind === "cancellation")
    return <Feedback live="polite">{t(error.messageKey)}</Feedback>;
  return (
    <div className={styles.error}>
      <Feedback live="assertive" tone="error">
        <p>{t(error.messageKey)}</p>
      </Feedback>
      <ErrorReference error={error} />
      {children}
    </div>
  );
}
