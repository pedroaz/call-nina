import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesktopIpcResponse,
  DesktopIpcRequest,
  AiModelPreference,
  CallNinaError,
} from "@call-nina/contracts";
import { resolveModelPreference } from "@call-nina/domain";
import { useTranslation } from "react-i18next";
import { Button, Disclosure, FieldGroup } from "./components/ui/index.js";
import styles from "./SidebarModelControl.module.css";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";

type View = Extract<DesktopIpcResponse, { status: "ok"; channel: "ai-connections/read" }>["result"];
type Action = Extract<DesktopIpcRequest, { channel: "ai-connections/update" }>["payload"]["action"];

export function SidebarModelControl({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const rootEpoch = useRef(0);
  const readSerial = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const epoch = rootEpoch.current;
    const serial = ++readSerial.current;
    try {
      const next = await invokeDesktop("ai-connections/read", {});
      if (mounted.current && epoch === rootEpoch.current && serial === readSerial.current)
        setView(next);
    } catch (cause) {
      if (mounted.current && epoch === rootEpoch.current && serial === readSerial.current)
        setError(normalizeDesktopError(cause).detail);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const epochRef = rootEpoch;
    const timer = window.setTimeout(() => void load(), 0);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        rootEpoch.current++;
        readSerial.current++;
        setView(undefined);
        setBusy(false);
        setError(undefined);
      }
      if (
        event.event === "data-root-changed" ||
        (event.event === "state-invalidated" && ["ai-connections", "account"].includes(event.scope))
      )
        void load();
    });
    return () => {
      mounted.current = false;
      epochRef.current++;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);
  const active = view?.settings.connections.find(
    (entry) => entry.id === view.settings.activeConnectionId,
  );
  const availability = view?.availability.find((entry) => entry.connectionId === active?.id);
  const catalog = availability?.models;
  const resolution =
    active && catalog ? resolveModelPreference(active.preference, catalog) : undefined;
  const model = catalog?.models.find(
    (entry) =>
      entry.id ===
      (active?.preference.model.mode === "exact"
        ? active.preference.model.modelId
        : catalog.runtimeDefaultModelId),
  );
  const mutate = async (action: Action) => {
    if (!view || busy) return;
    const epoch = rootEpoch.current;
    setBusy(true);
    setError(undefined);
    try {
      const next = await invokeDesktop("ai-connections/update", {
        expectedGeneration: view.expectedGeneration,
        expectedRevision: view.settings.revision,
        action,
      });
      if (mounted.current && epoch === rootEpoch.current) setView(next);
    } catch (cause) {
      if (!mounted.current || epoch !== rootEpoch.current) return;
      setError(normalizeDesktopError(cause).detail);
      await load();
    } finally {
      if (mounted.current && epoch === rootEpoch.current) setBusy(false);
    }
  };
  const save = (preference: AiModelPreference) => {
    if (!active) return;
    const connection = {
      id: active.id,
      label: active.label,
      routeId: active.routeId,
      preference: active.preference,
    };
    void mutate({
      kind: "save",
      connection: { ...connection, preference },
      credential: { action: "keep" },
    });
  };
  return (
    <section
      className={styles.navModelPanel}
      aria-busy={busy}
      aria-label={t("connections.title")}
      data-ai-connection={active?.id ?? ""}
      data-route={active?.routeId ?? ""}
      data-root-generation={view?.expectedGeneration}
      data-connection-revision={view?.settings.revision}
      data-effective-model={resolution?.status === "available" ? resolution.effectiveModelId : ""}
      data-effective-effort={resolution?.status === "available" ? resolution.effectiveEffortId : ""}
      data-default-effort={model?.defaultReasoningEffort ?? ""}
    >
      <Disclosure
        density="compact"
        label={model?.displayName ?? active?.label ?? t("connections.title")}
      >
        {view && (
          <>
            {active ? (
              <>
                {view.settings.connections.length > 1 && (
                  <FieldGroup density="compact">
                    <span>{t("modelControl.connection")}</span>
                    <select
                      disabled={busy}
                      value={active.id}
                      onChange={(event) =>
                        void mutate({ kind: "activate", connectionId: event.currentTarget.value })
                      }
                    >
                      {view.settings.connections.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </FieldGroup>
                )}
                <FieldGroup density="compact">
                  <span>{t("modelControl.model")}</span>
                  <select
                    disabled={busy || !catalog}
                    value={
                      active.preference.model.mode === "automatic"
                        ? "automatic"
                        : active.preference.model.modelId
                    }
                    onChange={(event) => {
                      save({
                        ...active.preference,
                        model:
                          event.currentTarget.value === "automatic"
                            ? { mode: "automatic" }
                            : { mode: "exact", modelId: event.currentTarget.value },
                      });
                    }}
                  >
                    <option value="automatic">{t("modelControl.default")}</option>
                    {active.preference.model.mode === "exact" &&
                      !catalog?.models.some(
                        (entry) =>
                          entry.id ===
                          (active.preference.model.mode === "exact"
                            ? active.preference.model.modelId
                            : ""),
                      ) && (
                        <option value={active.preference.model.modelId}>
                          {active.preference.model.modelId}
                        </option>
                      )}
                    {catalog?.models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.displayName}
                      </option>
                    ))}
                  </select>
                </FieldGroup>
                <FieldGroup density="compact">
                  <span>{t("modelControl.reasoning")}</span>
                  <select
                    disabled={busy || !model}
                    value={
                      active.preference.effort.mode === "semantic"
                        ? `semantic:${active.preference.effort.effort}`
                        : active.preference.effort.effortId
                    }
                    onChange={(event) => {
                      save({
                        ...active.preference,
                        effort: event.currentTarget.value.startsWith("semantic:")
                          ? {
                              mode: "semantic",
                              effort: event.currentTarget.value.slice(9) as
                                "fast" | "balanced" | "deep",
                            }
                          : { mode: "exact", effortId: event.currentTarget.value },
                      });
                    }}
                  >
                    {(["fast", "balanced", "deep"] as const).map((effort) => (
                      <option key={effort} value={`semantic:${effort}`}>
                        {t(`settings.semanticEfforts.${effort}`)}
                      </option>
                    ))}
                    {active.preference.effort.mode === "exact" &&
                      !model?.supportedReasoningEfforts.includes(
                        active.preference.effort.effortId,
                      ) && (
                        <option value={active.preference.effort.effortId}>
                          {active.preference.effort.effortId}
                        </option>
                      )}
                    {model?.supportedReasoningEfforts.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                </FieldGroup>
                {availability && !["available", "configured"].includes(availability.status) && (
                  <p className={styles.navModelStatus} role="status">
                    {t(`connectionSettings.status.${availability.status}`)}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.navModelStatus}>{t("connections.none")}</p>
            )}
          </>
        )}
        <Button variant="quiet" density="compact" onPress={onOpenSettings}>
          {t("modelControl.settings")}
        </Button>
      </Disclosure>
      {error && (
        <p role="alert" className={styles.navModelError}>
          {t(error.kind === "conflict" ? "connections.wait" : error.messageKey)}
        </p>
      )}
    </section>
  );
}
