import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ActivityId,
  CourseActivity,
  CourseReference,
  CourseUnit,
  DesktopIpcRequest,
  CallNinaError,
} from "@call-nina/contracts";
import {
  courseActivityStatus,
  courseLanguageProgress,
  courseOutcomeProgress,
  courseUnitEvidenceComplete,
  dueCourseReviews,
  nextCourseActivity,
  recommendCourseActivity,
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
import { ActionGroup, ContentGrid, Page } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { useLearningPath } from "./useLearningPath.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { generatePracticeActivity } from "./generatePracticeActivity.js";
import { OperationError } from "./Startup.js";
import { OperationProgress } from "./OperationProgress.js";
import { PracticePage } from "./PracticePage.js";
import styles from "./LearningPathPage.module.css";

export function LearningPathPage({
  requestAiAccess,
  onOpenHistory,
}: {
  requestAiAccess: () => Promise<boolean>;
  onOpenHistory: (
    ids?: NonNullable<
      Extract<DesktopIpcRequest, { channel: "history/read" }>["payload"]["historyEntryIds"]
    >,
  ) => void;
}) {
  const { t } = useTranslation();
  const learning = useLearningPath();
  const generation = useLearningOperation();
  const [tab, setTab] = useState("course");
  const [selectedUnit, setSelectedUnit] = useState<string>();
  const [activityId, setActivityId] = useState<ActivityId>();
  const [vocabularyAdded, setVocabularyAdded] = useState<number>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<CallNinaError>();
  const snapshot = learning.snapshot;
  const locale = snapshot?.learningContext.explanationLanguage ?? "en";
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
    setError(undefined);
    try {
      await invokeDesktop("learning-path/update", {
        expectedGeneration: snapshot.rootGeneration,
        reference: ref,
        action,
      });
      setSelectedUnit(ref.unitId);
      await learning.refresh();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const launch = async (ref: CourseReference) => {
    if (!snapshot || !course || !state || pending.current) return;
    const { activity } = resolveCourseReference(course, ref);
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
        if (!(await requestAiAccess())) return;
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
    }
  };
  if (activityId)
    return (
      <div className={styles.page}>
        <PracticePage
          parentLabel={t("learningPath.title")}
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
  const recommended = course && state ? recommendCourseActivity(course, state) : null;
  const due = course && state ? dueCourseReviews(course, state) : [];
  const selected =
    course?.units.find((u) => u.id === (selectedUnit ?? next?.unitId ?? state?.current?.unitId)) ??
    course?.units[1];
  const describe = (ref: CourseReference) => {
    const { unit, activity } = resolveCourseReference(course ?? null, ref);
    return `${unit.title[locale]} · ${activity.title[locale]}${ref.retrieval ? ` · ${t(`vocabulary.review.modes.${ref.retrieval}`)}` : ""}`;
  };
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
      <Card as="article" key={activity.id}>
        <Muted as="p">
          {t(`missions.purpose.${activity.purpose}`)} ·{" "}
          {t(
            `learningPath.steps.${activity.delivery === "explanation" ? "learn" : activity.delivery}`,
          )}
        </Muted>
        <h3>{activity.title[locale]}</h3>
        <p>{activity.instructions[locale]}</p>
        <Muted as="p">{t(`learningPath.status.${status}`)}</Muted>
        {activity.delivery === "explanation" && (
          <>
            <Disclosure label={t("missions.explanation")}>
              <p className={styles.explanation}>{unit.explanation[locale]}</p>
              <ItemList>
                {unit.examples.map((e) => (
                  <li key={e.german}>
                    <strong>{e.german}</strong> — {e.meaning[locale]}
                  </li>
                ))}
              </ItemList>
            </Disclosure>
          </>
        )}
        <ActionGroup>
          {activity.delivery === "explanation" ? (
            <Button
              isDisabled={busy || status === "completed"}
              onPress={() => void mutate(ref, "complete-explanation")}
            >
              {t("learningPath.finishExplanation")}
            </Button>
          ) : (
            <Button isDisabled={busy} onPress={() => void launch(ref)}>
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
              onPress={() => {
                onOpenHistory(attempts.flatMap((a) => a.historyEntryIds).slice(0, 100));
              }}
            >
              {t("learningPath.openHistory")}
            </Button>
          </Disclosure>
        )}
      </Card>
    );
  };
  const displayedError = error ?? learning.error;
  const selectedMission = state?.missions.find(
    (m) => m.unitId === selected?.id && m.version === course?.version && m.mode === "course",
  );
  return (
    <Page title={t("learningPath.title")} refresh={{ onRefresh: learning.refresh, disabled: busy }}>
      <p>{t("missions.intro")}</p>
      {displayedError && <OperationError error={displayedError} />}
      <OperationProgress progress={generation.progress} onCancel={generation.cancel} />
      {busy && !generation.busy && <Feedback live="polite">{t("learningPath.preparing")}</Feedback>}
      {!snapshot && !learning.error && (
        <LoadingState live>{t("learningPath.loading")}</LoadingState>
      )}
      {snapshot && !course && <Feedback live="off">{t("learningPath.courseUnavailable")}</Feedback>}
      {course && state && (
        <Tabs
          label={t("learningPath.title")}
          selectedKey={tab}
          onSelectionChange={setTab}
          items={[
            {
              id: "course",
              label: t("learningPath.tabs.course"),
              children: (
                <div className={styles.unit}>
                  {recommended && (
                    <Card>
                      <h2>{t(`missions.recommendation.${recommended.reason}`)}</h2>
                      <p>{describe(recommended.reference)}</p>
                      <ActionGroup>
                        <Button
                          variant="primary"
                          isDisabled={busy}
                          onPress={() => void launch(recommended.reference)}
                        >
                          {t("learningPath.continue")}
                        </Button>
                        {next && recommended.reason === "review" && (
                          <Button isDisabled={busy} onPress={() => void launch(next)}>
                            {t("missions.continueCourse")}
                          </Button>
                        )}
                      </ActionGroup>
                    </Card>
                  )}
                  <ActionGroup>
                    {(["a1-1", "a1-2"] as const).map((stage) => (
                      <Button
                        key={stage}
                        isDisabled={busy}
                        aria-pressed={state.selectedStage === stage}
                        onPress={() => {
                          const unit = course.units.find(
                            (u) => u.stage === stage && u.kind === "module",
                          );
                          if (unit) void mutate(reference(unit, unit.activities[0]), "select");
                        }}
                      >
                        {stage === "a1-1" ? "A1.1" : "A1.2"}
                      </Button>
                    ))}
                  </ActionGroup>
                  <Disclosure label={t("missions.map")} defaultOpen>
                    <div className={styles.outline}>
                      {course.units
                        .filter((u) => u.stage === state.selectedStage)
                        .map((u) => (
                          <Button
                            key={u.id}
                            variant="quiet"
                            aria-pressed={selected?.id === u.id}
                            isDisabled={busy}
                            onPress={() => {
                              setSelectedUnit(u.id);
                              void mutate(reference(u, u.activities[0]), "select");
                            }}
                          >
                            {u.title[locale]}
                            {u.kind === "launchpad" ? ` · ${t("missions.optional")}` : ""}
                          </Button>
                        ))}
                    </div>
                  </Disclosure>
                  {selected && (
                    <section className={styles.unit} aria-label={selected.title[locale]}>
                      <Card>
                        <h2>{selected.title[locale]}</h2>
                        <p>{selected.scenario[locale]}</p>
                        <p>{t("learningPath.counts", counts(selected))}</p>
                        <ItemList>
                          {selected.objectives.map((o) => (
                            <li key={o.id}>{o.description[locale]}</li>
                          ))}
                        </ItemList>
                        <Disclosure label={t("missions.language")}>
                          <p>{selected.grammar[locale]}</p>
                          <Button
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
                        {selectedMission && (
                          <Disclosure label={t("missions.sharedFacts")}>
                            <p>{selectedMission.facts}</p>
                          </Disclosure>
                        )}
                        <Button
                          variant="quiet"
                          isDisabled={busy}
                          onPress={() =>
                            void mutate(reference(selected, selected.activities[0]), "new-mission")
                          }
                        >
                          {t("missions.newContext")}
                        </Button>
                      </Card>
                      {selected.activities.map((a) => activityCard(selected, a))}
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
                  <p>{t("missions.reviewMeaning")}</p>
                  {due.length === 0 ? (
                    <Muted as="p">{t("missions.nothingDue")}</Muted>
                  ) : (
                    due.slice(0, 12).map((item) => (
                      <Card
                        key={`${item.reference.unitId}-${item.objectiveId}-${item.reference.retrieval ?? item.reference.activityKey}`}
                      >
                        <h2>{describe(item.reference)}</h2>
                        <p>
                          {t(item.struggling ? "missions.focusedRetry" : "missions.delayedCheck")}
                        </p>
                        <Button isDisabled={busy} onPress={() => void launch(item.reference)}>
                          {t("missions.startReview")}
                        </Button>
                      </Card>
                    ))
                  )}
                </div>
              ),
            },
            {
              id: "progress",
              label: t("learningPath.tabs.progress"),
              children: (
                <div className={styles.unit}>
                  <p>{t("missions.progressMeaning")}</p>
                  <ContentGrid>
                    {course.units.map((unit) => (
                      <Card key={unit.id}>
                        <h2>{unit.title[locale]}</h2>
                        <p>{t("learningPath.counts", counts(unit))}</p>
                        <p>
                          {t(
                            courseUnitEvidenceComplete(course, state, unit)
                              ? "missions.established"
                              : "missions.buildingEvidence",
                          )}
                        </p>
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
                                    {skill.struggling ? ` · ${t("missions.focusedRetry")}` : ""}
                                  </li>
                                ))}
                              </ItemList>
                            </li>
                          ))}
                        </ItemList>
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
                                {p.latest ? ` · ${t(`missions.outcome.${p.latest.outcome}`)}` : ""}
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
                                        onPress={() => {
                                          const activity = unit.activities.find(
                                            (a) =>
                                              a.delivery === "practice" &&
                                              a.targetIds.includes(p.target.id),
                                          );
                                          if (activity)
                                            void launch({
                                              ...reference(unit, activity, "review"),
                                              retrieval: mode.retrieval,
                                            });
                                        }}
                                      >
                                        {t("missions.practiseMode", {
                                          mode: t(`vocabulary.review.modes.${mode.retrieval}`),
                                        })}
                                      </Button>
                                    </li>
                                  ))}
                                </ItemList>
                              </li>
                            ))}
                          </ItemList>
                        </Disclosure>
                        <ActionGroup>
                          <Button
                            onPress={() => {
                              setSelectedUnit(unit.id);
                              setTab("course");
                              void mutate(reference(unit, unit.activities[0]), "select");
                            }}
                          >
                            {t("learningPath.openUnit")}
                          </Button>
                          {state.activities.some(
                            (a) => a.reference.unitId === unit.id && a.historyEntryIds.length,
                          ) && (
                            <Button
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
                      </Card>
                    ))}
                  </ContentGrid>
                </div>
              ),
            },
            {
              id: "checkpoints",
              label: t("missions.checkpoints"),
              children: (
                <div className={styles.unit}>
                  <p>{t("missions.checkpointMeaning")}</p>
                  {course.units
                    .filter((u) => u.kind === "checkpoint")
                    .map((unit) => (
                      <Card key={unit.id}>
                        <h2>{unit.title[locale]}</h2>
                        <p>{unit.scenario[locale]}</p>
                        <Button
                          isDisabled={busy}
                          onPress={() => {
                            setTab("course");
                            void mutate(reference(unit, unit.activities[0]), "select");
                          }}
                        >
                          {t("learningPath.openUnit")}
                        </Button>
                      </Card>
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
