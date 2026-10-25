import { PracticeComposer } from "./PracticeComposer.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopIpcResponse, CallNinaError } from "@call-nina/contracts";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Nina, Button, Card, LoadingState, Muted } from "./components/ui/index.js";
import { ActionGroup, Page } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import type { SuggestionActions } from "./usePracticeSuggestion.js";
import { type PracticeKind } from "./PracticeTypeChooser.js";
import { startTopicPractice } from "./startTopicPractice.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { OperationProgress } from "./OperationProgress.js";
import { OperationError } from "./Startup.js";
import styles from "./Dashboard.module.css";

type Snapshot = Extract<DesktopIpcResponse, { status: "ok"; channel: "nina/read" }>["result"];
export type NinaHomeDraft = { naturalRequest: string; kind: PracticeKind };
export const emptyNinaHomeDraft: NinaHomeDraft = { naturalRequest: "", kind: "custom" };

export function NinaHome({
  draft,
  onDraftChange,
  requestAiAccess,
  onLaunch,
  onLearningPaths,
}: SuggestionActions & {
  onLearningPaths: () => void;
  draft: NinaHomeDraft;
  onDraftChange: (draft: NinaHomeDraft) => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const request = useRef(0);
  const mounted = useRef(true);
  const active = useRef(false);
  const operation = useLearningOperation();
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true);
    try {
      const home = await invokeDesktop("nina/read", {});
      if (current === request.current && mounted.current) setSnapshot(home);
    } catch (cause) {
      if (current === request.current && mounted.current)
        setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === request.current && mounted.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated" && ["dashboard", "settings"].includes(event.scope))
        void refresh();
    });
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      request.current += 1;
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);
  const resume = async () => {
    if (!snapshot?.resume || active.current) return;
    active.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("activity/resolve", {
        action: "open-activity",
        activityId: snapshot.resume.activityId,
        expectedGeneration: snapshot.rootGeneration,
      });
      if (
        result.activity.context.learningScope.learnerId !== snapshot.learningContext.learnerId ||
        result.activity.context.learningScope.targetLanguage !==
          snapshot.learningContext.targetLanguage
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      if (mounted.current)
        onLaunch({
          destination: "activity",
          activityId: result.activity.activityId,
          autoStart: true,
        });
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const start = async () => {
    if (!snapshot || active.current || !draft.naturalRequest.trim()) return;
    active.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const providerOperation =
        draft.kind === "flashcards"
          ? "flashcard-generation"
          : draft.kind === "listening" || draft.kind === "speaking"
            ? "voice-activity-draft"
            : "exercise-generation";
      if (!(await requestAiAccess(providerOperation)) || !mounted.current) return;
      const profile = await invokeDesktop("learner-profile/read", {});
      if (!mounted.current) return;
      if (
        profile.status !== "ready" ||
        profile.profile.learningContext.targetLanguage !==
          snapshot.learningContext.targetLanguage ||
        profile.profile.learningContext.learnerId !== snapshot.learningContext.learnerId
      )
        throw new Error("OD_LEARNING_CONTEXT_MISMATCH");
      const activityId = await startTopicPractice(
        {
          kind: draft.kind,
          topic: draft.naturalRequest,
          targetLevel: profile.profile.approximateLevel,
        },
        operation.run,
      );
      if (mounted.current) onLaunch({ destination: "activity", activityId, autoStart: true });
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Page
      width="form"
      className={styles.home}
      title={t("nav.nina")}
      refresh={{ onRefresh: refresh, busy: refreshing, disabled: busy }}
    >
      {error && <OperationError error={error} />}
      {!snapshot && !error && <LoadingState live>{t("dashboard.refreshing")}</LoadingState>}
      {snapshot?.resume && (
        <>
          <Card as="section" variant="brand" className={styles.resume}>
            <div className={styles.resumeCopy}>
              <Muted as="p">{t("ninaHome.continue")}</Muted>
              <h2>{snapshot.resume.title}</h2>
              <ActionGroup>
                <Button
                  variant="primary"
                  trailingIcon={<ArrowRight aria-hidden="true" />}
                  isDisabled={busy}
                  onPress={() => void resume()}
                >
                  {t("ninaHome.continue")}
                </Button>
              </ActionGroup>
            </div>
            <Nina size="medium" />
          </Card>
        </>
      )}
      <form
        className={styles.quickPractice}
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <h2>{t("ninaHome.quickPractice")}</h2>
        <PracticeComposer
          topic={draft.naturalRequest}
          kind={draft.kind}
          disabled={busy}
          onTopicChange={(naturalRequest) => onDraftChange({ ...draft, naturalRequest })}
          onKindChange={(kind) => onDraftChange({ ...draft, kind })}
        />
        <ActionGroup className={styles.quickActions}>
          <Button
            variant="quiet"
            isDisabled={busy}
            onPress={() =>
              onLaunch({
                destination: "preparation",
                kind: draft.kind,
                prompt: draft.naturalRequest,
              })
            }
          >
            {t("ninaHome.moreOptions")}
          </Button>
          <Button
            variant={snapshot?.resume ? "secondary" : "primary"}
            type="submit"
            trailingIcon={<ArrowRight aria-hidden="true" />}
            isDisabled={busy || !snapshot || !draft.naturalRequest.trim()}
          >
            {t("ninaHome.start")}
          </Button>
        </ActionGroup>
        <OperationProgress progress={operation.progress} />
        {operation.busy && (
          <Button variant="secondary" onPress={operation.cancel}>
            {t("actions.cancel")}
          </Button>
        )}
      </form>
      <section className={styles.pathReminder}>
        <div>
          <h2>{t("pathLibrary.homeTitle")}</h2>
          <Muted as="p">{t("pathLibrary.homeHint")}</Muted>
        </div>
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={onLearningPaths}
          trailingIcon={<ArrowRight aria-hidden="true" />}
        >
          {t("pathLibrary.homeAction")}
        </Button>
      </section>
    </Page>
  );
}
