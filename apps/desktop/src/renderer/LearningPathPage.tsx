import { Flag, RotateCcw, ArrowRight } from "lucide-react";
import { ActivityVisual } from "./activityPresentation.js";
import type {
  ProviderOperation,
  ActivityId,
  CourseActivity,
  CourseReference,
  CourseUnit,
  DesktopIpcRequest,
  CallNinaError,
} from "@call-nina/contracts";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  courseActivityStatus,
  courseLanguageProgress,
  courseOutcomeProgress,
  courseUnitEvidenceComplete,
  dueCourseReviews,
  nextCourseActivity,
  sameCourseActivity,
  resolveCourseReference,
} from "@call-nina/domain";
import {
  Button,
  Card,
  Disclosure,
  Feedback,
  Tabs,
  ItemList,
  LoadingState,
  Muted,
} from "./components/ui/index.js";
import { ActionGroup, Page, ContentRow, Section } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { useLearningPath } from "./useLearningPath.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { generatePracticeActivity } from "./generatePracticeActivity.js";
import { OperationError } from "./Startup.js";
import { OperationProgress } from "./OperationProgress.js";
import { PracticePage } from "./PracticePage.js";
import { LearningPathCatalog } from "./LearningPathCatalog.js";
import styles from "./LearningPathPage.module.css";

