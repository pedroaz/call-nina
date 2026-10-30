import { OperationError } from "./OperationError.js";
import { ProviderStatus } from "./ProviderStatus.js";
import { ProviderRouting } from "./ProviderRouting.js";
import { NinaAccountSettings } from "./NinaAccount.js";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type {
  CallNinaError,
  AiConnection,
  AiModelPreference,
  DesktopIpcRequest,
  DesktopIpcResponse,
  OfflineSnapshot,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { resolveModelPreference } from "@call-nina/domain";
import {
  Button,
  Feedback,
  useNotifications,
  SelectField,
  TextField,
  ModalDialog,
  Disclosure,
} from "./components/ui/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import { Section } from "./components/layout/index.js";
import styles from "./ConnectionSettings.module.css";

type View = Extract<DesktopIpcResponse, { status: "ok"; channel: "ai-connections/read" }>["result"];
type Action = Extract<DesktopIpcRequest, { channel: "ai-connections/update" }>["payload"]["action"];
type Draft = Pick<AiConnection, "id" | "label" | "routeId" | "preference">;
type CredentialDraft = { action: "keep" | "replace" | "remove"; secret: string };
type Route = Draft["routeId"];
type OfflineView = View["offlineModel"];
const activeOfflineStates: OfflineSnapshot["state"][] = ["downloading", "verifying", "removing"];
const directRoutes: Route[] = ["openai", "anthropic", "google"];
const defaultPreference: AiModelPreference = {
  model: { mode: "automatic" },
  effort: { mode: "semantic", effort: "balanced" },
};
const withoutDraft = (drafts: Record<string, Draft>, id: string) =>
  Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== id));
const withoutCredential = (credentials: Record<string, CredentialDraft>, id: string) =>
  Object.fromEntries(Object.entries(credentials).filter(([key]) => key !== id));

export type ConnectionSettingsHandle = { refreshStatus: () => Promise<void> };

