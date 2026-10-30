import { OperationError } from "./OperationError.js";
import { ActivityVisual } from "./activityPresentation.js";
import { MistakesToPractise } from "./MistakesToPractise.js";
import { SavedResultDetail } from "./SavedResultDetail.js";
import type {
  Snapshot,
  Entry,
  HistoryPayload,
  Skill,
  ActivityType,
  SavedResultsScope,
  HistoryPracticeSeed,
  PracticeState,
} from "./savedResultsTypes.js";
import { ProviderActionSummary } from "./ProviderActionSummary.js";
import {
  type ProviderOperation,
  type CallNinaError,
  calendarDateSchema,
  curriculumTopicIdSchema,
} from "@call-nina/contracts";
import { useOperationProgress } from "./useOperationProgress.js";
import { OperationProgress } from "./OperationProgress.js";
import { SavedTranslation } from "./SavedTranslation.js";
import { History } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SelectControl,
  Button,
  Disclosure,
  ModalDialog,
  EmptyState,
  LoadingState,
  FieldGroup,
  Muted,
} from "./components/ui/index.js";
import { ActionGroup, FilterBar, ContentRow } from "./components/layout/index.js";

import styles from "./HistoryPage.module.css";
import {
  createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
  subscribeDesktop,
} from "./ipc.js";

export type { SavedResultsScope, HistoryPracticeSeed } from "./savedResultsTypes.js";

const skills: readonly Skill[] = ["writing", "reading", "listening", "speaking"];
const activityTypes: readonly ActivityType[] = [
  "writing",
  "grammar",
  "vocabulary-review",
  "reading",
  "codex-listening",
  "voice-speaking",
  "placement",
  "custom-lesson",
];

