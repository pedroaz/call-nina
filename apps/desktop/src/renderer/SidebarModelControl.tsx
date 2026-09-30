import { useCallback, useEffect, useState } from "react";
import type {
  DesktopIpcResponse,
  DesktopIpcRequest,
  AiModelPreference,
  CallNinaError,
} from "@call-nina/contracts";
import { resolveModelPreference } from "@call-nina/domain";
import { useTranslation } from "react-i18next";
import { Button, Disclosure } from "./components/ui/index.js";
import styles from "./SidebarModelControl.module.css";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";

type View = Extract<DesktopIpcResponse, { status: "ok"; channel: "ai-connections/read" }>["result"];
type Action = Extract<DesktopIpcRequest, { channel: "ai-connections/update" }>["payload"]["action"];

// Shared minimal current selector. Full connection authoring/onboarding belongs
// to the settings tasks; no control stores a per-activity route or model.
export function SidebarModelControl() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const load = useCallback(async () => {
    try {
      setView(await invokeDesktop("ai-connections/read", {}));
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "data-root-changed" ||
        (event.event === "state-invalidated" && ["settings", "account"].includes(event.scope))
      )
        void load();
    });
    return () => {
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
    if (!view) return;
    setBusy(true);
    setError(undefined);
    try {
      setView(
        await invokeDesktop("ai-connections/update", {
          expectedGeneration: view.expectedGeneration,
          expectedRevision: view.settings.revision,
          action,
        }),
      );
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
      await load();
    } finally {
      setBusy(false);
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
      <Disclosure label={model?.displayName ?? active?.label ?? t("connections.title")}>
        <p className={styles.navModelStatus}>{t("connections.single")}</p>
        {view && (
          <>
            {active ? (
              <>
                <label className={styles.navModelField}>
                  <span>{t("connections.active")}</span>
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
                </label>
                <label className={styles.navModelField}>
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
                    <option value="automatic">{t("connections.runtimeDefault")}</option>
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
                </label>
                <label className={styles.navModelField}>
                  <span>{t("settings.effort")}</span>
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
                </label>
                {availability?.status !== "available" && <p>{t("connections.unavailable")}</p>}
                {view.settings.connections.length === 1 && (
                  <Button
                    isDisabled={busy}
                    onPress={() =>
                      void mutate({
                        kind: "remove",
                        connectionId: active.id,
                        nextActiveConnectionId: null,
                      })
                    }
                  >
                    {t("connections.disconnect")}
                  </Button>
                )}
              </>
            ) : (
              <>
                <p>{t("connections.none")}</p>
                <Button
                  isDisabled={busy}
                  onPress={() =>
                    void mutate({
                      kind: "save",
                      connection: {
                        id: crypto.randomUUID(),
                        label: "Codex",
                        routeId: "codex",
                        preference: {
                          model: { mode: "automatic" },
                          effort: { mode: "semantic", effort: "balanced" },
                        },
                      },
                      credential: { action: "keep" },
                    })
                  }
                >
                  {t("connections.connectCodex")}
                </Button>
              </>
            )}
            {view.settings.migrationNotice && (
              <>
                <p>{t("connections.migrated")}</p>
                <Button
                  isDisabled={busy}
                  onPress={() => void mutate({ kind: "dismiss-migration" })}
                >
                  {t("connections.dismiss")}
                </Button>
              </>
            )}
            {view.settings.retiredSecretRefs.length > 0 && <p>{t("connections.cleanupPending")}</p>}
          </>
        )}
      </Disclosure>
      {error && (
        <p role="alert" className={styles.navModelError}>
          {t(error.kind === "conflict" ? "connections.wait" : error.messageKey)}
        </p>
      )}
    </section>
  );
}
