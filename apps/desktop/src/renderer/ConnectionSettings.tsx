import { Disclosure } from "./components/ui/Disclosure.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AiConnection,
  AiModelPreference,
  DesktopIpcRequest,
  DesktopIpcResponse,
  OfflineSnapshot,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { resolveModelPreference } from "@call-nina/domain";
import { Button, Card, Feedback, SelectField, TextField } from "./components/ui/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import styles from "./ConnectionSettings.module.css";

type View = Extract<DesktopIpcResponse, { status: "ok"; channel: "ai-connections/read" }>["result"];
type Action = Extract<DesktopIpcRequest, { channel: "ai-connections/update" }>["payload"]["action"];
type Draft = Pick<AiConnection, "id" | "label" | "routeId" | "preference">;
type CredentialDraft = { action: "keep" | "replace" | "remove"; secret: string };
type Route = Draft["routeId"];
type OfflineView = View["offlineModel"];
const activeOfflineStates: OfflineSnapshot["state"][] = ["downloading", "verifying", "removing"];
const routes: Route[] = [
  "chatgpt",
  "claude-code",
  "openai",
  "anthropic",
  "google",
  "local",
  "managed",
];
const directRoutes: Route[] = ["openai", "anthropic", "google"];
const defaultPreference: AiModelPreference = {
  model: { mode: "automatic" },
  effort: { mode: "semantic", effort: "balanced" },
};
const withoutDraft = (drafts: Record<string, Draft>, id: string) =>
  Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== id));
const withoutCredential = (credentials: Record<string, CredentialDraft>, id: string) =>
  Object.fromEntries(Object.entries(credentials).filter(([key]) => key !== id));

