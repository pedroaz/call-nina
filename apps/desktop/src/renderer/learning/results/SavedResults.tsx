import { type CallNinaError, type ProviderOperation } from "@call-nina/contracts";
import { History } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup, ContentRow } from "../../components/layout/index.js";
import { Button, EmptyState, LoadingState } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { ActivityVisual } from "../activities/activityPresentation.js";
import { SavedTranslation } from "../activities/SavedTranslation.js";
import { OperationProgress } from "../operations/OperationProgress.js";
import { useOperationProgress } from "../operations/useOperationProgress.js";
import { ProviderActionSummary } from "../providers/ProviderActionSummary.js";
import { MistakesToPractise } from "./MistakesToPractise.js";
import { SavedResultDetail } from "./SavedResultDetail.js";
import type {
  Entry,
  HistoryPracticeSeed,
  PracticeState,
  SavedResultsScope,
  Snapshot,
} from "./savedResultsTypes.js";

import {
  createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
  subscribeDesktop,
} from "../../runtime/ipc.js";
import styles from "./HistoryPage.module.css";

export type { HistoryPracticeSeed, SavedResultsScope } from "./savedResultsTypes.js";

function hasWrongAnswer(entry: Entry) {
  if (entry.detail.kind === "exercise-attempt")
    return entry.detail.objectiveEvaluations.some(
      ({ outcome }) => outcome === "developing" || outcome === "not-demonstrated",
    );
  return entry.mistakeCategories.length > 0;
}