export function ConnectionSettings({
  ref,
  active,
  disabled = false,
  onPendingChange,
  onBusyChange,
  authHelp,
  chatgptAccess,
  chatgptConnected,
  feedbackTarget,
}: {
  ref?: Ref<ConnectionSettingsHandle>;
  onBusyChange?: (busy: boolean) => void;
  feedbackTarget?: HTMLElement | null;
  active: boolean;
  chatgptConnected?: boolean | undefined;
  disabled?: boolean;
  surface?: boolean;
  onPendingChange?: (pending: boolean) => void;
  authHelp?: string;
  chatgptAccess?: (context: { active: boolean; saved: boolean; dirty: boolean }) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { notify } = useNotifications();
  const [view, setView] = useState<View>();
  const [readError, setReadError] = useState<CallNinaError>();
  const [reading, setReading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [credentials, setCredentials] = useState<Record<string, CredentialDraft>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, setBusy] = useState(false);
  const busy = saving || disabled;
  const [failure, setError] = useState<string | CallNinaError>();
  const error = typeof failure === "string" ? failure : undefined;
  const operationError = typeof failure === "object" ? failure : undefined;
  const [offline, setOffline] = useState<OfflineView>();
  const [offlineReadError, setOfflineReadError] = useState<CallNinaError>();
  const [readingOffline, setReadingOffline] = useState(false);
  const offlineReadSerial = useRef(0);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [confirmOfflineRemove, setConfirmOfflineRemove] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const offlineRef = useRef<HTMLDivElement>(null);
  const rootEpoch = useRef(0);
  const readSerial = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const epoch = rootEpoch.current;
    const serial = ++readSerial.current;
    setReading(true);
    try {
      const next = await invokeDesktop("ai-connections/read", {});
      if (!mounted.current || epoch !== rootEpoch.current || serial !== readSerial.current) return;
      setView(next);
      setOffline(next.offlineModel);
      setReadError(undefined);
      setOfflineReadError(undefined);
    } catch (cause) {
      if (!mounted.current || epoch !== rootEpoch.current || serial !== readSerial.current) return;
      setReadError(normalizeDesktopError(cause).detail);
    } finally {
      if (mounted.current && epoch === rootEpoch.current && serial === readSerial.current)
        setReading(false);
    }
  }, []);
  useImperativeHandle(ref, () => ({ refreshStatus: load }), [load]);
  useEffect(() => {
    mounted.current = true;
    const epochRef = rootEpoch;
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        rootEpoch.current++;
        readSerial.current++;
        setView(undefined);
        setOffline(undefined);
        setBusy(false);
        setOfflineBusy(false);
        setError(undefined);
        setReadError(undefined);
        setOfflineReadError(undefined);
        setReadingOffline(false);
        offlineReadSerial.current++;
        setDrafts({});
        setCredentials({});
        setSelectedId(undefined);
        setConfirmOfflineRemove(false);
        setConfirmRemove(false);
        void load();
      } else if (
        event.event === "state-invalidated" &&
        ["ai-connections", "account"].includes(event.scope)
      ) {
        void load();
      }
    });
    return () => {
      mounted.current = false;
      epochRef.current++;
      unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const offlineState = offline?.snapshot.state;
  const offlinePreflight = offline?.snapshot.preflight;
  const offlineEligibility =
    offlineState === "installed" || offlineState === "generating"
      ? offlinePreflight?.generationEligibility
      : offlinePreflight?.installationEligibility;
  const gib = (bytes: number | null | undefined) =>
    bytes == null
      ? "—"
      : (bytes / 1024 ** 3).toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const offlineJob = Boolean(offlineState && activeOfflineStates.includes(offlineState));
  const [pageVisible, setPageVisible] = useState(document.visibilityState === "visible");
  useEffect(() => {
    const onVisibility = () => {
      setPageVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const readOffline = useCallback(async () => {
    const epoch = rootEpoch.current;
    const serial = ++offlineReadSerial.current;
    setReadingOffline(true);
    try {
      const next = await invokeDesktop("offline-model/read", {});
      if (!mounted.current || epoch !== rootEpoch.current || serial !== offlineReadSerial.current)
        return;
      setOffline(next);
      setOfflineReadError(undefined);
      return next;
    } catch (cause) {
      if (mounted.current && epoch === rootEpoch.current && serial === offlineReadSerial.current)
        setOfflineReadError(normalizeDesktopError(cause).detail);
    } finally {
      if (mounted.current && epoch === rootEpoch.current && serial === offlineReadSerial.current)
        setReadingOffline(false);
    }
  }, []);
  useEffect(() => {
    if (!offlineJob || !pageVisible || !active) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const next = await readOffline();
      if (cancelled || !next) return;
      if (activeOfflineStates.includes(next.snapshot.state)) {
        timer = window.setTimeout(() => void poll(), 1500);
      } else void load();
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [offlineJob, pageVisible, active, load, readOffline]);

  const manageOffline = async (action: "install" | "cancel" | "remove") => {
    if (offlineBusy || busy) return;
    const epoch = rootEpoch.current;
    setOfflineBusy(true);
    readSerial.current++;
    offlineReadSerial.current++;
    setReading(false);
    setReadingOffline(false);
    setError(undefined);
    try {
      const next = await invokeDesktop("offline-model/manage", { action });
      if (!mounted.current || epoch !== rootEpoch.current) return;
      setOffline(next);
      setConfirmOfflineRemove(false);
      if (action !== "install") window.setTimeout(() => offlineRef.current?.focus(), 0);
      if (!activeOfflineStates.includes(next.snapshot.state)) void load();
    } catch (cause) {
      if (!mounted.current || epoch !== rootEpoch.current) return;
      const detail = normalizeDesktopError(cause).detail;
      if (detail.kind === "conflict") setError("connectionSettings.offlineBusyConflict");
      else setError(detail);
      void load();
    } finally {
      if (mounted.current && epoch === rootEpoch.current) setOfflineBusy(false);
    }
  };

  const saved = view?.settings.connections.find((entry) => entry.id === selectedId);
  const draft = selectedId ? (drafts[selectedId] ?? saved) : undefined;
  const credential = selectedId ? (credentials[selectedId]?.secret ?? "") : "";
  const credentialAction = selectedId ? (credentials[selectedId]?.action ?? "keep") : "keep";
  const availability = view?.availability.find((entry) => entry.connectionId === selectedId);
  const directCatalog = view?.directApiCatalogs.find((entry) => entry.routeId === draft?.routeId);
  const modelCatalog =
    directCatalog?.models ??
    (draft?.routeId === "local" ? offline?.catalog.models : availability?.models);
  const resolution =
    saved && modelCatalog ? resolveModelPreference(saved.preference, modelCatalog) : undefined;
  const effectiveModel = modelCatalog?.models.find(
    (entry) => resolution?.status === "available" && entry.id === resolution.effectiveModelId,
  );
  const listedOperations =
    directCatalog?.operations ??
    (draft?.routeId === "local" ? offline?.catalog.operations : availability?.operations);
  const isDirect = Boolean(draft && directRoutes.includes(draft.routeId));
  const selectedModelId =
    draft?.preference.model.mode === "exact" ? draft.preference.model.modelId : undefined;
  const draftModel = modelCatalog?.models.find(
    (entry) => entry.id === (selectedModelId ?? modelCatalog.runtimeDefaultModelId),
  );
  const hasChanges = (entry: Draft) => {
    const original = view?.settings.connections.find((connection) => connection.id === entry.id);
    return (
      !original ||
      original.label !== entry.label ||
      original.routeId !== entry.routeId ||
      JSON.stringify(original.preference) !== JSON.stringify(entry.preference)
    );
  };
  const dirty = Boolean(draft && (hasChanges(draft) || credentialAction !== "keep"));
  const pending =
    saving ||
    offlineBusy ||
    Object.values(drafts).some((entry) => entry.routeId !== "claude-code" && hasChanges(entry)) ||
    Object.values(credentials).some((entry) => entry.action !== "keep");
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  useEffect(() => {
    onBusyChange?.(saving || offlineBusy);
    return () => onBusyChange?.(false);
  }, [saving, offlineBusy, onBusyChange]);
  const select = (id: string) => {
    void load();
    setSelectedId(id);
    setConfirmRemove(false);
    setConfirmOfflineRemove(false);
    setError(undefined);
  };
  const updateDraft = (change: Partial<Draft>) => {
    if (!draft) return;
    setDrafts((current) => ({ ...current, [draft.id]: { ...draft, ...change } }));
  };
  const updateCredential = (change: Partial<CredentialDraft>) => {
    if (!selectedId) return;
    setCredentials((current) => ({
      ...current,
      [selectedId]: { action: "keep", secret: "", ...current[selectedId], ...change },
    }));
  };
  const mutate = async (action: Action) => {
    if (!view || busy) return false;
    const epoch = rootEpoch.current;
    readSerial.current++;
    setReading(false);
    setBusy(true);
    setError(undefined);
    try {
      const next = await invokeDesktop("ai-connections/update", {
        expectedGeneration: view.expectedGeneration,
        expectedRevision: view.settings.revision,
        action,
      });
      if (!mounted.current || epoch !== rootEpoch.current) return false;
      setView(next);
      setOffline(next.offlineModel);
      if (action.kind === "save")
        notify({ message: t("connectionSettings.saved"), tone: "success" });
      return true;
    } catch (cause) {
      if (!mounted.current || epoch !== rootEpoch.current) return false;
      const detail = normalizeDesktopError(cause).detail;
      if (detail.kind === "conflict") setError("connections.wait");
      else setError(detail);
      await load();
      return false;
    } finally {
      if (mounted.current && epoch === rootEpoch.current) setBusy(false);
    }
  };
  const save = async () => {
    if (!draft || !draft.label.trim()) {
      setError("connectionSettings.nameRequired");
      return;
    }
    if ((credentialAction === "replace" || (isDirect && !saved?.secretRef)) && !credential) {
      setError("connectionSettings.keyRequired");
      return;
    }
    const ok = await mutate({
      kind: "save",
      connection: {
        id: draft.id,
        label: draft.label.trim(),
        routeId: draft.routeId,
        preference: draft.preference,
      },
      credential:
        credentialAction === "replace"
          ? { action: "replace", secret: credential }
          : { action: credentialAction },
    });
    if (ok) {
      setDrafts((current) => withoutDraft(current, draft.id));
      setCredentials((current) => withoutCredential(current, draft.id));
      setSelectedId(undefined);
    }
  };
  const remove = async () => {
    if (!saved || !view) return;
    const ok = await mutate({ kind: "remove", connectionId: saved.id });
    if (ok) {
      setDrafts((current) => withoutDraft(current, saved.id));
      setCredentials((current) => withoutCredential(current, saved.id));
      setSelectedId(undefined);
      setConfirmRemove(false);
      window.setTimeout(() => {
        listRef.current?.focus();
      }, 0);
    }
  };
  const add = (routeId: Route) => {
    const existing =
      view?.settings.connections.find((entry) => entry.routeId === routeId) ??
      Object.values(drafts).find((entry) => entry.routeId === routeId);
    if (existing) {
      select(existing.id);
      return;
    }
    const id = crypto.randomUUID();
    setDrafts((current) => ({
      ...current,
      [id]: {
        id,
        label: t(`connectionSettings.routes.${routeId}`),
        routeId,
        preference: defaultPreference,
      },
    }));
    select(id);
  };
  const discard = () => {
    if (!draft) return;
    setDrafts((current) => withoutDraft(current, draft.id));
    setCredentials((current) => withoutCredential(current, draft.id));
    setSelectedId(undefined);
  };

  const readFailure = readError && (
    <OperationError error={readError}>
      <Button
        variant="secondary"
        isPending={reading}
        isDisabled={busy || offlineBusy}
        onPress={() => void load()}
      >
        {t("actions.retry")}
      </Button>
    </OperationError>
  );
  const offlineReadFailure = offlineReadError && (
    <OperationError error={offlineReadError}>
      <Button
        variant="secondary"
        isPending={readingOffline}
        isDisabled={busy || offlineBusy}
        onPress={() => void readOffline()}
      >
        {t("actions.retry")}
      </Button>
    </OperationError>
  );
  return (
    <div className={styles.panel} aria-busy={busy} data-provider-detail={Boolean(draft)}>
      {!draft && readFailure}
      {!draft && offlineReadFailure}
      <div className={styles.providerOverview} ref={listRef} tabIndex={-1} data-focus-anchor>
        {view && (
          <ProviderRouting
            view={view}
            busy={busy}
            mutate={mutate}
            select={add}
            chatgptConnected={chatgptConnected}
          />
        )}
      </div>
      {draft ? (
        <ModalDialog
          isOpen
          title={t(`connectionSettings.routes.${draft.routeId}`)}
          closeLabel={t("actions.close")}
          isDismissable
          onOpenChange={(open) => {
            if (!open) {
              const untouched =
                !saved &&
                draft.label === t(`connectionSettings.routes.${draft.routeId}`) &&
                JSON.stringify(draft.preference) === JSON.stringify(defaultPreference) &&
                credentialAction === "keep";
              if (untouched) discard();
              else setSelectedId(undefined);
            }
          }}
        >
          <Section
            surface={false}
            className={styles.editor}
            aria-busy={busy}
            data-ai-connection={saved?.id ?? ""}
            data-route={saved?.routeId ?? ""}
            data-root-generation={view?.expectedGeneration}
            data-connection-revision={view?.settings.revision}
            data-dirty={dirty}
            data-effective-model={
              resolution?.status === "available" ? resolution.effectiveModelId : ""
            }
            data-effective-effort={
              resolution?.status === "available" ? resolution.effectiveEffortId : ""
            }
            data-default-effort={effectiveModel?.defaultReasoningEffort ?? ""}
          >
            {draft.routeId === "claude-code" ? (
              <p>{t("connectionSettings.claudeUnavailable")}</p>
            ) : availability?.status === "adapter-unavailable" ? (
              <p>{t("connectionSettings.routeUnavailable")}</p>
            ) : null}
            {view && draft.routeId !== "chatgpt" && (
              <ProviderStatus
                route={draft.routeId}
                view={view}
                chatgptConnected={chatgptConnected}
              />
            )}
            {draft.routeId === "chatgpt" &&
              (chatgptAccess ? (
                chatgptAccess({
                  active: true,
                  saved: Boolean(saved),
                  dirty: Boolean(saved) && dirty,
                })
              ) : (
                <p>{authHelp ?? t("connectionSettings.chatgptAuth")}</p>
              ))}
            {draft.routeId === "managed" && <NinaAccountSettings />}
            {isDirect && (
              <section className={styles.secret}>
                {view?.secureStorage.status === "unavailable" && (
                  <p>{t("connectionSettings.secureStorageUnavailable")}</p>
                )}
                {saved?.secretRef && credentialAction === "keep" ? (
                  <div className={styles.keySummary}>
                    <p>{t("connectionSettings.keySaved")}</p>
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        isDisabled={busy || view?.secureStorage.status !== "available"}
                        onPress={() => {
                          updateCredential({ action: "replace", secret: "" });
                        }}
                      >
                        {t("connectionSettings.replaceKey")}
                      </Button>
                      <Button
                        variant="quiet"
                        isDisabled={busy}
                        onPress={() => {
                          updateCredential({ action: "remove", secret: "" });
                        }}
                      >
                        {t("connectionSettings.removeKey")}
                      </Button>
                    </div>
                  </div>
                ) : credentialAction === "remove" ? (
                  <div className={styles.keySummary}>
                    <p>{t("providers.keyRemovalPending")}</p>
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() => {
                        updateCredential({ action: "keep", secret: "" });
                      }}
                    >
                      {t("actions.cancel")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <TextField
                      label={t(
                        saved?.secretRef
                          ? "connectionSettings.keyEntry"
                          : "connectionSettings.keyAction",
                      )}
                      error={error === "connectionSettings.keyRequired" ? t(error) : undefined}
                      type="password"
                      maxLength={8192}
                      disabled={busy || view?.secureStorage.status !== "available"}
                      autoComplete="off"
                      value={credential}
                      onChange={(event) => {
                        updateCredential({ action: "replace", secret: event.target.value });
                      }}
                    />
                    {saved?.secretRef && (
                      <Button
                        variant="quiet"
                        isDisabled={busy}
                        onPress={() => {
                          updateCredential({ action: "keep", secret: "" });
                        }}
                      >
                        {t("actions.cancel")}
                      </Button>
                    )}
                  </>
                )}
              </section>
            )}
            {draft.routeId !== "claude-code" && (
              <Disclosure label={t("connectionSettings.advanced")}>
                <div className={styles.modelControls}>
                  <SelectField
                    label={t("modelControl.model")}
                    disabled={busy || !modelCatalog}
                    value={
                      draft.preference.model.mode === "automatic"
                        ? "automatic"
                        : draft.preference.model.modelId
                    }
                    onChange={(event) => {
                      updateDraft({
                        preference: {
                          ...draft.preference,
                          effort: { mode: "semantic", effort: "balanced" },
                          model:
                            event.target.value === "automatic"
                              ? { mode: "automatic" }
                              : { mode: "exact", modelId: event.target.value },
                        },
                      });
                    }}
                  >
                    <option value="automatic">{t("connections.runtimeDefault")}</option>
                    {selectedModelId &&
                      !modelCatalog?.models.some((entry) => entry.id === selectedModelId) && (
                        <option value={selectedModelId}>{selectedModelId}</option>
                      )}
                    {modelCatalog?.models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.displayName}
                      </option>
                    ))}
                  </SelectField>

                  {Boolean(draftModel && draftModel.supportedReasoningEfforts.length > 1) && (
                    <SelectField
                      label={t("settings.effort")}
                      disabled={busy}
                      value={
                        draft.preference.effort.mode === "semantic"
                          ? `semantic:${draft.preference.effort.effort}`
                          : draft.preference.effort.effortId
                      }
                      onChange={(event) => {
                        updateDraft({
                          preference: {
                            ...draft.preference,
                            effort: event.target.value.startsWith("semantic:")
                              ? {
                                  mode: "semantic",
                                  effort: event.target.value.slice(9) as
                                    "fast" | "balanced" | "deep",
                                }
                              : { mode: "exact", effortId: event.target.value },
                          },
                        });
                      }}
                    >
                      {(["fast", "balanced", "deep"] as const).map((effort) => (
                        <option key={effort} value={`semantic:${effort}`}>
                          {t(`settings.semanticEfforts.${effort}`)}
                        </option>
                      ))}
                      {draft.preference.effort.mode === "exact" &&
                        !draftModel?.supportedReasoningEfforts.includes(
                          draft.preference.effort.effortId,
                        ) && (
                          <option value={draft.preference.effort.effortId}>
                            {draft.preference.effort.effortId}
                          </option>
                        )}
                      {draftModel?.supportedReasoningEfforts.map((effort) => (
                        <option key={effort} value={effort}>
                          {effort}
                        </option>
                      ))}
                    </SelectField>
                  )}
                </div>
              </Disclosure>
            )}
            {draft.routeId === "local" && offline && (
              <div ref={offlineRef} className={styles.offline} tabIndex={-1} data-focus-anchor>
                <h4>{t("connectionSettings.offlineTitle")}</h4>
                <p>{t("connectionSettings.offlineScope")}</p>
                <p>{t("connectionSettings.offlineLimits")}</p>
                <p role="status">
                  {t(`connectionSettings.offlineState.${offline.snapshot.state}`)}
                </p>
                {offline.snapshot.errorCode && (
                  <Feedback tone="error" live="assertive" density="compact">
                    {t("connectionSettings.offlineFailure")}
                  </Feedback>
                )}
                {offlineEligibility !== "ready" && offlineState !== "generating" && (
                  <p role="status">
                    {t(
                      `connectionSettings.offlineEligibility.${offlineEligibility ?? "resources-unknown"}`,
                    )}
                  </p>
                )}
                <p>
                  {t("connectionSettings.offlineMemoryReadout", {
                    total: gib(offlinePreflight?.totalMemoryBytes),
                    requiredTotal: gib(offline.catalog.admissionMemoryBytes),
                    available: gib(offlinePreflight?.freeMemoryBytes),
                    requiredAvailable: gib(offline.catalog.admissionFreeMemoryBytes),
                  })}
                </p>
                <p>
                  {t("connectionSettings.offlineDiskReadout", {
                    available: gib(offlinePreflight?.availableDiskBytes),
                    required: gib(offlinePreflight?.requiredDiskBytes),
                  })}
                </p>
                {(offline.snapshot.state === "downloading" ||
                  offline.snapshot.state === "verifying") && (
                  <p>
                    {t("connectionSettings.offlineProgress", {
                      downloaded: (offline.snapshot.downloadedBytes / 1_000_000_000).toFixed(2),
                      total: (offline.snapshot.downloadBytes / 1_000_000_000).toFixed(2),
                    })}
                  </p>
                )}
                <div className={styles.actions}>
                  {(offline.snapshot.state === "absent" ||
                    offline.snapshot.state === "partial" ||
                    offline.snapshot.state === "unavailable") && (
                    <Button
                      variant="primary"
                      isDisabled={
                        busy ||
                        offlineBusy ||
                        offline.snapshot.preflight?.installationEligibility !== "ready"
                      }
                      onPress={() => void manageOffline("install")}
                    >
                      {t(
                        offline.snapshot.state === "partial"
                          ? "connectionSettings.offlineResume"
                          : "connectionSettings.offlineInstall",
                      )}
                    </Button>
                  )}
                  {(offline.snapshot.state === "downloading" ||
                    offline.snapshot.state === "verifying") && (
                    <Button
                      variant="primary"
                      isDisabled={busy || offlineBusy}
                      onPress={() => void manageOffline("cancel")}
                    >
                      {t("connectionSettings.offlineCancelDownload")}
                    </Button>
                  )}
                  {(offline.snapshot.state === "installed" ||
                    offline.snapshot.state === "partial" ||
                    offline.snapshot.state === "unavailable") && (
                    <Button
                      variant="primary"
                      isDisabled={busy || offlineBusy}
                      onPress={() => {
                        setConfirmOfflineRemove(true);
                      }}
                    >
                      {t("connectionSettings.offlineRemove")}
                    </Button>
                  )}
                </div>
                {confirmOfflineRemove && (
                  <div className={styles.confirm}>
                    <p>{t("connectionSettings.offlineRemoveWarning")}</p>
                    <div className={styles.actions}>
                      <Button
                        variant="primary"
                        isDisabled={busy || offlineBusy}
                        onPress={() => void manageOffline("remove")}
                      >
                        {t("connectionSettings.offlineConfirmRemove")}
                      </Button>
                      <Button
                        variant="secondary"
                        isDisabled={busy || offlineBusy}
                        onPress={() => {
                          setConfirmOfflineRemove(false);
                        }}
                      >
                        {t("actions.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Disclosure label={t("connectionSettings.details")}>
              <div className={styles.detailsBody}>
                <p>{t(`connectionSettings.destination.${draft.routeId}`)}</p>
                {directCatalog && <p>{t("connectionSettings.directCatalogNotice")}</p>}
                {availability?.status === "inactive" &&
                !isDirect &&
                draft.routeId !== "local" ? null : listedOperations?.length ? (
                  <p>
                    {t("connectionSettings.operations", {
                      operations: listedOperations
                        .map((operation) => t(`connectionSettings.operation.${operation}`))
                        .join(", "),
                    })}
                  </p>
                ) : (
                  <p>{t("connectionSettings.noOperations")}</p>
                )}
                {saved && (
                  <div className={styles.remove}>
                    <Button
                      variant="quiet"
                      isDisabled={busy || dirty}
                      onPress={() => {
                        setConfirmRemove(true);
                      }}
                    >
                      {t("connectionSettings.remove")}
                    </Button>
                    {confirmRemove && (
                      <div className={styles.confirm}>
                        <p>{t("connectionSettings.removeWarning")}</p>
                        <div className={styles.actions}>
                          <Button variant="danger" isDisabled={busy} onPress={() => void remove()}>
                            {t("connectionSettings.confirmRemove")}
                          </Button>
                          <Button
                            variant="secondary"
                            isDisabled={busy}
                            onPress={() => {
                              setConfirmRemove(false);
                            }}
                          >
                            {t("actions.cancel")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Disclosure>
            {readFailure}
            {offlineReadFailure}
            {operationError && <OperationError error={operationError} />}
            {error && error !== "connectionSettings.keyRequired" && (
              <Feedback tone="error" live="assertive">
                {t(error)}
              </Feedback>
            )}
            {(dirty || saving) && draft.routeId !== "claude-code" && (
              <div className={styles.editorActions}>
                <Button variant="secondary" isDisabled={busy || !dirty} onPress={discard}>
                  {t("settings.discard")}
                </Button>
                <Button variant="primary" isDisabled={busy || !dirty} onPress={() => void save()}>
                  {t("settings.save")}
                </Button>
              </div>
            )}
          </Section>
        </ModalDialog>
      ) : !view ? (
        <p>{t("settings.loading")}</p>
      ) : null}
      {view?.settings.migrationNotice && (
        <div className={styles.notice}>
          <Check aria-hidden="true" />
          <p>{t("connections.migrated")}</p>
          <Button
            variant="quiet"
            isDisabled={busy}
            onPress={() => void mutate({ kind: "dismiss-migration" })}
          >
            {t("connections.dismiss")}
          </Button>
        </div>
      )}
      {view && view.settings.retiredSecretRefs.length > 0 && (
        <p>{t("connections.cleanupPending")}</p>
      )}
      {!draft &&
        (feedbackTarget ? (
          createPortal(
            <>
              {operationError && <OperationError error={operationError} />}
              {error && (
                <Feedback tone="error" live="assertive">
                  {t(error)}
                </Feedback>
              )}
            </>,
            feedbackTarget,
          )
        ) : (
          <>
            {operationError && <OperationError error={operationError} />}
            {error && (
              <Feedback tone="error" live="assertive">
                {t(error)}
              </Feedback>
            )}
          </>
        ))}
    </div>
  );
}
