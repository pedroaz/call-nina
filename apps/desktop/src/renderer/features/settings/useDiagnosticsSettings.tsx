import { type CallNinaError } from "@call-nina/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, useNotifications } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import { type Diagnostics, type DiagnosticsExport } from "./SettingsPage.types.js";

interface Options {
  setBusy: (busy: boolean) => void;
  setError: (error: CallNinaError | undefined) => void;
  actionBusy: boolean;
  checkingStatus: boolean;
}
export function useDiagnosticsSettings({ setBusy, setError, actionBusy, checkingStatus }: Options) {
  const { t } = useTranslation();
  const { notify } = useNotifications();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [diagnosticsReadError, setDiagnosticsReadError] = useState<CallNinaError>();
  const readDiagnostics = async () => {
    setBusy(true);
    try {
      setDiagnostics(await invokeDesktop("diagnostics/read", {}));
      setDiagnosticsReadError(undefined);
    } catch (cause) {
      setDiagnosticsReadError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const clearLogs = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("logs/clear", {});
      setDiagnostics((current) => (current ? { ...current, logFileCount: 0 } : current));
      notify({
        message: "settings.logsCleared",
        values: { count: result.clearedFileCount },
        tone: "success",
      });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const exportDiagnostics = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result: DiagnosticsExport = await invokeDesktop("diagnostics/export", {});
      if (result.status === "exported")
        notify({ message: "settings.diagnosticsExported", values: result, tone: "success" });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  const diagnosticsFailure = diagnosticsReadError && (
    <OperationError error={diagnosticsReadError}>
      <Button
        variant="secondary"
        isPending={actionBusy}
        isDisabled={checkingStatus}
        onPress={() => void readDiagnostics()}
      >
        {t("actions.retry")}
      </Button>
    </OperationError>
  );
  return { diagnostics, diagnosticsFailure, readDiagnostics, clearLogs, exportDiagnostics };
}