export function SavedResults({
  onPracticeAgain,
  scope,
  onClearScope,
  view,
  onChanged,
  requestAiAccess,
}: {
  scope?: SavedResultsScope | undefined;
  onClearScope: () => void;
  view: "activities" | "results";
  onChanged: () => void;
  onPracticeAgain: (seed: HistoryPracticeSeed) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
}) {
  const { i18n, t } = useTranslation();
  const progress = useOperationProgress();
  const [detail, setDetail] = useState<string>();
  const [resultFilter, setResultFilter] = useState<"wrong" | "all">("wrong");
  const version = useRef(0);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);
  const retainedCount = useRef(50);
  const scopeKey = JSON.stringify(scope ?? {});
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [patterns, setPatterns] = useState<Snapshot["mistakePatterns"]>([]);
  const [actionBusy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<CallNinaError>();
  const busy = actionBusy || reading;
  const [error, setError] = useState<CallNinaError>();
  const [practiceState, setPracticeState] = useState<PracticeState>();
  const practiceSubmissionId = useRef<ReturnType<typeof createDesktopSubmissionId> | undefined>(
    undefined,
  );
  const practiceOperationId = useRef<ReturnType<typeof createDesktopSubmissionId> | undefined>(
    undefined,
  );

  const refresh = useCallback(
    async (cursor?: NonNullable<Snapshot["nextCursor"]>) => {
      const request = ++version.current;
      setReading(true);
      try {
        let nextCursor = cursor;
        let next: Snapshot;
        const entries: Entry[] = [];
        let root: number | undefined;
        do {
          next = await invokeDesktop("history/read", {
            ...(() => {
              const value = JSON.parse(scopeKey) as SavedResultsScope;
              return {
                ...(value.correctionId ? { correctionId: value.correctionId } : {}),
                ...(value.activityId ? { activityId: value.activityId } : {}),
                ...(value.historyEntryIds?.length
                  ? { historyEntryIds: value.historyEntryIds }
                  : {}),
              };
            })(),
            maximum: 50,
            ...(nextCursor ? { cursor: nextCursor } : {}),
          });
          if (request !== version.current) return;
          if (root !== undefined && root !== next.rootGeneration)
            throw new Error("OD_DATA_ROOT_STALE");
          root = next.rootGeneration;
          entries.push(
            ...next.entries.filter((entry) => resultFilter === "all" || hasWrongAnswer(entry)),
          );
          nextCursor = next.nextCursor ?? undefined;
        } while (entries.length < (cursor ? 50 : retainedCount.current) && nextCursor);
        if (!cursor) {
          const overview = await invokeDesktop("history/read", { maximum: 1 });
          if (request !== version.current) return;
          if (overview.rootGeneration !== root) throw new Error("OD_DATA_ROOT_STALE");
          setPatterns(overview.mistakePatterns);
        }
        setReadError(undefined);
        if (cursor) retainedCount.current += entries.length;
        setSnapshot((previous) => ({
          ...next,
          entries:
            cursor && previous?.rootGeneration === next.rootGeneration
              ? [
                  ...previous.entries,
                  ...entries.filter(
                    (entry) =>
                      !previous.entries.some((old) => old.historyEntryId === entry.historyEntryId),
                  ),
                ]
              : entries,
        }));
      } catch (cause) {
        if (request === version.current) setReadError(normalizeDesktopError(cause).detail);
      } finally {
        if (request === version.current) setReading(false);
      }
    },
    [scopeKey, resultFilter],
  );

  useEffect(() => {
    const invalidateRequests = () => {
      version.current = version.current + 1;
    };
    retainedCount.current = 50;
    const initial = window.setTimeout(() => {
      setSnapshot(undefined);
      setDetail(undefined);
      void refresh();
    }, 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated" && event.scope === "history") void refresh();
      if (
        event.event === "learning-operation-progress" &&
        event.kind === "exercise-generation" &&
        event.submissionId === practiceSubmissionId.current
      ) {
        practiceOperationId.current = event.operationId;
        setPracticeState((current) =>
          current
            ? { ...current, status: event.stage === "queued" ? "queued" : "running" }
            : current,
        );
      }
      if (
        event.event === "learning-operation-finished" &&
        event.kind === "exercise-generation" &&
        event.submissionId === practiceSubmissionId.current
      ) {
        setPracticeState((current) =>
          current
            ? {
                ...current,
                status:
                  event.outcome.status === "validated"
                    ? "created"
                    : event.outcome.status === "cancelled"
                      ? "cancelled"
                      : "failed",
              }
            : current,
        );
        onChangedRef.current();
        void refresh();
        practiceSubmissionId.current = undefined;
        practiceOperationId.current = undefined;
      }
    });
    return () => {
      invalidateRequests();
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  const deleteEntry = async (entry: Entry) => {
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("history/delete", { historyEntryId: entry.historyEntryId });
      onChanged();
      if (detail === entry.historyEntryId) setDetail(undefined);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              entries: current.entries.filter(
                ({ historyEntryId }) => historyEntryId !== entry.historyEntryId,
              ),
            }
          : current,
      );
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  const createTargetedPractice = async (pattern: Snapshot["mistakePatterns"][number]) => {
    if (!(await requestAiAccess("exercise-generation"))) return;
    const patternKey = `${pattern.category.kind}:${pattern.category.categoryKey}`;
    const submissionId = createDesktopSubmissionId();
    practiceSubmissionId.current = submissionId;
    progress.begin(submissionId, "exercise-generation");
    setPracticeState({ patternKey, status: "queued" });
    setError(undefined);
    try {
      const result = await invokeDesktop("learning-operation/start", {
        submissionId,
        input: {
          kind: "exercise-generation",
          context: { origin: "history" },
          request: { source: "mistake-pattern", category: pattern.category },
        },
      });
      if (practiceSubmissionId.current === submissionId)
        practiceOperationId.current = result.operationId;
    } catch (cause) {
      setPracticeState({ patternKey, status: "failed" });
      setError(normalizeDesktopError(cause).detail);
    }
  };

  const createVoiceFollowUp = async (entry: Entry) => {
    if (entry.detail.kind !== "voice-summary") return;
    const nextStep = entry.detail.nextSteps[0];
    if (!nextStep) return;
    if (!(await requestAiAccess("exercise-generation"))) return;
    const patternKey = `voice:${entry.historyEntryId}`;
    const submissionId = createDesktopSubmissionId();
    practiceSubmissionId.current = submissionId;
    progress.begin(submissionId, "exercise-generation");
    setPracticeState({ patternKey, status: "queued" });
    setError(undefined);
    try {
      const result = await invokeDesktop("learning-operation/start", {
        submissionId,
        input: {
          kind: "exercise-generation",
          context: { origin: "history" },
          request: {
            source: "natural-request",
            naturalRequest: nextStep.naturalRequest,
          },
        },
      });
      if (practiceSubmissionId.current === submissionId)
        practiceOperationId.current = result.operationId;
    } catch (cause) {
      setPracticeState({ patternKey, status: "failed" });
      setError(normalizeDesktopError(cause).detail);
    }
  };

  const cancelTargetedPractice = async () => {
    const operationId = practiceOperationId.current;
    if (!operationId) return;
    try {
      await invokeDesktop("learning-operation/cancel", { operationId });
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    }
  };

  const feedbackTranslation = (
    entry: Entry,
    field: "feedback-summary" | "feedback-strength" | "feedback-improvement",
    index?: number,
  ) => {
    if (entry.detail.kind !== "exercise-attempt" || !entry.detail.translation || !snapshot)
      return null;
    const { content, position, attemptId, fields } = entry.detail.translation;
    if (
      (field === "feedback-summary" && !fields.summary) ||
      (field === "feedback-strength" && !fields.strengths.includes(index ?? 0)) ||
      (field === "feedback-improvement" && !fields.improvements.includes(index ?? 0))
    )
      return null;
    const target =
      field === "feedback-summary"
        ? { kind: field, position, attemptId }
        : { kind: field, position, attemptId, index: index ?? 0 };
    return (
      <SavedTranslation
        request={{
          rootGeneration: snapshot.rootGeneration,
          activityId: entry.detail.activityId,
          content,
          field: target,
        }}
        requestAiAccess={requestAiAccess}
      />
    );
  };

  const operationStatus = (
    <>
      {(practiceState?.status === "queued" || practiceState?.status === "running") && (
        <ProviderActionSummary operation="exercise-generation" busy={true} />
      )}
      <OperationProgress
        progress={
          practiceState?.status === "queued" || practiceState?.status === "running"
            ? progress.progress
            : undefined
        }
        onCancel={() => void cancelTargetedPractice()}
      />
      {error && <OperationError error={error} />}
      {readError && (
        <OperationError error={readError}>
          <Button
            variant="secondary"
            isPending={reading}
            isDisabled={actionBusy}
            onPress={() => void refresh()}
          >
            {t("actions.retry")}
          </Button>
        </OperationError>
      )}
    </>
  );

  return (
    <section
      className={styles.page}
      aria-busy={busy}
      data-history-ready={Boolean(snapshot && !busy && !error && !readError)}
      data-root-generation={snapshot?.rootGeneration}
    >
      <div className={styles.resultsBody} hidden={view !== "results"}>
        <ActionGroup>
          {scope && (
            <Button variant="quiet" onPress={onClearScope}>
              {scope.label ?? t("savedResults.selection")} · {t("savedResults.clearScope")}
            </Button>
          )}
          {(["wrong", "all"] as const).map((filter) => (
            <Button
              key={filter}
              variant="secondary"
              density="compact"
              aria-pressed={resultFilter === filter}
              onPress={() => {
                if (resultFilter === filter) return;
                version.current = version.current + 1;
                retainedCount.current = 50;
                setSnapshot(undefined);
                setResultFilter(filter);
              }}
            >
              {t(filter === "wrong" ? "savedResults.wrongAnswers" : "savedResults.allResults")}
            </Button>
          ))}
          {snapshot && snapshot.mistakePatterns.length > 0 && (
            <Button
              variant="quiet"
              onPress={() => {
                setDetail("patterns");
              }}
            >
              {t("savedResults.mistakes")}
            </Button>
          )}
        </ActionGroup>
      </div>

      {!detail && operationStatus}

      <div hidden={view !== "activities"}>
        <MistakesToPractise
          patterns={view === "activities" ? patterns : (snapshot?.mistakePatterns ?? [])}
          isOpen={detail === "patterns"}
          onOpenChange={(open) => {
            setDetail(open ? "patterns" : undefined);
          }}
          operationStatus={operationStatus}
          practiceState={practiceState}
          onPracticeAgain={onPracticeAgain}
          createTargetedPractice={createTargetedPractice}
        />
      </div>
      <div className={styles.resultsBody} hidden={view !== "results"}>
        {busy && !snapshot && <LoadingState>{t("startup.loading")}</LoadingState>}
        {snapshot && snapshot.entries.length === 0 ? (
          <EmptyState>
            <History aria-hidden="true" />{" "}
            {t(resultFilter === "wrong" ? "savedResults.noWrongAnswers" : "history.empty")}
          </EmptyState>
        ) : null}

        <div className={styles.historyList}>
          {snapshot?.entries.map((entry) => (
            <ContentRow
              key={entry.historyEntryId}
              data-history-entry-id={entry.historyEntryId}
              data-history-vocabulary-id={
                entry.entityKind === "vocabulary-review" &&
                entry.evidence?.ownership.source.kind === "vocabulary-review"
                  ? entry.evidence.ownership.source.vocabularyId
                  : undefined
              }
              data-history-activity-id={
                entry.detail.kind === "exercise-attempt" &&
                entry.evidence?.ownership.source.kind === "exercise" &&
                entry.evidence.ownership.source.activityId === entry.detail.activityId
                  ? entry.detail.activityId
                  : undefined
              }
              data-learning-language={entry.evidence?.ownership.learningScope.targetLanguage}
              data-root-generation={snapshot.rootGeneration}
            >
              <Button
                variant="quiet"
                className={styles.resultOpen}
                onPress={() => {
                  setDetail(entry.historyEntryId);
                }}
              >
                <ActivityVisual kind={entry.activityType} />
                <span className={styles.resultCopy}>
                  <strong>{entry.title}</strong>
                  <span className={styles.resultMetadata}>
                    <span>{t(`history.activityTypes.${entry.activityType}`)}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={entry.occurredAt}>
                      {dateFormatter.format(new Date(entry.occurredAt))}
                    </time>
                    {entry.evidence && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{t(`savedResults.basis.${entry.evidence.basis}`)}</span>
                      </>
                    )}
                  </span>
                </span>
              </Button>
              <SavedResultDetail
                entry={entry}
                isOpen={detail === entry.historyEntryId}
                onClose={() => {
                  setDetail(undefined);
                }}
                operationStatus={operationStatus}
                dateFormatter={dateFormatter}
                deleteEntry={deleteEntry}
                onPracticeAgain={onPracticeAgain}
                createVoiceFollowUp={createVoiceFollowUp}
                feedbackTranslation={feedbackTranslation}
                practiceState={practiceState}
              />
            </ContentRow>
          ))}
        </div>
        {snapshot?.nextCursor && (
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => void refresh(snapshot.nextCursor ?? undefined)}
          >
            {t("practice.library.loadMore")}
          </Button>
        )}
      </div>
    </section>
  );
}