export function ConnectionSettings({
  active,
  disabled = false,
  onPendingChange,
  authHelp,
  chatgptAccess,
}: {
  active: boolean;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  authHelp?: string;
  chatgptAccess?: (context: { active: boolean; saved: boolean; dirty: boolean }) => ReactNode;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>();
  const [selectedId, setSelectedId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [credentials, setCredentials] = useState<Record<string, CredentialDraft>>({});
  const [successor, setSuccessor] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, setBusy] = useState(false);
  const busy = saving || disabled;
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [offline, setOffline] = useState<OfflineView>();
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [confirmOfflineRemove, setConfirmOfflineRemove] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const managementRef = useRef<HTMLDetailsElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const offlineRef = useRef<HTMLDivElement>(null);
  const rootEpoch = useRef(0);
  const readSerial = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const epoch = rootEpoch.current;
    const serial = ++readSerial.current;
    try {
      const next = await invokeDesktop("ai-connections/read", {});
      if (!mounted.current || epoch !== rootEpoch.current || serial !== readSerial.current) return;
      setView(next);
      setOffline(next.offlineModel);
      setSelectedId(
        (current) =>
          current ?? next.settings.activeConnectionId ?? next.settings.connections[0]?.id,
      );
    } catch (cause) {
      if (!mounted.current || epoch !== rootEpoch.current || serial !== readSerial.current) return;
      setError(normalizeDesktopError(cause).detail.messageKey);
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
        setOffline(undefined);
        setBusy(false);
        setOfflineBusy(false);
        setError(undefined);
        setNotice(undefined);
        setDrafts({});
        setCredentials({});
        setSelectedId(undefined);
        setConfirmOfflineRemove(false);
        setConfirmRemove(false);
        setSuccessor("");
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
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  const offlineState = offline?.snapshot.state;
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
  useEffect(() => {
    if (!offlineJob || !pageVisible || !active) return;
    const epoch = rootEpoch.current;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await invokeDesktop("offline-model/read", {});
        if (cancelled || !mounted.current || epoch !== rootEpoch.current) return;
        setOffline(next);
        if (activeOfflineStates.includes(next.snapshot.state)) {
          timer = window.setTimeout(() => void poll(), 1500);
        } else {
          void load();
        }
      } catch (cause) {
        if (!cancelled && mounted.current && epoch === rootEpoch.current)
          setError(normalizeDesktopError(cause).detail.messageKey);
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [offlineJob, pageVisible, active, load]);

  const manageOffline = async (action: "install" | "cancel" | "remove") => {
    if (offlineBusy || busy) return;
    const epoch = rootEpoch.current;
    setOfflineBusy(true);
    setError(undefined);
    setNotice(undefined);
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
      setError(
        detail.kind === "conflict" ? "connectionSettings.offlineBusyConflict" : detail.messageKey,
      );
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
  const isNew = Boolean(draft && !saved);
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
    Object.values(drafts).some(hasChanges) ||
    Object.values(credentials).some((entry) => entry.action !== "keep");
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  const select = (id: string) => {
    setSelectedId(id);
    setSuccessor("");
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
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await invokeDesktop("ai-connections/update", {
        expectedGeneration: view.expectedGeneration,
        expectedRevision: view.settings.revision,
        action,
      });
      if (!mounted.current || epoch !== rootEpoch.current) return false;
      setView(next);
      setOffline(next.offlineModel);
      if (action.kind === "save") setNotice(t("connectionSettings.saved"));
      return true;
    } catch (cause) {
      if (!mounted.current || epoch !== rootEpoch.current) return false;
      const detail = normalizeDesktopError(cause).detail;
      setError(detail.kind === "conflict" ? "connections.wait" : detail.messageKey);
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
    if (credentialAction === "replace" && !credential) {
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
    }
  };
  const remove = async () => {
    if (!saved || !view) return;
    const active = view.settings.activeConnectionId === saved.id;
    const nextActiveConnectionId = active
      ? view.settings.connections.length === 1
        ? null
        : successor
      : view.settings.activeConnectionId;
    if (active && view.settings.connections.length > 1 && !successor) {
      setError("connectionSettings.successorRequired");
      return;
    }
    const ok = await mutate({ kind: "remove", connectionId: saved.id, nextActiveConnectionId });
    if (ok) {
      setDrafts((current) => withoutDraft(current, saved.id));
      setCredentials((current) => withoutCredential(current, saved.id));
      setSelectedId(
        nextActiveConnectionId ??
          view.settings.connections.find((entry) => entry.id !== saved.id)?.id,
      );
      setConfirmRemove(false);
      setSuccessor("");
      window.setTimeout(() => {
        if (managementRef.current) managementRef.current.open = true;
        listRef.current?.focus();
      }, 0);
    }
  };
  const add = () => {
    const id = crypto.randomUUID();
    setDrafts((current) => ({
      ...current,
      [id]: {
        id,
        label: t("connectionSettings.routes.chatgpt"),
        routeId: "chatgpt",
        preference: defaultPreference,
      },
    }));
    select(id);
    window.setTimeout(() => editorHeading.current?.focus(), 0);
  };
  const discard = () => {
    if (!draft) return;
    setDrafts((current) => withoutDraft(current, draft.id));
    setCredentials((current) => withoutCredential(current, draft.id));
    if (isNew)
      setSelectedId(view?.settings.activeConnectionId ?? view?.settings.connections[0]?.id);
  };

  return (
    <div className={styles.panel} aria-busy={busy}>
      <p>{t("connectionSettings.localPractice")}</p>
      <Disclosure
        ref={managementRef}
        data-connection-management
        className={styles.management}
        open={!view?.settings.connections.length || undefined}
        variant="plain"
        label={<> {t("connectionSettings.manage")} </>}
      >
        <div className={styles.list}>
          <div
            ref={listRef}
            className={styles.items}
            role="group"
            tabIndex={-1}
            aria-label={t("connectionSettings.savedConnections")}
          >
            {view?.settings.connections.map((entry) => (
              <Button
                variant="secondary"
                key={entry.id}
                isDisabled={busy}
                className={styles.item}
                data-active-connection={entry.id === view.settings.activeConnectionId}
                aria-current={selectedId === entry.id}
                onPress={() => {
                  select(entry.id);
                }}
              >
                {entry.label}
                {entry.id === view.settings.activeConnectionId
                  ? ` · ${t("connections.active")}`
                  : ""}
              </Button>
            ))}
            {Object.values(drafts)
              .filter(
                (entry) =>
                  !view?.settings.connections.some((savedEntry) => savedEntry.id === entry.id),
              )
              .map((entry) => (
                <Button
                  variant="secondary"
                  key={entry.id}
                  isDisabled={busy}
                  className={styles.item}
                  aria-current={selectedId === entry.id}
                  onPress={() => {
                    select(entry.id);
                  }}
                >
                  {entry.label || t("connectionSettings.newConnection")}
                </Button>
              ))}
          </div>
          <Button
            variant="secondary"
            isDisabled={
              busy ||
              !view ||
              view.settings.connections.length +
                Object.values(drafts).filter(
                  (entry) =>
                    !view.settings.connections.some((savedEntry) => savedEntry.id === entry.id),
                ).length >=
                50
            }
            onPress={add}
          >
            {t("connectionSettings.add")}
          </Button>
        </div>
      </Disclosure>
      {draft ? (
        <Card
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
          <h3 ref={editorHeading} tabIndex={-1}>
            {isNew
              ? t("connectionSettings.newConnection")
              : t(`connectionSettings.routes.${draft.routeId}`)}
          </h3>
          {isNew && (
            <SelectField
              label={t("connectionSettings.route")}
              value={draft.routeId}
              disabled={busy}
              onChange={(event) => {
                const routeId = event.target.value as Route;
                updateDraft({
                  routeId,
                  label:
                    draft.label === t(`connectionSettings.routes.${draft.routeId}`)
                      ? t(`connectionSettings.routes.${routeId}`)
                      : draft.label,
                  preference: defaultPreference,
                });
                updateCredential({ action: "keep", secret: "" });
                setConfirmOfflineRemove(false);
              }}
            >
              {routes.map((route) => (
                <option key={route} value={route}>
                  {t(`connectionSettings.routes.${route}`)}
                </option>
              ))}
            </SelectField>
          )}
          {draft.routeId === "claude-code" ? (
            <p>{t("connectionSettings.claudeUnavailable")}</p>
          ) : availability?.status === "adapter-unavailable" ? (
            <p>{t("connectionSettings.routeUnavailable")}</p>
          ) : null}
          {saved &&
            !(
              draft.routeId === "chatgpt" &&
              chatgptAccess &&
              ["available", "account-required"].includes(availability?.status ?? "")
            ) && (
              <p role="status">
                {t(`connectionSettings.status.${availability?.status ?? "inactive"}`)}
              </p>
            )}
          {!isNew && view?.settings.activeConnectionId !== draft.id && (
            <Button
              variant="primary"
              isDisabled={busy || dirty}
              onPress={() => void mutate({ kind: "activate", connectionId: draft.id })}
            >
              {t("connectionSettings.makeActive")}
            </Button>
          )}
          {dirty && !isNew && view?.settings.activeConnectionId !== draft.id && (
            <p>{t("connectionSettings.saveBeforeActivate")}</p>
          )}
          {draft.routeId === "chatgpt" &&
            (chatgptAccess ? (
              chatgptAccess({
                active: Boolean(saved && view?.settings.activeConnectionId === saved.id),
                saved: Boolean(saved),
                dirty: pending,
              })
            ) : (
              <p>{authHelp ?? t("connectionSettings.chatgptAuth")}</p>
            ))}
          {draft.routeId !== "chatgpt" && <p>{t(`connectionSettings.cost.${draft.routeId}`)}</p>}
          <SelectField
            label={t("modelControl.model")}
            disabled={busy}
            value={
              draft.preference.model.mode === "automatic"
                ? "automatic"
                : draft.preference.model.modelId
            }
            onChange={(event) => {
              updateDraft({
                preference: {
                  ...draft.preference,
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
          <Disclosure variant="plain" label={<> {t("connectionSettings.advanced")} </>}>
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
                          effort: event.target.value.slice(9) as "fast" | "balanced" | "deep",
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
          </Disclosure>
          {isDirect && (
            <Card variant="muted" className={styles.secret}>
              {view?.secureStorage.status === "unavailable" && (
                <p>{t("connectionSettings.secureStorageUnavailable")}</p>
              )}
              <p>
                {saved?.secretRef
                  ? t("connectionSettings.keySaved")
                  : t("connectionSettings.keyMissing")}
              </p>
              <SelectField
                label={t("connectionSettings.keyAction")}
                disabled={busy}
                value={credentialAction}
                onChange={(event) => {
                  updateCredential({
                    action: event.target.value as CredentialDraft["action"],
                    secret: "",
                  });
                }}
              >
                <option value="keep">{t("connectionSettings.keepKey")}</option>
                <option value="replace" disabled={view?.secureStorage.status !== "available"}>
                  {t("connectionSettings.replaceKey")}
                </option>
                {saved?.secretRef && (
                  <option value="remove">{t("connectionSettings.removeKey")}</option>
                )}
              </SelectField>
              {credentialAction === "replace" && (
                <TextField
                  label={t("connectionSettings.keyEntry")}
                  type="password"
                  maxLength={8192}
                  disabled={busy}
                  autoComplete="off"
                  value={credential}
                  onChange={(event) => {
                    updateCredential({ secret: event.target.value });
                  }}
                />
              )}
            </Card>
          )}
          {draft.routeId === "local" && offline && (
            <div ref={offlineRef} className={styles.offline} tabIndex={-1}>
              <h4>{t("connectionSettings.offlineTitle")}</h4>
              <p>{t("connectionSettings.offlineScope")}</p>
              <p>{t("connectionSettings.offlineLimits")}</p>
              <p role="status">{t(`connectionSettings.offlineState.${offline.snapshot.state}`)}</p>
              {offline.snapshot.errorCode && (
                <p role="alert">{t("connectionSettings.offlineFailure")}</p>
              )}
              {offline.snapshot.preflight && !offline.snapshot.preflight.platformSupported && (
                <p>{t("connectionSettings.offlinePlatform")}</p>
              )}
              {offline.snapshot.preflight && !offline.snapshot.preflight.memorySufficient && (
                <p>{t("connectionSettings.offlineMemory")}</p>
              )}
              {offline.snapshot.preflight && !offline.snapshot.preflight.diskSufficient && (
                <p>{t("connectionSettings.offlineDiskEstimate")}</p>
              )}
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
                {(offline.snapshot.state === "absent" || offline.snapshot.state === "partial") && (
                  <Button
                    variant="primary"
                    isDisabled={
                      busy || offlineBusy || !offline.snapshot.preflight?.platformSupported
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
                {offline.snapshot.state === "downloading" && (
                  <Button
                    variant="primary"
                    isDisabled={busy || offlineBusy}
                    onPress={() => void manageOffline("cancel")}
                  >
                    {t("connectionSettings.offlineCancelDownload")}
                  </Button>
                )}
                {(offline.snapshot.state === "installed" ||
                  offline.snapshot.state === "partial") && (
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
          {draft.routeId === "managed" && <p>{t("connectionSettings.managedUnavailable")}</p>}
          <Disclosure
            className={styles.connectionDetails}
            variant="plain"
            label={<> {t("connectionSettings.details")} </>}
          >
            <TextField
              label={t("connectionSettings.name")}
              maxLength={120}
              disabled={busy}
              value={draft.label}
              onChange={(event) => {
                updateDraft({ label: event.target.value });
              }}
            />
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
                    {view?.settings.activeConnectionId === saved.id &&
                      view.settings.connections.length > 1 && (
                        <SelectField
                          label={t("connectionSettings.successor")}
                          disabled={busy}
                          value={successor}
                          onChange={(event) => {
                            setSuccessor(event.target.value);
                          }}
                        >
                          <option value="">{t("connectionSettings.selectSuccessor")}</option>
                          {view.settings.connections
                            .filter((entry) => entry.id !== saved.id)
                            .map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.label}
                              </option>
                            ))}
                        </SelectField>
                      )}
                    <div className={styles.actions}>
                      <Button
                        variant="danger"
                        isDisabled={
                          busy ||
                          (view?.settings.activeConnectionId === saved.id &&
                            view.settings.connections.length > 1 &&
                            !successor)
                        }
                        onPress={() => void remove()}
                      >
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
          </Disclosure>
          {(dirty || saving) && (
            <div className={styles.actions}>
              <Button variant="primary" isDisabled={busy || !dirty} onPress={() => void save()}>
                {t("settings.save")}
              </Button>
              <Button variant="secondary" isDisabled={busy || !dirty} onPress={discard}>
                {t("settings.discard")}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <p>{t(view ? "connections.none" : "settings.loading")}</p>
      )}
      {view?.settings.migrationNotice && (
        <div className={styles.notice}>
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
      {error && (
        <Feedback tone="error" live="assertive">
          {t(error)}
        </Feedback>
      )}
      {notice && <Feedback live="polite">{notice}</Feedback>}
    </div>
  );
}
