import type { CallNinaError } from "@call-nina/contracts";
import { resolveModelPreference } from "@call-nina/domain";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, useNotifications } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "../../runtime/ipc.js";
import {
  activeOfflineStates,
  defaultPreference,
  directRoutes,
  withoutCredential,
  withoutDraft,
  type Action,
  type ConnectionSettingsProps,
  type CredentialDraft,
  type Draft,
  type OfflineView,
  type Route,
  type View,
} from "./ConnectionSettings.types.js";

export function useConnectionSettingsController({
  ref,
  active,
  disabled = false,
  onPendingChange,
  onBusyChange,
  authHelp,
  chatgptAccess,
  chatgptConnected,
  feedbackTarget,
  overview,
}: ConnectionSettingsProps) {
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
        rootEpoch.current = rootEpoch.current + 1;
        readSerial.current = readSerial.current + 1;
        setView(undefined);
        setOffline(undefined);
        setBusy(false);
        setOfflineBusy(false);
        setError(undefined);
        setReadError(undefined);
        setOfflineReadError(undefined);
        setReadingOffline(false);
        offlineReadSerial.current = offlineReadSerial.current + 1;
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
      epochRef.current = epochRef.current + 1;
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
    readSerial.current = readSerial.current + 1;
    offlineReadSerial.current = offlineReadSerial.current + 1;
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
  // Sign-in can persist this route under a new ID while its setup draft stays open.
  // Keep the draft's edits, but use the persisted identity for status and mutations.
  const selectedDraft = selectedId ? drafts[selectedId] : undefined;
  const saved = view?.settings.connections.find(
    (entry) => entry.id === selectedId || entry.routeId === selectedDraft?.routeId,
  );
  const draft = selectedId ? (drafts[selectedId] ?? saved) : undefined;
  const credential = selectedId ? (credentials[selectedId]?.secret ?? "") : "";
  const credentialAction = selectedId ? (credentials[selectedId]?.action ?? "keep") : "keep";
  const availability = view?.availability.find(
    (entry) => entry.connectionId === (saved?.id ?? selectedId),
  );
  const [chatgptModels, setChatgptModels] =
    useState<NonNullable<View["availability"][number]["models"]>>();
  const [chatgptModelsError, setChatgptModelsError] = useState<CallNinaError>();
  const [chatgptModelsRetry, setChatgptModelsRetry] = useState(0);
  const needsChatgptModels = draft?.routeId === "chatgpt" && !saved && chatgptConnected === true;
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setChatgptModels(undefined);
      setChatgptModelsError(undefined);
      if (needsChatgptModels) {
        void invokeDesktop("chatgpt/models/read", {})
          .then((models) => {
            if (!cancelled) setChatgptModels(models);
          })
          .catch((cause: unknown) => {
            if (!cancelled) setChatgptModelsError(normalizeDesktopError(cause).detail);
          });
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needsChatgptModels, selectedId, view?.expectedGeneration, chatgptModelsRetry]);
  const directCatalog = view?.directApiCatalogs.find((entry) => entry.routeId === draft?.routeId);
  const modelCatalog =
    directCatalog?.models ??
    (draft?.routeId === "local"
      ? offline?.catalog.models
      : needsChatgptModels
        ? chatgptModels
        : availability?.models);
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
    const original = view?.settings.connections.find(
      (connection) => connection.id === entry.id || connection.routeId === entry.routeId,
    );
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
    readSerial.current = readSerial.current + 1;
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
      if (action.kind === "save") notify({ message: "connectionSettings.saved", tone: "success" });
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
        id: saved?.id ?? draft.id,
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
      setDrafts((current) => withoutDraft(current, draft?.id ?? saved.id));
      setCredentials((current) => withoutCredential(current, draft?.id ?? saved.id));
      setSelectedId(undefined);
      setConfirmRemove(false);
      window.setTimeout(() => {
        listRef.current?.focus();
      }, 0);
    }
  };
  const add = (routeId: Route) => {
    const existing =
      Object.values(drafts).find((entry) => entry.routeId === routeId) ??
      view?.settings.connections.find((entry) => entry.routeId === routeId);
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
    setError(undefined);
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
  return {
    busy,
    draft,
    readFailure,
    offlineReadFailure,
    listRef,
    view,
    overview,
    offlineBusy,
    add,
    mutate,
    chatgptConnected,
    t,
    saved,
    credentialAction,
    discard,
    setSelectedId,
    dirty,
    resolution,
    effectiveModel,
    availability,
    chatgptAccess,
    authHelp,
    isDirect,
    updateCredential,
    error,
    credential,
    needsChatgptModels,
    chatgptModels,
    chatgptModelsError,
    setChatgptModelsRetry,
    modelCatalog,
    updateDraft,
    selectedModelId,
    draftModel,
    offline,
    offlineRef,
    offlineEligibility,
    offlineState,
    gib,
    offlinePreflight,
    manageOffline,
    setConfirmOfflineRemove,
    confirmOfflineRemove,
    directCatalog,
    listedOperations,
    setConfirmRemove,
    confirmRemove,
    remove,
    operationError,
    saving,
    save,
    feedbackTarget,
  };
}