export function SavedResults({
  onPracticeAgain,
  scope,
  onClearScope,
  view,
  refreshRequest,
  onChanged,
  requestAiAccess,
}: {
  scope?: SavedResultsScope | undefined;
  onClearScope: () => void;
  view: "activities" | "results";
  refreshRequest: number;
  onChanged: () => void;
  onPracticeAgain: (seed: HistoryPracticeSeed) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
}) {
  const { i18n, t } = useTranslation();
  const progress = useOperationProgress();
  const [detail, setDetail] = useState<string>();
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const version = useRef(0);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);
  const retainedCount = useRef(50);
  const scopeKey = JSON.stringify(scope ?? {});
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [patterns, setPatterns] = useState<Snapshot["mistakePatterns"]>([]);
  const [skill, setSkill] = useState<Skill | "">("");
  const [activityType, setActivityType] = useState<ActivityType | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [curriculumTopicId, setCurriculumTopicId] = useState("");
  const [mistakeCategory, setMistakeCategory] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<HistoryPayload>({ maximum: 100 });
  const skillFilter = useRef<HTMLSelectElement>(null);
  const [busy, setBusy] = useState(false);
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
      setBusy(true);
      setError(undefined);
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
            ...appliedFilters,
            maximum: 50,
            ...(nextCursor ? { cursor: nextCursor } : {}),
          });
          if (request !== version.current) return;
          if (root !== undefined && root !== next.rootGeneration)
            throw new Error("OD_DATA_ROOT_STALE");
          root = next.rootGeneration;
          entries.push(...next.entries);
          nextCursor = next.nextCursor ?? undefined;
        } while (!cursor && entries.length < retainedCount.current && nextCursor);
        if (!cursor) {
          const overview = await invokeDesktop("history/read", { maximum: 1 });
          if (request !== version.current) return;
          if (overview.rootGeneration !== root) throw new Error("OD_DATA_ROOT_STALE");
          setPatterns(overview.mistakePatterns);
        }
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
        if (request === version.current) setError(normalizeDesktopError(cause).detail);
      } finally {
        if (request === version.current) setBusy(false);
      }
    },
    [scopeKey, appliedFilters],
  );

  const applyFilters = () => {
    try {
      setAppliedFilters({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(skill ? { skill } : {}),
        ...(activityType ? { activityType } : {}),
        ...(fromDate ? { fromDate: calendarDateSchema.parse(fromDate) } : {}),
        ...(toDate ? { toDate: calendarDateSchema.parse(toDate) } : {}),
        ...(curriculumTopicId.trim()
          ? { curriculumTopicId: curriculumTopicIdSchema.parse(curriculumTopicId.trim()) }
          : {}),
        ...(mistakeCategory.trim() ? { mistakeCategory: mistakeCategory.trim() } : {}),
        maximum: 100,
      });
      setFiltersOpen(false);
      setError(undefined);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    }
  };
  const clearFilters = () => {
    setSearch("");
    setSkill("");
    setActivityType("");
    setFromDate("");
    setToDate("");
    setCurriculumTopicId("");
    setMistakeCategory("");
    setAppliedFilters({ maximum: 100 });
    if (filtersOpen) skillFilter.current?.focus();
  };
  const hasFilters = Boolean(
    search ||
    skill ||
    activityType ||
    fromDate ||
    toDate ||
    curriculumTopicId ||
    mistakeCategory ||
    Object.keys(appliedFilters).length > 1,
  );

  useEffect(() => {
    const invalidateRequests = () => {
      version.current++;
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
  }, [refresh, refreshRequest]);

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
    </>
  );

  return (
    <section
      className={styles.page}
      aria-busy={busy}
      data-history-ready={Boolean(snapshot && !busy && !error)}
      data-root-generation={snapshot?.rootGeneration}
    >
      <div className={styles.resultsBody} hidden={view !== "results"}>
        <ActionGroup>
          {scope && (
            <Button variant="quiet" onPress={onClearScope}>
              {scope.label ?? t("savedResults.selection")} · {t("savedResults.clearScope")}
            </Button>
          )}
          <Button
            variant="secondary"
            onPress={() => {
              setFiltersOpen(true);
            }}
          >
            {t("savedResults.filters")}{" "}
            {Object.keys(appliedFilters).filter((key) => key !== "maximum").length || ""}
          </Button>
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
          {hasFilters && (
            <Button variant="quiet" onPress={clearFilters}>
              {t("vocabulary.flow.clearFilters")}
            </Button>
          )}
        </ActionGroup>
        {hasFilters && (
          <Muted>
            {[
              appliedFilters.search,
              appliedFilters.skill ? t(`history.skills.${appliedFilters.skill}`) : undefined,
              appliedFilters.activityType
                ? t(`history.activityTypes.${appliedFilters.activityType}`)
                : undefined,
              appliedFilters.fromDate,
              appliedFilters.toDate,
              appliedFilters.curriculumTopicId,
              appliedFilters.mistakeCategory,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Muted>
        )}
        <ModalDialog
          keepMounted
          isOpen={filtersOpen}
          onOpenChange={setFiltersOpen}
          title={t("savedResults.filters")}
          closeLabel={t("actions.close")}
        >
          <FilterBar
            as="form"
            columns={3}
            label={t("history.title")}
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <FieldGroup>
              {t("savedResults.search")}
              <input
                value={search}
                maxLength={160}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </FieldGroup>
            <FieldGroup>
              {t("history.filters.skill")}
              <SelectControl
                ref={skillFilter}
                value={skill}
                onChange={(event) => {
                  setSkill(event.target.value as Skill | "");
                }}
              >
                <option value="">{t("history.filters.all")}</option>
                {skills.map((value) => (
                  <option key={value} value={value}>
                    {t(`history.skills.${value}`)}
                  </option>
                ))}
              </SelectControl>
            </FieldGroup>
            <FieldGroup>
              {t("history.filters.activityType")}
              <SelectControl
                value={activityType}
                onChange={(event) => {
                  setActivityType(event.target.value as ActivityType | "");
                }}
              >
                <option value="">{t("history.filters.all")}</option>
                {activityTypes.map((value) => (
                  <option key={value} value={value}>
                    {t(`history.activityTypes.${value}`)}
                  </option>
                ))}
              </SelectControl>
            </FieldGroup>
            <ActionGroup>
              <Button variant="secondary" isDisabled={busy} type="submit">
                {t("history.filters.apply")}
              </Button>
              {hasFilters && (
                <Button variant="quiet" isDisabled={busy} onPress={clearFilters}>
                  {t("vocabulary.flow.clearFilters")}
                </Button>
              )}
            </ActionGroup>
            <Disclosure
              className={styles.advancedFilters}
              label={
                <>
                  {t("ui.moreFilters")}
                  {[
                    appliedFilters.fromDate,
                    appliedFilters.toDate,
                    appliedFilters.curriculumTopicId,
                    appliedFilters.mistakeCategory,
                  ].filter(Boolean).length > 0 && (
                    <span>
                      {" "}
                      ·{" "}
                      {[
                        appliedFilters.fromDate &&
                          `${t("history.filters.from")}: ${appliedFilters.fromDate}`,
                        appliedFilters.toDate &&
                          `${t("history.filters.to")}: ${appliedFilters.toDate}`,
                        appliedFilters.curriculumTopicId &&
                          `${t("history.filters.topic")}: ${appliedFilters.curriculumTopicId}`,
                        appliedFilters.mistakeCategory &&
                          `${t("history.filters.mistake")}: ${appliedFilters.mistakeCategory}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </>
              }
            >
              <div className={styles.advancedGrid}>
                <FieldGroup>
                  {t("history.filters.from")}
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => {
                      setFromDate(event.target.value);
                    }}
                  />
                </FieldGroup>
                <FieldGroup>
                  {t("history.filters.to")}
                  <input
                    type="date"
                    value={toDate}
                    onChange={(event) => {
                      setToDate(event.target.value);
                    }}
                  />
                </FieldGroup>
                <FieldGroup>
                  {t("history.filters.topic")}
                  <input
                    maxLength={96}
                    value={curriculumTopicId}
                    onChange={(event) => {
                      setCurriculumTopicId(event.target.value);
                    }}
                  />
                </FieldGroup>
                <FieldGroup>
                  {t("history.filters.mistake")}
                  <input
                    maxLength={120}
                    value={mistakeCategory}
                    onChange={(event) => {
                      setMistakeCategory(event.target.value);
                    }}
                  />
                </FieldGroup>
              </div>
            </Disclosure>
          </FilterBar>
        </ModalDialog>
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
            <History aria-hidden="true" /> {t("history.empty")}
          </EmptyState>
        ) : null}

        <div className={styles.historyList}>
          {snapshot?.entries.map((entry) => (
            <ContentRow
              leading={<ActivityVisual kind={entry.activityType} />}
              metadata={
                entry.evidence ? t(`savedResults.basis.${entry.evidence.basis}`) : undefined
              }
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
              <header className={styles.historyEntryHeader}>
                <div>
                  <p className={styles.eyebrow}>
                    {t(`history.activityTypes.${entry.activityType}`)}
                  </p>
                  <h2>
                    <Button
                      variant="quiet"
                      onPress={() => {
                        setDetail(entry.historyEntryId);
                      }}
                    >
                      {entry.title}
                    </Button>
                  </h2>
                </div>
                <time dateTime={entry.occurredAt}>
                  {dateFormatter.format(new Date(entry.occurredAt))}
                </time>
              </header>
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