export function LearningPathPage({
  requestAiAccess,
  onOpenHistory,
  onNina,
}: {
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onNina: () => void;
  onOpenHistory: (
    ids?: NonNullable<
      Extract<DesktopIpcRequest, { channel: "history/read" }>["payload"]["historyEntryIds"]
    >,
  ) => void;
}) {
  const { t } = useTranslation();
  const learning = useLearningPath();
  const generation = useLearningOperation();
  const [view, setView] = useState<"library" | "trail" | "lesson">("library");
  const [stage, setStage] = useState("a1-1");
  const [expandedActivity, setExpandedActivity] = useState<string>();
  const [tab, setTab] = useState("course");
  const [selectedUnit, setSelectedUnit] = useState<string>();
  const [activityId, setActivityId] = useState<ActivityId>();
  const [vocabularyAdded, setVocabularyAdded] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [launchOrigin, setLaunchOrigin] = useState<string>();
  const [changingSituation, setChangingSituation] = useState(false);
  const [changedSituation, setChangedSituation] = useState<{
    unitId: string;
    previousMissionId: string | undefined;
  }>();
  const pending = useRef(false);
  const [error, setError] = useState<CallNinaError>();
  const snapshot = learning.snapshot;
  const locale = snapshot?.learningContext.explanationLanguage === "de" ? "de" : "en";
  const course = snapshot?.course;
  const state = snapshot?.state;
  const reference = (
    unit: CourseUnit,
    activity: CourseActivity | undefined,
    mode: CourseReference["mode"] = "course",
  ): CourseReference => {
    if (!course || !activity) throw new Error("OD_COURSE_REFERENCE_INVALID");
    return { version: course.version, unitId: unit.id, activityKey: activity.id, mode };
  };
  const mutate = async (
    ref: CourseReference,
    action: "select" | "complete-explanation" | "skip" | "reopen" | "new-mission",
  ) => {
    if (!snapshot || pending.current) return;
    pending.current = true;
    setBusy(true);
    setChangingSituation(action === "new-mission");
    setError(undefined);
    try {
      await invokeDesktop("learning-path/update", {
        expectedGeneration: snapshot.rootGeneration,
        reference: ref,
        action,
      });
      if (action === "new-mission")
        setChangedSituation({
          unitId: ref.unitId,
          previousMissionId: state?.missions.find(
            (mission) =>
              mission.version === ref.version &&
              mission.unitId === ref.unitId &&
              mission.mode === "course",
          )?.id,
        });
      setSelectedUnit(ref.unitId);
      await learning.refresh();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      pending.current = false;
      setBusy(false);
      setChangingSituation(false);
    }
  };
  const launch = async (ref: CourseReference, origin: string) => {
    if (!snapshot || !course || !state || pending.current) return;
    const { unit: launchedUnit, activity } = resolveCourseReference(course, ref);
    setSelectedUnit(ref.unitId);
    setStage(launchedUnit.stage);
    if (ref.mode === "course") setView("lesson");
    setExpandedActivity(activity.id);
    if (activity.delivery === "explanation") {
      setTab("course");
      await mutate(ref, "select");
      return;
    }
    const mission = state.missions.find(
      (m) => m.version === ref.version && m.unitId === ref.unitId && m.mode === "course",
    );
    const saved = state.activities.find(
      (a) =>
        sameCourseActivity(a.reference, ref) &&
        !a.completed &&
        (ref.mode === "review" || a.missionId === mission?.id),
    );
    if (saved) {
      setActivityId(saved.activityId);
      return;
    }
    pending.current = true;
    setBusy(true);
    setLaunchOrigin(origin);
    setError(undefined);
    try {
      if (ref.mode === "course")
        await invokeDesktop("learning-path/update", {
          expectedGeneration: snapshot.rootGeneration,
          reference: ref,
          action: "select",
        });
      setSelectedUnit(ref.unitId);
      if (activity.delivery === "listening" || activity.delivery === "speaking") {
        const result = await invokeDesktop("learning-path/prepare-voice", {
          expectedGeneration: snapshot.rootGeneration,
          reference: ref,
        });
        setActivityId(result.activityId);
      } else {
        if (!(await requestAiAccess("exercise-generation"))) return;
        setActivityId(
          await generatePracticeActivity(
            {
              source: "learning-path",
              expectedGeneration: snapshot.rootGeneration,
              reference: ref,
            },
            generation.run,
          ),
        );
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      pending.current = false;
      setBusy(false);
      setLaunchOrigin(undefined);
    }
  };
  const launchFeedback = (origin: string) =>
    launchOrigin === origin ? (
      <div className={styles.launchProgress}>
        {generation.progress ? (
          <OperationProgress progress={generation.progress} onCancel={generation.cancel} />
        ) : (
          <p role="status">{t("learningPath.preparing")}</p>
        )}
      </div>
    ) : null;
  if (activityId)
    return (
      <div className={styles.page}>
        <PracticePage
          onHistory={() => {
            onOpenHistory();
          }}
          onNina={onNina}
          parentLabel={
            tab === "course"
              ? (course?.units.find((unit) => unit.id === selectedUnit)?.title[locale] ??
                t("pathLibrary.title"))
              : t(tab === "review" ? "ui.review" : "learningPath.tabs.progress")
          }
          activityId={activityId}
          requestAiAccess={requestAiAccess}
          onOpenActivity={setActivityId}
          onCloseActivity={() => {
            setActivityId(undefined);
            void learning.refresh();
          }}
        />
      </div>
    );
  const next = course && state ? nextCourseActivity(course, state) : null;
  const scopedUnits =
    course?.units.filter((unit) => view === "library" || unit.stage === stage) ?? [];
  const due =
    course && state
      ? dueCourseReviews(course, state).filter((item) =>
          scopedUnits.some((unit) => unit.id === item.reference.unitId),
        )
      : [];
  const scopeLabel =
    view === "library"
      ? t("pathLibrary.allPaths")
      : t("pathLibrary.stage", { stage: stage.replace("a1-", "A1.") });
  const selected =
    course?.units.find((u) => u.id === (selectedUnit ?? next?.unitId ?? state?.current?.unitId)) ??
    course?.units[1];
  const counts = (unit: CourseUnit) => {
    const statuses = unit.activities.map((a) =>
      state ? courseActivityStatus(state, reference(unit, a)) : "not-started",
    );
    return {
      completed: statuses.filter((s) => s === "completed").length,
      skipped: statuses.filter((s) => s === "skipped").length,
      total: statuses.length,
    };
  };
  const unfinished = (unit: CourseUnit) => {
    const available = (activity: CourseActivity) =>
      state &&
      !["completed", "skipped"].includes(courseActivityStatus(state, reference(unit, activity)));
    return (
      unit.activities.find(
        (activity) =>
          state?.current?.unitId === unit.id &&
          state.current.activityKey === activity.id &&
          available(activity),
      ) ?? unit.activities.find(available)
    );
  };
  const openLesson = (unit: CourseUnit) => {
    setSelectedUnit(unit.id);
    setStage(unit.stage);
    setExpandedActivity((unfinished(unit) ?? unit.activities[0])?.id);
    setVocabularyAdded(undefined);
    setView("lesson");
    setTab("course");
  };
  const lessonNext = selected ? unfinished(selected) : undefined;
  const followingLesson = course?.units.find(
    (unit, index, units) =>
      index > units.findIndex((item) => item.id === selected?.id) && unit.stage === selected?.stage,
  );
  const activityCard = (unit: CourseUnit, activity: CourseActivity) => {
    if (!state) return null;
    const ref = reference(unit, activity);
    const status = courseActivityStatus(state, ref);
    const mission = state.missions.find(
      (m) => m.version === ref.version && m.unitId === ref.unitId && m.mode === "course",
    );
    const attempts = state.activities.filter(
      (a) => sameCourseActivity(a.reference, ref) && (!mission || a.missionId === mission.id),
    );
    return (
      <Disclosure
        key={activity.id}
        open={expandedActivity === activity.id}
        onToggle={(event) => {
          if (event.currentTarget.open) setExpandedActivity(activity.id);
          else setExpandedActivity((current) => (current === activity.id ? undefined : current));
        }}
        label={
          <span className={styles.activitySummary}>
            <ActivityVisual
              kind={activity.delivery === "explanation" ? "grammar" : activity.delivery}
            />
            <span>{activity.title[locale]}</span>
            <Muted>{t(`learningPath.status.${status}`)}</Muted>
          </span>
        }
      >
        <ContentRow
          actions={
            <ActionGroup className={styles.cardActions}>
              {activity.delivery === "explanation" ? (
                <Button
                  variant="secondary"
                  isDisabled={busy || status === "completed"}
                  onPress={() => void mutate(ref, "complete-explanation")}
                >
                  {t("learningPath.finishExplanation")}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  isPending={launchOrigin === `activity:${activity.id}`}
                  onPress={() => void launch(ref, `activity:${activity.id}`)}
                >
                  {t(
                    attempts.some((a) => !a.completed)
                      ? "missions.resume"
                      : attempts.length
                        ? "missions.retry"
                        : "learningPath.start",
                  )}
                </Button>
              )}
              <Button
                variant="quiet"
                isDisabled={busy}
                onPress={() =>
                  void mutate(ref, ["completed", "skipped"].includes(status) ? "reopen" : "skip")
                }
              >
                {t(
                  ["completed", "skipped"].includes(status)
                    ? "learningPath.reopen"
                    : "learningPath.skip",
                )}
              </Button>
            </ActionGroup>
          }
        >
          <p>
            {t(`missions.purpose.${activity.purpose}`)} ·{" "}
            {t(
              `learningPath.steps.${activity.delivery === "explanation" ? "learn" : activity.delivery}`,
            )}
          </p>
          <p>{activity.instructions[locale]}</p>
          {activity.delivery === "explanation" && (
            <>
              <Section>
                <p className={styles.explanation}>{unit.explanation[locale]}</p>
                <ItemList>
                  {unit.examples.map((e) => (
                    <li key={e.german}>
                      <strong>{e.german}</strong> — {e.meaning[locale]}
                    </li>
                  ))}
                </ItemList>
              </Section>
            </>
          )}
          {launchFeedback(`activity:${activity.id}`)}
          {attempts.some((a) => a.evidence.length) && (
            <Disclosure label={t("learningPath.evidence")}>
              <ItemList>
                {attempts
                  .flatMap((a) => a.evidence)
                  .slice(-8)
                  .map((e, i) => (
                    <li key={`${e.historyEntryId}-${String(i)}`}>
                      <strong>{t(`missions.outcome.${e.outcome}`)}</strong> — {e.evidence}{" "}
                      <Muted>
                        {t(`learningPath.uncertainty.${e.uncertainty}`)}
                        {e.support.length
                          ? ` · ${e.support.map((s) => t(`missions.support.${s}`)).join(", ")}`
                          : ""}
                      </Muted>
                    </li>
                  ))}
              </ItemList>
              <Button
                variant="secondary"
                onPress={() => {
                  onOpenHistory(attempts.flatMap((a) => a.historyEntryIds).slice(0, 100));
                }}
              >
                {t("learningPath.openHistory")}
              </Button>
            </Disclosure>
          )}
        </ContentRow>
      </Disclosure>
    );
  };
  const displayedError = error ?? learning.error;
  const selectedMission = state?.missions.find(
    (m) => m.unitId === selected?.id && m.version === course?.version && m.mode === "course",
  );
  const situationChanged =
    selectedMission &&
    changedSituation &&
    changedSituation.unitId === selected?.id &&
    changedSituation.previousMissionId !== selectedMission.id;
  return (
    <Page
      title={
        view === "library"
          ? t("pathLibrary.title")
          : view === "lesson" && selected
            ? selected.title[locale]
            : t("pathLibrary.stage", { stage: stage.replace("a1-", "A1.") })
      }
      {...(view !== "library"
        ? {
            breadcrumbs: [
              {
                label: t("pathLibrary.title"),
                onPress: () => {
                  setView("library");
                  setTab("course");
                },
              },
              ...(view === "lesson"
                ? [
                    {
                      label: t("pathLibrary.stage", { stage: stage.replace("a1-", "A1.") }),
                      onPress: () => setView("trail"),
                    },
                  ]
                : []),
            ],
          }
        : {})}
      {...(view === "lesson" && tab === "course" && selected
        ? { description: selected.scenario[locale] }
        : {})}
      refresh={{ onRefresh: learning.refresh, disabled: busy }}
    >
      {displayedError && <OperationError error={displayedError} />}
      {busy && !launchOrigin && !generation.busy && !changingSituation && (
        <Feedback live="polite">{t("learningPath.preparing")}</Feedback>
      )}
      {!snapshot && !learning.error && (
        <LoadingState live>{t("learningPath.loading")}</LoadingState>
      )}
      {snapshot && !course && <Feedback live="off">{t("learningPath.courseUnavailable")}</Feedback>}
      {course && state && (
        <Tabs
          label={t("learningPath.title")}
          selectedKey={tab}
          onSelectionChange={(key) => {
            setTab(key);
            if (view === "lesson" && key !== "course") setView("trail");
          }}
          items={[
            {
              id: "course",
              label: t(
                view === "library"
                  ? "pathLibrary.title"
                  : view === "lesson"
                    ? "missions.unitActivities"
                    : "pathLibrary.trail",
              ),
              children: (
                <div className={styles.unit}>
                  {view !== "lesson" && (
                    <LearningPathCatalog
                      course={course}
                      state={state}
                      locale={locale}
                      view={view}
                      stage={stage}
                      selectedUnit={selected?.id}
                      busy={busy}
                      onStage={(value) => {
                        setStage(value);
                        setView("trail");
                        setSelectedUnit(undefined);
                      }}
                      onSelect={setSelectedUnit}
                      onOpen={openLesson}
                    />
                  )}
                  {view === "lesson" && selected && (
                    <section className={styles.unit} aria-label={selected.title[locale]}>
                      <Card variant="brand" className={styles.recommendation}>
                        <div>
                          <Muted as="p">{t("learningPath.counts", counts(selected))}</Muted>
                          <h2>{lessonNext?.title[locale] ?? t("pathLibrary.lessonFinished")}</h2>
                        </div>
                        {lessonNext ? (
                          <Button
                            variant="primary"
                            isDisabled={busy}
                            isPending={launchOrigin === "lesson-next"}
                            onPress={() =>
                              void launch(reference(selected, lessonNext), "lesson-next")
                            }
                          >
                            {t("pathLibrary.continueActivity")}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            onPress={() =>
                              followingLesson ? openLesson(followingLesson) : setView("library")
                            }
                          >
                            {t(followingLesson ? "pathLibrary.nextLesson" : "pathLibrary.allPaths")}
                          </Button>
                        )}
                        {launchFeedback("lesson-next")}
                      </Card>
                      <h2 className={styles.activitiesHeading}>{t("missions.unitActivities")}</h2>
                      <div>{selected.activities.map((a) => activityCard(selected, a))}</div>
                      <Disclosure label={t("pathLibrary.aboutLesson")}>
                        <Section className={styles.unitOverview}>
                          <h2>{selected.title[locale]}</h2>
                          <p>{selected.scenario[locale]}</p>
                          <div className={styles.completion}>
                            <progress
                              value={counts(selected).completed}
                              max={counts(selected).total}
                              aria-label={t("learningPath.counts", counts(selected))}
                            />
                            <span>{t("learningPath.counts", counts(selected))}</span>
                          </div>
                          <div className={styles.unitDetails}>
                            <Disclosure label={t("missions.sharedFacts")}>
                              <section className={styles.scenario}>
                                <p>{selected.scenario[locale]}</p>
                                {selectedMission && <p>{selectedMission.facts}</p>}
                              </section>
                              <ActionGroup className={styles.cardActions}>
                                <Button
                                  variant="secondary"
                                  isPending={changingSituation}
                                  isDisabled={busy}
                                  onPress={() =>
                                    void mutate(
                                      reference(selected, selected.activities[0]),
                                      "new-mission",
                                    )
                                  }
                                >
                                  {t("missions.newContext")}
                                </Button>
                              </ActionGroup>
                              <p>{t("missions.newContextHint")}</p>
                              {situationChanged && (
                                <Feedback tone="success" live="polite">
                                  {t("missions.contextUpdated")}
                                </Feedback>
                              )}
                            </Disclosure>
                            <Disclosure label={t("ui.learningGoals")}>
                              <ItemList>
                                {selected.objectives.map((o) => (
                                  <li key={o.id}>{o.description[locale]}</li>
                                ))}
                              </ItemList>
                            </Disclosure>
                            <Disclosure label={t("missions.language")}>
                              <p>{selected.grammar[locale]}</p>
                              <Button
                                variant="primary"
                                isDisabled={busy}
                                onPress={() => {
                                  if (pending.current) return;
                                  pending.current = true;
                                  setBusy(true);
                                  setVocabularyAdded(undefined);
                                  void invokeDesktop("learning-path/vocabulary", {
                                    expectedGeneration: snapshot.rootGeneration,
                                    reference: reference(selected, selected.activities[0]),
                                  })
                                    .then((result) => {
                                      setVocabularyAdded(result.added);
                                    })
                                    .catch((cause: unknown) => {
                                      setError(normalizeDesktopError(cause).detail);
                                    })
                                    .finally(() => {
                                      pending.current = false;
                                      setBusy(false);
                                    });
                                }}
                              >
                                {t("missions.addVocabulary")}
                              </Button>
                              {vocabularyAdded !== undefined && (
                                <Feedback live="polite">
                                  {t("missions.vocabularyAdded", { count: vocabularyAdded })}
                                </Feedback>
                              )}
                              <dl className={styles.words}>
                                {course.targets
                                  .filter((target) => selected.targetIds.includes(target.id))
                                  .map((target) => (
                                    <div key={target.id}>
                                      <dt>{target.german}</dt>
                                      <dd>{target.meaning[locale]}</dd>
                                    </div>
                                  ))}
                              </dl>
                              <p>{t("missions.reuses")}</p>
                              <ItemList>
                                {course.targets
                                  .filter((target) => selected.reviewTargetIds.includes(target.id))
                                  .map((target) => (
                                    <li key={target.id}>{target.german}</li>
                                  ))}
                              </ItemList>
                            </Disclosure>
                          </div>
                        </Section>
                      </Disclosure>
                    </section>
                  )}
                </div>
              ),
            },
            {
              id: "review",
              label: t("missions.reviewTab", { count: due.length }),
              children: (
                <div className={styles.unit}>
                  <Card variant="brand" className={styles.progressSummary}>
                    <div className={styles.reviewCount}>
                      <RotateCcw aria-hidden="true" />
                      <strong>{due.length}</strong>
                    </div>
                    <div className={styles.progressHeadline}>
                      <Muted>{scopeLabel}</Muted>
                      <h2>
                        {t(due.length ? "pathLibrary.readyToReview" : "pathLibrary.allCaughtUp")}
                      </h2>
                      <span>
                        {t(due.length ? "pathLibrary.reviewHint" : "pathLibrary.keepExploring")}
                      </span>
                    </div>
                  </Card>
                  {due.length === 0 ? (
                    <ActionGroup>
                      <Button variant="secondary" onPress={() => setTab("course")}>
                        {t("pathLibrary.backToPath")}
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    </ActionGroup>
                  ) : (
                    <div className={styles.reviewGrid}>
                      {due.map((item) => {
                        const { unit, activity } = resolveCourseReference(course, item.reference);
                        return (
                          <ContentRow
                            variant="bordered"
                            key={`${item.reference.unitId}-${item.objectiveId}-${item.reference.retrieval ?? item.reference.activityKey}`}
                            leading={<ActivityVisual kind={activity.delivery} />}
                          >
                            <Muted>{unit.title[locale]}</Muted>
                            <h2>{activity.title[locale]}</h2>
                            {item.reference.retrieval && (
                              <Muted>
                                {t(`vocabulary.review.modes.${item.reference.retrieval}`)}
                              </Muted>
                            )}
                            <div className={styles.reviewActions}>
                              <span className={styles.reviewReason}>
                                <RotateCcw aria-hidden="true" />
                                {t(
                                  item.struggling
                                    ? "pathLibrary.focusedReview"
                                    : "pathLibrary.refreshReview",
                                )}
                              </span>
                              <Button
                                variant="primary"
                                isDisabled={busy}
                                isPending={
                                  launchOrigin ===
                                  `review:${item.reference.unitId}:${item.objectiveId}`
                                }
                                onPress={() =>
                                  void launch(
                                    item.reference,
                                    `review:${item.reference.unitId}:${item.objectiveId}`,
                                  )
                                }
                              >
                                {t("missions.startReview")}
                                <ArrowRight aria-hidden="true" />
                              </Button>
                            </div>
                            {launchFeedback(`review:${item.reference.unitId}:${item.objectiveId}`)}
                          </ContentRow>
                        );
                      })}
                    </div>
                  )}
                  <Disclosure label={t("pathLibrary.aboutReview")}>
                    <p>{t("missions.reviewMeaning")}</p>
                  </Disclosure>
                </div>
              ),
            },
            {
              id: "progress",
              label: t("learningPath.tabs.progress"),
              children: (
                <div className={styles.unit}>
                  <Card variant="brand" className={styles.progressSummary}>
                    <ProgressRing
                      completed={
                        scopedUnits.filter((unit) => counts(unit).completed === counts(unit).total)
                          .length
                      }
                      total={scopedUnits.length}
                      label={t("pathLibrary.lessonProgress", {
                        completed: scopedUnits.filter(
                          (unit) => counts(unit).completed === counts(unit).total,
                        ).length,
                        total: scopedUnits.length,
                      })}
                    />
                    <div className={styles.progressHeadline}>
                      <Muted>{scopeLabel}</Muted>
                      <h2>{t("pathLibrary.yourProgress")}</h2>
                      <span>{t("pathLibrary.lessonsCompleted")}</span>
                    </div>
                  </Card>
                  <div className={styles.progressGrid}>
                    {scopedUnits.map((unit, index) => (
                      <ContentRow key={unit.id} variant="bordered" className={styles.progressCard}>
                        <div className={styles.progressCardHeading}>
                          <span className={styles.lessonNumber}>
                            {unit.kind === "checkpoint" ? (
                              <Flag aria-hidden="true" />
                            ) : (
                              String(index + 1).padStart(2, "0")
                            )}
                          </span>
                          <div>
                            <Muted>{unit.stage.replace("a1-", "A1.")}</Muted>
                            <h2>{unit.title[locale]}</h2>
                          </div>
                        </div>
                        <div
                          className={styles.activityTrack}
                          role="img"
                          aria-label={t("learningPath.counts", counts(unit))}
                        >
                          {unit.activities.map((activity) => (
                            <span
                              key={activity.id}
                              data-status={courseActivityStatus(state, reference(unit, activity))}
                            />
                          ))}
                        </div>
                        <div className={styles.progressCardMeta}>
                          <span>
                            {t("pathLibrary.activityFraction", {
                              completed: counts(unit).completed,
                              total: counts(unit).total,
                            })}
                          </span>
                          <Button variant="quiet" onPress={() => openLesson(unit)}>
                            {t("pathLibrary.openLesson")}
                            <ArrowRight aria-hidden="true" />
                          </Button>
                        </div>
                        <Disclosure label={t("ui.details")}>
                          <p>{t("learningPath.counts", counts(unit))}</p>
                          <p>
                            {t(
                              courseUnitEvidenceComplete(course, state, unit)
                                ? "missions.established"
                                : "missions.buildingEvidence",
                            )}
                          </p>
                          <div className={styles.unitDetails}>
                            <Disclosure label={t("pathLibrary.skillDetails")}>
                              <ItemList>
                                {courseOutcomeProgress(course, state, unit).map((progress) => (
                                  <li key={progress.objective.id}>
                                    <strong>{progress.objective.description[locale]}</strong>
                                    <ItemList>
                                      {progress.skills.map((skill) => (
                                        <li key={skill.skill}>
                                          {t(`history.skills.${skill.skill}`)}:{" "}
                                          {t(
                                            skill.established
                                              ? "missions.established"
                                              : skill.latest
                                                ? `missions.outcome.${skill.latest.outcome}`
                                                : "missions.outcome.not-evaluated",
                                          )}
                                          {skill.due
                                            ? ` · ${t("missions.due")}`
                                            : skill.dueAt
                                              ? ` · ${t("missions.nextReview", { date: skill.dueAt.slice(0, 10) })}`
                                              : ""}
                                          {skill.struggling
                                            ? ` · ${t("missions.focusedRetry")}`
                                            : ""}
                                        </li>
                                      ))}
                                    </ItemList>
                                  </li>
                                ))}
                              </ItemList>
                            </Disclosure>
                            <Disclosure label={t("missions.constructions")}>
                              <ItemList>
                                {courseLanguageProgress(course, state, unit).map((p) => (
                                  <li key={p.target.id}>
                                    <strong>{p.target.german}</strong> —{" "}
                                    {t("missions.retrievalCounts", {
                                      recognition: p.recognition,
                                      recall: p.recall,
                                      use: p.use,
                                    })}
                                    {p.latest
                                      ? ` · ${t(`missions.outcome.${p.latest.outcome}`)}`
                                      : ""}
                                    <ItemList>
                                      {p.modes.map((mode) => (
                                        <li key={mode.retrieval}>
                                          {t(`vocabulary.review.modes.${mode.retrieval}`)}:{" "}
                                          {mode.dueAt
                                            ? t(mode.due ? "missions.due" : "missions.nextReview", {
                                                date: mode.dueAt.slice(0, 10),
                                              })
                                            : t("missions.outcome.not-evaluated")}
                                          {mode.latest && (
                                            <Muted as="p">
                                              {t(`missions.outcome.${mode.latest.outcome}`)}
                                              {mode.latest.support.length
                                                ? ` · ${mode.latest.support.map((s) => t(`missions.support.${s}`)).join(", ")}`
                                                : ""}
                                            </Muted>
                                          )}
                                          <Button
                                            variant="quiet"
                                            isDisabled={busy}
                                            isPending={
                                              launchOrigin ===
                                              `mode:${unit.id}:${p.target.id}:${mode.retrieval}`
                                            }
                                            onPress={() => {
                                              const activity = unit.activities.find(
                                                (a) =>
                                                  a.delivery === "practice" &&
                                                  a.targetIds.includes(p.target.id),
                                              );
                                              if (activity)
                                                void launch(
                                                  {
                                                    ...reference(unit, activity, "review"),
                                                    retrieval: mode.retrieval,
                                                  },
                                                  `mode:${unit.id}:${p.target.id}:${mode.retrieval}`,
                                                );
                                            }}
                                          >
                                            {t("missions.practiseMode", {
                                              mode: t(`vocabulary.review.modes.${mode.retrieval}`),
                                            })}
                                          </Button>
                                          {launchFeedback(
                                            `mode:${unit.id}:${p.target.id}:${mode.retrieval}`,
                                          )}
                                        </li>
                                      ))}
                                    </ItemList>
                                  </li>
                                ))}
                              </ItemList>
                            </Disclosure>
                          </div>
                          <ActionGroup className={styles.cardActions}>
                            {state.activities.some(
                              (a) => a.reference.unitId === unit.id && a.historyEntryIds.length,
                            ) && (
                              <Button
                                variant="secondary"
                                onPress={() => {
                                  onOpenHistory(
                                    state.activities
                                      .filter((a) => a.reference.unitId === unit.id)
                                      .flatMap((a) => a.historyEntryIds)
                                      .slice(0, 100),
                                  );
                                }}
                              >
                                {t("missions.savedWork")}
                              </Button>
                            )}
                          </ActionGroup>
                        </Disclosure>
                      </ContentRow>
                    ))}
                  </div>
                  <Disclosure label={t("pathLibrary.aboutProgress")}>
                    <p>{t("missions.progressMeaning")}</p>
                  </Disclosure>
                </div>
              ),
            },
            {
              id: "checkpoints",
              label: t("missions.checkpoints"),
              children: (
                <div className={styles.unit}>
                  <Section
                    className={styles.tabIntro}
                    title={t("missions.checkpoints")}
                    description={t("pathLibrary.checkpointHint")}
                  >
                    <Muted>{scopeLabel}</Muted>
                    <Disclosure label={t("ui.details")}>
                      <p>{t("missions.checkpointMeaning")}</p>
                    </Disclosure>
                  </Section>
                  {scopedUnits
                    .filter((u) => u.kind === "checkpoint")
                    .map((unit) => (
                      <ContentRow
                        key={unit.id}
                        leading={
                          <span className={styles.checkpointIcon}>
                            <Flag aria-hidden="true" />
                          </span>
                        }
                      >
                        <Muted>
                          {t("pathLibrary.stage", { stage: unit.stage.replace("a1-", "A1.") })}
                        </Muted>
                        <h2>{unit.title[locale]}</h2>
                        <p>{unit.scenario[locale]}</p>
                        <div className={styles.completion}>
                          <progress
                            value={counts(unit).completed}
                            max={counts(unit).total}
                            aria-label={t("learningPath.counts", counts(unit))}
                          />
                          <span>{t("learningPath.counts", counts(unit))}</span>
                        </div>
                        <ActionGroup className={styles.cardActions}>
                          <Button
                            variant="primary"
                            isDisabled={busy}
                            onPress={() => {
                              openLesson(unit);
                            }}
                          >
                            {t("pathLibrary.openLesson")}
                          </Button>
                        </ActionGroup>
                      </ContentRow>
                    ))}
                </div>
              ),
            },
          ]}
        />
      )}
    </Page>
  );
}

function ProgressRing({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label: string;
}) {
  return (
    <div className={styles.progressRing} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className={styles.ringTrack} cx="50" cy="50" r="42" />
        <circle
          className={styles.ringValue}
          cx="50"
          cy="50"
          r="42"
          pathLength="100"
          strokeDasharray={`${total ? (completed / total) * 100 : 0} 100`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span aria-hidden="true">
        <strong>{completed}</strong>
        <small>/ {total}</small>
      </span>
    </div>
  );
}
