import {
  type ProviderOperation,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type CallNinaError,
  calendarDateSchema,
  curriculumTopicIdSchema,
} from "@call-nina/contracts";
import { useOperationProgress } from "./useOperationProgress.js";
import { OperationProgress } from "./OperationProgress.js";
import { SavedTranslation } from "./SavedTranslation.js";
import { History, Repeat2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DiagnosticCode,
  Button,
  Disclosure,
  ConfirmDialog,
  EmptyState,
  Feedback,
  Card,
  FieldGroup,
  Muted,
  ItemList,
} from "./components/ui/index.js";
import { ActionGroup, FilterBar, Page } from "./components/layout/index.js";

import styles from "./HistoryPage.module.css";
import {
  createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
  subscribeDesktop,
} from "./ipc.js";

type Snapshot = Extract<DesktopIpcResponse, { status: "ok"; channel: "history/read" }>["result"];
type Entry = Snapshot["entries"][number];
type HistoryPayload = Extract<DesktopIpcRequest, { channel: "history/read" }>["payload"];
type Skill = NonNullable<HistoryPayload["skill"]>;
type ActivityType = NonNullable<HistoryPayload["activityType"]>;

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

export type HistoryPracticeSeed =
  | Readonly<{
      kind: "writing";
      historyEntryId: string;
      draft: string;
      context: string;
    }>
  | Readonly<{ kind: "exercise"; activityId: string }>;

function practiceSeed(entry: Entry): HistoryPracticeSeed {
  if (entry.detail.kind !== "writing-correction") throw new Error("OD_HISTORY_DETAIL_INVALID");
  return {
    kind: "writing",
    historyEntryId: entry.historyEntryId,
    draft: entry.detail.learnerText,
    context: entry.title,
  };
}

function exerciseAnswerText(detail: Extract<Entry["detail"], { kind: "exercise-attempt" }>) {
  const answer = detail.answer;
  if (answer.kind === "multiple-choice") {
    return `#${String(answer.selectedOptionPosition + 1)}`;
  }
  if (answer.kind === "fill-in-the-blank") return answer.valuesByBlankPosition.join(" · ");
  return answer.text;
}

