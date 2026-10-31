import { UploadsLibrary } from "./UploadsLibrary.js";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { BookPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type ActivityId,
  type CallNinaError,
  type DesktopIpcResponse,
  type ProviderOperation,
} from "@call-nina/contracts";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import { Button, Tabs } from "./components/ui/index.js";
import { ActionGroup, Page } from "./components/layout/index.js";
import styles from "./VocabularyLearning.module.css";

type Snapshot = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "vocabulary/learning-read" }
>["result"];
export function useVocabularyLearning(activityId?: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState<CallNinaError>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(true);
  const [saving, setSaving] = useState(false);
  const requestVersion = useRef(0);
  const rootEpoch = useRef(0);
  const mounted = useRef(true);
  const updating = useRef(false);
  const refresh = useCallback(async () => {
    if (updating.current) return;
    const version = ++requestVersion.current;
    setReading(true);
    try {
      const next = await invokeDesktop(
        "vocabulary/learning-read",
        activityId ? { activityId: activityId as ActivityId } : {},
      );
      if (version !== requestVersion.current || !mounted.current) return;
      setSnapshot(next);
      setReadError(undefined);
      return next;
    } catch (cause) {
      if (version === requestVersion.current && mounted.current)
        setReadError(normalizeDesktopError(cause).detail);
    } finally {
      if (version === requestVersion.current && mounted.current) setReading(false);
    }
  }, [activityId]);
  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        rootEpoch.current++;
        updating.current = false;
        setSaving(false);
        setSnapshot(undefined);
        setError("");
        void refresh();
      }
      if (
        event.event === "state-invalidated" &&
        ["vocabulary", "settings", "dashboard"].includes(event.scope)
      )
        void refresh();
    });
    return () => {
      mounted.current = false;
      requestVersion.current++;
      rootEpoch.current++;
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);
  const update = async (
    action: Parameters<typeof invokeDesktop<"vocabulary/learning-update">>[1]["action"],
  ) => {
    if (!snapshot || updating.current) return false;
    const epoch = rootEpoch.current;
    updating.current = true;
    requestVersion.current++;
    setReading(false);
    setSaving(true);
    try {
      const next = await invokeDesktop("vocabulary/learning-update", {
        rootGeneration: snapshot.rootGeneration,
        action,
      });
      if (!mounted.current || epoch !== rootEpoch.current) return false;
      setSnapshot(next);
      setError("");
      return true;
    } catch (cause) {
      if (mounted.current && epoch === rootEpoch.current)
        setError(normalizeDesktopError(cause).detail.messageKey);
      return false;
    } finally {
      if (mounted.current && epoch === rootEpoch.current) {
        updating.current = false;
        setSaving(false);
      }
    }
  };
  return { snapshot, refresh, update, readError, reading, error, saving };
}
export function VocabularyLearningNotice() {
  const { t } = useTranslation();
  const { snapshot } = useVocabularyLearning();
  const count = snapshot?.unreadCount ?? 0;
  if (!count) return null;
  return (
    <span
      className={styles.notice}
      role="status"
      aria-label={t("vocabulary.updates.changed", { count })}
    />
  );
}
export function VocabularyLearning({
  onOpenActivity,
  requestAiAccess,
  onBusyChange,
  dueCount,
  uploadCount,
  onReview,
  reviewButtonRef,
  libraryBusy,
  children,
  viewRequest,
  onPractise,
  onWordNavigate,
}: {
  onOpenActivity: (activityId: ActivityId) => void;
  requestAiAccess: (
    operation: ProviderOperation,
    previousOperationId?: undefined,
    hasImage?: boolean,
  ) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  dueCount: number | undefined;
  uploadCount: number | undefined;
  onReview: () => void;
  reviewButtonRef: Ref<HTMLButtonElement>;
  libraryBusy: boolean;
  children: ReactNode;
  viewRequest: number;
  onWordNavigate: (
    page: "results" | "practice",
    scope?: import("./savedResultsTypes.js").SavedResultsScope,
  ) => void;
  onPractise: (source: import("@call-nina/contracts").PracticeSource) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("words"),
    [add, setAdd] = useState(0);
  const [contentBusy, setContentBusy] = useState(false);
  const reportBusy = useCallback(
    (busy: boolean) => {
      setContentBusy(busy);
      onBusyChange(busy);
    },
    [onBusyChange],
  );
  const previous = useRef(viewRequest);
  useEffect(() => {
    if (previous.current !== viewRequest) {
      previous.current = viewRequest;
      setTab("words");
    }
  }, [viewRequest]);
  return (
    <Page
      title={t("vocabulary.title")}
      actions={
        tab === "uploads" && uploadCount === 0 ? undefined : (
          <Button
            variant="primary"
            isDisabled={contentBusy}
            leadingIcon={<BookPlus aria-hidden="true" />}
            onPress={() => {
              setTab("uploads");
              setAdd((n) => n + 1);
            }}
          >
            {t("uploads.add")}
          </Button>
        )
      }
    >
      <Tabs
        label={t("vocabulary.title")}
        selectedKey={tab}
        onSelectionChange={(key) => setTab(String(key))}
        items={[
          {
            id: "words",
            label: t("vocabulary.title"),
            children: (
              <>
                {Boolean(dueCount) && (
                  <ActionGroup>
                    <Button
                      ref={reviewButtonRef}
                      variant="primary"
                      isDisabled={libraryBusy || !dueCount}
                      onPress={onReview}
                    >
                      {t("uploads.reviewDue", { count: dueCount ?? 0 })}
                    </Button>
                  </ActionGroup>
                )}
                {tab === "words" && children}
              </>
            ),
          },
          {
            id: "uploads",
            label: t("uploads.tab"),
            children: (
              <UploadsLibrary
                onAddContent={() => setAdd((n) => n + 1)}
                onOpenActivity={onOpenActivity}
                onWordNavigate={onWordNavigate}
                requestAiAccess={requestAiAccess}
                onBusyChange={reportBusy}
                onPractise={onPractise}
                openAdd={add}
              />
            ),
          },
        ]}
      />
    </Page>
  );
}
