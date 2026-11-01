import { type CallNinaError } from "@call-nina/contracts";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import { type Integration } from "./SettingsPage.types.js";

interface Options {
  mounted: { current: boolean };
  readEpoch: { current: number };
  setBusy: (busy: boolean) => void;
  setError: (error: CallNinaError | undefined) => void;
  setNotice: (notice: string | undefined) => void;
}
export function useIntegrationSettings({
  mounted,
  readEpoch,
  setBusy,
  setError,
  setNotice,
}: Options) {
  const { t } = useTranslation();
  const [integrationReadError, setIntegrationReadError] = useState<CallNinaError>();
  const [readingIntegration, setReadingIntegration] = useState(false);
  const [integrationFailure, setIntegrationFailure] = useState<string>();
  const [integrationNotice, setIntegrationNotice] = useState<string>();
  const [integration, setIntegration] = useState<Integration>();
  const integrationReadRevision = useRef(0);
  const integrationActionPending = useRef(false);
  const refreshIntegration = useCallback(async () => {
    if (integrationActionPending.current) return;
    const revision = ++integrationReadRevision.current;
    const epoch = readEpoch.current;
    setReadingIntegration(true);
    try {
      const result = await invokeDesktop("codex/integration/read", {});
      if (
        !mounted.current ||
        revision !== integrationReadRevision.current ||
        epoch !== readEpoch.current
      )
        return;
      setIntegration(result);
      setIntegrationReadError(undefined);
    } catch (cause) {
      if (
        !mounted.current ||
        revision !== integrationReadRevision.current ||
        epoch !== readEpoch.current
      )
        return;
      setIntegrationReadError(normalizeDesktopError(cause).detail);
    } finally {
      if (
        mounted.current &&
        revision === integrationReadRevision.current &&
        epoch === readEpoch.current
      )
        setReadingIntegration(false);
    }
  }, [mounted, readEpoch]);
  const manageIntegration = async (action: "install" | "refresh" | "uninstall") => {
    if (integrationActionPending.current) return;
    integrationActionPending.current = true;
    // An older status read must not overwrite the verified action result.
    integrationReadRevision.current += 1;
    setReadingIntegration(false);
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setIntegrationFailure(undefined);
    setIntegrationNotice(undefined);
    try {
      const result = await invokeDesktop("codex/integration/action", { action });
      setIntegration(result.status);
      if (result.result === "failed") setIntegrationFailure("settings.plugin.actionFailed");
      else setIntegrationNotice(`settings.plugin.success.${result.action}`);
    } catch {
      setIntegrationFailure("settings.plugin.actionFailed");
    } finally {
      integrationActionPending.current = false;
      setBusy(false);
    }
  };
  const resetIntegration = useCallback(() => {
    integrationReadRevision.current = integrationReadRevision.current + 1;
    setIntegration(undefined);
  }, []);
  const integrationPending = useCallback(() => integrationActionPending.current, []);
  return {
    integrationReadError,
    readingIntegration,
    integrationFailure: integrationFailure ? t(integrationFailure) : undefined,
    integrationNotice: integrationNotice ? t(integrationNotice) : undefined,
    integration,
    refreshIntegration,
    manageIntegration,
    resetIntegration,
    integrationPending,
  };
}