export function HistoryPage({
  onPracticeAgain,
  initialHistoryEntryIds,
  requestAiAccess,
}: {
  onPracticeAgain: (seed: HistoryPracticeSeed) => void;
  initialHistoryEntryIds?: NonNullable<HistoryPayload["historyEntryIds"]>;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
}) {
  const { i18n, t } = useTranslation();
  const progress = useOperationProgress();
  const [entryIds, setEntryIds] = useState(initialHistoryEntryIds);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [skill, setSkill] = useState<Skill | "">("");
  const [activityType, setActivityType] = useState<ActivityType | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [curriculumTopicId, setCurriculumTopicId] = useState("");
  const [mistakeCategory, setMistakeCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [practiceState, setPracticeState] = useState<
    Readonly<{
      patternKey: string;
      status: "queued" | "running" | "created" | "cancelled" | "failed";
    }>
  >();
  const practiceSubmissionId = useRef<ReturnType<typeof createDesktopSubmissionId> | undefined>(
    undefined,
  );
  const practiceOperationId = useRef<ReturnType<typeof createDesktopSubmissionId> | undefined>(
    undefined,
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(
        await invokeDesktop("history/read", {
          ...(entryIds?.length ? { historyEntryIds: entryIds } : {}),
          ...(skill ? { skill } : {}),
          ...(activityType ? { activityType } : {}),
          ...(fromDate ? { fromDate: calendarDateSchema.parse(fromDate) } : {}),
          ...(toDate ? { toDate: calendarDateSchema.parse(toDate) } : {}),
          ...(curriculumTopicId.trim()
            ? { curriculumTopicId: curriculumTopicIdSchema.parse(curriculumTopicId.trim()) }
            : {}),
          ...(mistakeCategory.trim() ? { mistakeCategory: mistakeCategory.trim() } : {}),
          maximum: 100,
        }),
      );
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  }, [entryIds, activityType, curriculumTopicId, fromDate, mistakeCategory, skill, toDate]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
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
        practiceSubmissionId.current = undefined;
        practiceOperationId.current = undefined;
      }
    });
    return () => {
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
        routeId: "codex",
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
        routeId: "codex",
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

  return (
    <Page
      refresh={{ onRefresh: refresh, busy: busy }}
      className={styles.page}

      title={t("history.title")}
      aria-busy={busy}
    >
      {entryIds && (
        <Button
          onPress={() => {
            setEntryIds(undefined);
          }}
        >
          {t("learningPath.allHistory")}
        </Button>
      )}
      <FilterBar
        as="form"
        columns={3}
        label={t("history.title")}
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
      >
        <FieldGroup>
          {t("history.filters.skill")}
          <select
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
          </select>
        </FieldGroup>
        <FieldGroup>
          {t("history.filters.activityType")}
          <select
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
          </select>
        </FieldGroup>
        <Button variant="primary" isDisabled={busy} type="submit">
          {t("history.filters.apply")}
        </Button>
        <Disclosure className={styles.advancedFilters} label={t("ui.moreFilters")}>
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

      <OperationProgress
        progress={
          practiceState?.status === "queued" || practiceState?.status === "running"
            ? progress.progress
            : undefined
        }
        onCancel={() => void cancelTargetedPractice()}
      />
      {error && (
        <Feedback live="assertive" tone="error">
          <span>{t(error.messageKey)}</span>
          <DiagnosticCode>
            {error.reference.code} · {error.reference.correlationId}
          </DiagnosticCode>
        </Feedback>
      )}

      {snapshot && snapshot.mistakePatterns.length > 0 ? (
        <Disclosure label={t("history.patterns.title")}>
          <div className={styles.historyMistakeGrid}>
            {snapshot.mistakePatterns.map((pattern) => {
              const categoryLabel =
                pattern.category.kind === "vocabulary"
                  ? `${pattern.category.lemma} · ${pattern.category.categoryKey}`
                  : pattern.category.categoryKey;
              return (
                <Card as="article" key={`${pattern.category.kind}:${pattern.category.categoryKey}`}>
                  <p className={styles.eyebrow}>
                    {t(`history.patterns.category.${pattern.category.kind}`)}
                  </p>
                  <h3>{categoryLabel}</h3>
                  <Feedback live="off" tone={pattern.status === "recurring" ? "warning" : "info"}>
                    {pattern.status === "recurring"
                      ? t("history.patterns.recurring", { count: pattern.occurrenceCount })
                      : t("history.patterns.single")}
                  </Feedback>
                  <Muted as="p">
                    {t(`history.patterns.source.${pattern.classificationSource}`)}
                  </Muted>
                  {pattern.targetedPractice.status === "created" ||
                  (practiceState?.patternKey ===
                    `${pattern.category.kind}:${pattern.category.categoryKey}` &&
                    practiceState.status === "created") ? (
                    <Feedback live="off" tone="success">
                      {t("history.patterns.practice.created")}
                    </Feedback>
                  ) : practiceState?.patternKey ===
                      `${pattern.category.kind}:${pattern.category.categoryKey}` &&
                    (practiceState.status === "queued" || practiceState.status === "running") ? (
                    <ActionGroup>
                      <Feedback live="off">
                        {t(`history.patterns.practice.${practiceState.status}`)}
                      </Feedback>
                    </ActionGroup>
                  ) : (
                    <ActionGroup>
                      <Button onPress={() => void createTargetedPractice(pattern)}>
                        <Sparkles aria-hidden="true" /> {t("history.patterns.practice.create")}
                      </Button>
                      {practiceState?.patternKey ===
                        `${pattern.category.kind}:${pattern.category.categoryKey}` &&
                      (practiceState.status === "cancelled" ||
                        practiceState.status === "failed") ? (
                        <Muted as="span">
                          {t(`history.patterns.practice.${practiceState.status}`)}
                        </Muted>
                      ) : null}
                    </ActionGroup>
                  )}
                  <ol className={styles.historyEvidenceList}>
                    {pattern.occurrences.map((occurrence, position) => (
                      <li
                        key={`${occurrence.mistakeId}:${occurrence.observedOn}:${String(position)}`}
                      >
                        <time dateTime={occurrence.observedOn}>{occurrence.observedOn}</time>
                        <blockquote>
                          {occurrence.evidence.beforeContext}
                          <mark>{occurrence.evidence.evidenceText}</mark>
                          {occurrence.evidence.afterContext}
                        </blockquote>
                        <p>{occurrence.explanation}</p>
                        {occurrence.classificationSource === "learner-amended" ? (
                          <Muted as="span">{t("history.patterns.amendedEvidence")}</Muted>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </Card>
              );
            })}
          </div>
        </Disclosure>
      ) : null}

      {snapshot && snapshot.entries.length === 0 ? (
        <EmptyState>
          <History aria-hidden="true" /> {t("history.empty")}
        </EmptyState>
      ) : null}

      <div className={styles.historyList}>
        {snapshot?.entries.map((entry) => (
          <Card as="article" key={entry.historyEntryId}>
            <header className={styles.historyEntryHeader}>
              <div>
                <p className={styles.eyebrow}>
                  {t(`history.skills.${entry.skill}`)} ·{" "}
                  {t(`history.activityTypes.${entry.activityType}`)}
                </p>
                <h2>{entry.title}</h2>
              </div>
              <time dateTime={entry.occurredAt}>
                {dateFormatter.format(new Date(entry.occurredAt))}
              </time>
            </header>
            {entry.evidence && (
              <Muted as="p">{t(`history.evidenceBasis.${entry.evidence.basis}`)}</Muted>
            )}
            <Disclosure label={t("ui.details")}>
              {entry.curriculumTopicIds.length > 0 && (
                <Muted as="p">
                  {t("history.topics")}: {entry.curriculumTopicIds.join(", ")}
                </Muted>
              )}
              {entry.mistakeCategories.length > 0 && (
                <Muted as="p">
                  {t("history.mistakes")}: {entry.mistakeCategories.join(", ")}
                </Muted>
              )}
              {entry.detail.kind === "attempt-feedback" ? (
                <div className={styles.historyDetail}>
                  <h3>{t(entry.detail.later ? "history.laterFeedback" : "history.feedback")}</h3>
                  <p>{entry.detail.feedback.summary}</p>
                  <ItemList>
                    {entry.detail.feedback.evidence.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ItemList>
                  <ConfirmDialog
                    body={t("history.deleteBody")}
                    cancel={t("actions.cancel")}
                    confirm={t("actions.delete")}
                    onConfirm={() => deleteEntry(entry)}
                    title={t("history.deleteTitle")}
                    triggerVariant="quiet"
                    trigger={t("history.delete")}
                  />
                </div>
              ) : entry.detail.kind === "writing-correction" ? (
                <div className={styles.historyDetail}>
                  <div className={styles.correctionGrid}>
                    <section className={styles.correctionPane}>
                      <h3>{t("history.learnerOriginal")}</h3>
                      <p className={styles.correctionText}>{entry.detail.learnerText}</p>
                    </section>
                    <section className={styles.correctionPane}>
                      <h3>{t("history.modelCorrection")}</h3>
                      <p className={styles.correctionText}>{entry.detail.correctedText}</p>
                    </section>
                  </div>
                  <section>
                    <h3>{t("history.feedback")}</h3>
                    <p>{entry.detail.feedback.summary}</p>
                    <h4>{t("history.strengths")}</h4>
                    <ItemList>
                      {entry.detail.feedback.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ItemList>
                    <h4>{t("history.improvements")}</h4>
                    <ItemList>
                      {entry.detail.feedback.improvements.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ItemList>
                  </section>
                  {entry.detail.vocabularyCandidates.length > 0 && (
                    <section>
                      <h3>{t("history.vocabularyCandidates")}</h3>
                      <ItemList>
                        {entry.detail.vocabularyCandidates.map((candidate) => (
                          <li key={`${candidate.lemma}:${candidate.meaning}`}>
                            <strong>{candidate.lemma}</strong> — {candidate.meaning}.{" "}
                            {candidate.rationale}
                          </li>
                        ))}
                      </ItemList>
                    </section>
                  )}
                  <Muted as="p">
                    {entry.detail.provenance.availability === "reported"
                      ? t("history.modelProvenance", {
                          model: entry.detail.provenance.modelId,
                          effort: entry.detail.provenance.effortId,
                        })
                      : t("history.modelNotReported")}
                  </Muted>
                  <ActionGroup>
                    <Button
                      onPress={() => {
                        onPracticeAgain(practiceSeed(entry));
                      }}
                    >
                      <Repeat2 aria-hidden="true" /> {t("history.practiceAgain")}
                    </Button>
                    <ConfirmDialog
                      body={t("history.deleteBody")}
                      cancel={t("actions.cancel")}
                      confirm={t("actions.delete")}
                      onConfirm={() => deleteEntry(entry)}
                      title={t("history.deleteTitle")}
                      triggerVariant="quiet"
                      trigger={t("history.delete")}
                    />
                  </ActionGroup>
                </div>
              ) : entry.detail.kind === "listening" ? (
                <div className={styles.historyDetail} data-testid="listening-detail">
                  <section>
                    <h3>{t("history.listeningSummary")}</h3>
                    <ItemList>
                      {entry.detail.exerciseResults.map((exercise) => (
                        <li key={exercise.kind}>
                          <strong>{exercise.kind}</strong>: {exercise.outcome} — {exercise.evidence}
                        </li>
                      ))}
                    </ItemList>
                    {entry.detail.difficultVocabulary.length > 0 && (
                      <p>
                        {t("history.listeningWords", {
                          words: entry.detail.difficultVocabulary.join(", "),
                        })}
                      </p>
                    )}
                  </section>
                  <section>
                    <h3>{t("history.listeningNextSteps")}</h3>
                    <ItemList>
                      {entry.detail.nextSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ItemList>
                  </section>
                  <Feedback live="off">{t("history.listeningNoAudio")}</Feedback>
                  <ConfirmDialog
                    body={t("history.deleteBody")}
                    cancel={t("actions.cancel")}
                    confirm={t("actions.delete")}
                    onConfirm={() => deleteEntry(entry)}
                    title={t("history.deleteTitle")}
                    trigger={t("history.delete")}
                  />
                </div>
              ) : entry.detail.kind === "placement" ? (
                <div className={styles.historyDetail} data-testid="placement-detail">
                  <section>
                    <h3>{t("history.placementSummary")}</h3>
                    <p>{t("practice.diagnosticFlow.limitedEvidence")}</p>
                    <Feedback live="off" tone="warning">
                      {entry.detail.uncertainty.level === "none"
                        ? t("history.placementUncertaintyNone")
                        : entry.detail.uncertainty.explanation}
                    </Feedback>
                  </section>
                  <section>
                    <h3>{t("history.placementEvidence")}</h3>
                    <ItemList>
                      {entry.detail.sampleResults.map((sample) => (
                        <li key={sample.kind}>
                          <strong>{sample.topic}</strong>:{" "}
                          {t(`history.placementOutcomes.${sample.outcome}`)} — {sample.evidence}
                        </li>
                      ))}
                    </ItemList>
                  </section>
                  <Feedback live="off" tone="warning">
                    {entry.detail.voiceCalibration.explanation}
                  </Feedback>
                  <ConfirmDialog
                    body={t("history.deleteBody")}
                    cancel={t("actions.cancel")}
                    confirm={t("actions.delete")}
                    onConfirm={() => deleteEntry(entry)}
                    title={t("history.deleteTitle")}
                    trigger={t("history.delete")}
                  />
                </div>
              ) : entry.detail.kind === "voice-summary" ? (
                <div className={styles.historyDetail} data-testid="voice-summary-detail">
                  <section>
                    <h3>{t("history.voiceSummary.scenario")}</h3>
                    <p>
                      <strong>{entry.detail.scenario.title}</strong> — {entry.detail.scenario.topic}
                    </p>
                    <Muted as="p">
                      {t("history.voiceSummary.level", {
                        level: entry.detail.scenario.targetLevel.toUpperCase(),
                      })}
                      {" · "}
                      {entry.detail.duration.status === "known"
                        ? t("history.voiceSummary.duration", {
                            minutes: Math.max(
                              1,
                              Math.round(entry.detail.duration.milliseconds / 60_000),
                            ),
                          })
                        : t("history.voiceSummary.durationUnknown")}
                    </Muted>
                  </section>
                  <section>
                    <h3>{t("history.feedback")}</h3>
                    <p>{entry.detail.feedback.summary}</p>
                    {entry.detail.feedback.strengths.length > 0 && (
                      <ItemList>
                        {entry.detail.feedback.strengths.map((item) => (
                          <li key={`strength:${item}`}>{item}</li>
                        ))}
                      </ItemList>
                    )}
                    {entry.detail.feedback.priorities.length > 0 && (
                      <ItemList>
                        {entry.detail.feedback.priorities.map((item) => (
                          <li key={`priority:${item}`}>{item}</li>
                        ))}
                      </ItemList>
                    )}
                  </section>
                  {entry.detail.observedIssues.length > 0 && (
                    <section>
                      <h3>{t("history.voiceSummary.issues")}</h3>
                      <ItemList>
                        {entry.detail.observedIssues.map((issue) => (
                          <li key={`${issue.category}:${issue.observation}`}>
                            <strong>{issue.category}</strong>: {issue.observation} —{" "}
                            {issue.feedback}
                          </li>
                        ))}
                      </ItemList>
                    </section>
                  )}
                  {entry.detail.vocabulary.length > 0 && (
                    <section>
                      <h3>{t("history.voiceSummary.vocabulary")}</h3>
                      <ItemList>
                        {entry.detail.vocabulary.map((item) => (
                          <li key={`${item.lemma}:${item.meaning}`}>
                            <strong>{item.lemma}</strong> — {item.meaning}. {item.contextSummary}
                          </li>
                        ))}
                      </ItemList>
                    </section>
                  )}
                  <section>
                    <h3>{t("history.voiceSummary.nextSteps")}</h3>
                    <ItemList>
                      {entry.detail.nextSteps.map((step) => (
                        <li key={`${step.title}:${step.naturalRequest}`}>
                          <strong>{step.title}</strong> — {step.rationale}
                        </li>
                      ))}
                    </ItemList>
                    <ActionGroup>
                      {practiceState?.patternKey === `voice:${entry.historyEntryId}` &&
                      practiceState.status === "created" ? (
                        <Feedback live="off" tone="success">
                          {t("history.voiceSummary.practiceCreated")}
                        </Feedback>
                      ) : practiceState?.patternKey === `voice:${entry.historyEntryId}` &&
                        (practiceState.status === "queued" ||
                          practiceState.status === "running") ? (
                        <Feedback live="off">
                          {practiceState.status === "queued"
                            ? t("history.voiceSummary.practiceQueued")
                            : t("history.voiceSummary.practiceRunning")}
                        </Feedback>
                      ) : (
                        <Button onPress={() => void createVoiceFollowUp(entry)}>
                          <Sparkles aria-hidden="true" /> {t("history.voiceSummary.practice")}
                        </Button>
                      )}
                    </ActionGroup>
                  </section>
                  <Muted as="p">{t("history.voiceSummary.noAudio")}</Muted>
                  <ConfirmDialog
                    body={t("history.deleteBody")}
                    cancel={t("actions.cancel")}
                    confirm={t("actions.delete")}
                    onConfirm={() => deleteEntry(entry)}
                    title={t("history.deleteTitle")}
                    trigger={t("history.delete")}
                  />
                </div>
              ) : entry.detail.kind === "exercise-attempt" ? (
                <div className={styles.historyDetail}>
                  {entry.detail.readingMaterial && (
                    <section>
                      <h3>{entry.detail.readingMaterial.title}</h3>
                      <p className={styles.correctionText}>
                        {entry.detail.readingMaterial.passage}
                      </p>
                    </section>
                  )}

                  <section>
                    <h3>{t("history.exercisePrompt")}</h3>
                    <p>{entry.detail.instructions}</p>
                    <blockquote>{entry.detail.prompt}</blockquote>
                  </section>
                  <section>
                    <h3>{t("history.exerciseAnswer")}</h3>
                    <p className={styles.correctionText}>{exerciseAnswerText(entry.detail)}</p>
                  </section>
                  <section>
                    <h3>{t("history.feedback")}</h3>
                    <p>{entry.detail.feedback.summary}</p>
                    {feedbackTranslation(entry, "feedback-summary")}
                    {entry.detail.feedback.strengths.length > 0 && (
                      <>
                        <h4>{t("history.strengths")}</h4>
                        <ItemList>
                          {entry.detail.feedback.strengths.map((strength, index) => (
                            <li key={index}>
                              {strength}
                              {feedbackTranslation(entry, "feedback-strength", index)}
                            </li>
                          ))}
                        </ItemList>
                      </>
                    )}
                    {entry.detail.feedback.improvements.length > 0 && (
                      <>
                        <h4>{t("history.improvements")}</h4>
                        <ItemList>
                          {entry.detail.feedback.improvements.map((improvement, index) => (
                            <li key={index}>
                              {improvement}
                              {feedbackTranslation(entry, "feedback-improvement", index)}
                            </li>
                          ))}
                        </ItemList>
                      </>
                    )}
                    <ItemList>
                      {entry.detail.objectiveEvaluations.map((evaluation, position) => (
                        <li key={`${evaluation.outcome}:${String(position)}`}>
                          <strong>{t(`history.objectiveOutcomes.${evaluation.outcome}`)}</strong>{" "}
                          {evaluation.evidence}
                        </li>
                      ))}
                    </ItemList>
                  </section>
                  {(entry.detail.suggestedAnswer ||
                    entry.detail.acceptedAnswerReveal.length > 0) && (
                    <section>
                      <h3>{t("history.acceptedEvidence")}</h3>
                      <p>
                        {entry.detail.suggestedAnswer ??
                          entry.detail.acceptedAnswerReveal.join(" / ")}
                      </p>
                    </section>
                  )}
                  <ActionGroup>
                    <Button
                      onPress={() => {
                        if (entry.detail.kind === "exercise-attempt") {
                          onPracticeAgain({
                            kind: "exercise",
                            activityId: entry.detail.activityId,
                          });
                        }
                      }}
                    >
                      <Repeat2 aria-hidden="true" /> {t("history.practiceAgain")}
                    </Button>
                    <ConfirmDialog
                      body={t("history.deleteBody")}
                      cancel={t("actions.cancel")}
                      confirm={t("actions.delete")}
                      onConfirm={() => deleteEntry(entry)}
                      title={t("history.deleteTitle")}
                      triggerVariant="quiet"
                      trigger={t("history.delete")}
                    />
                  </ActionGroup>
                </div>
              ) : (
                <Muted as="p">{t("history.referenceOnly")}</Muted>
              )}
            </Disclosure>
          </Card>
        ))}
      </div>
    </Page>
  );
}
