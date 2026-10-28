import type {
  CourseActivity,
  CourseReference,
  CourseUnit,
  HistoryEntryId,
} from "@call-nina/contracts";
import { useId, useState, useRef, type ReactNode } from "react";
import { ArrowRight, Check, Circle, SkipForward, Lightbulb, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { courseActivityStatus, sameCourseActivity } from "@call-nina/domain";
import { ActivityVisual } from "./activityPresentation.js";
import { Button, Card, Disclosure, ItemList, Muted, Nina, Tabs } from "./components/ui/index.js";
import { ActionGroup, Section } from "./components/layout/index.js";
import type { LearningPathSnapshot } from "./useLearningPath.js";
import { lessonCounts, nextLessonActivity, courseReference } from "./learningPathNavigation.js";
import styles from "./LearningPathPage.module.css";
import { LessonGuide } from "./LessonGuide.js";
import { LearningPathProgress } from "./LearningPathProgress.js";

export function LearningPathLesson({
  snapshot,
  selected,
  expandedActivity,
  setExpandedActivity,
  busy,
  launchOrigin,
  launch,
  launchFeedback,
  mutate,
  onOpenHistory,
  openLesson,
  onTrail,
  vocabularyAdded,
  onAddVocabulary,
  changingSituation,
  situationChanged,
}: {
  snapshot: LearningPathSnapshot;
  selected: CourseUnit;
  expandedActivity: string | undefined;
  setExpandedActivity: (
    value: string | undefined | ((current: string | undefined) => string | undefined),
  ) => void;
  busy: boolean;
  launchOrigin: string | undefined;
  launch: (ref: CourseReference, origin: string) => Promise<void>;
  launchFeedback: (origin: string) => ReactNode;
  mutate: (
    ref: CourseReference,
    action: "select" | "complete-explanation" | "skip" | "reopen" | "new-mission",
  ) => Promise<void>;
  onOpenHistory: (ids: HistoryEntryId[]) => void;
  openLesson: (unit: CourseUnit) => void;
  onTrail: () => void;
  vocabularyAdded: number | undefined;
  onAddVocabulary: () => void;
  changingSituation: boolean;
  situationChanged: boolean;
}) {
  const { t } = useTranslation();
  const helpGroup = useId();
  const [lessonTab, setLessonTab] = useState({ lesson: selected.id, tab: "activities" });
  const lessonRoot = useRef<HTMLElement>(null);
  const returnToActivity = () => {
    setLessonTab({ lesson: selected.id, tab: "activities" });
    requestAnimationFrame(() =>
      lessonRoot.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
    );
  };
  const { course, state } = snapshot;
  if (!course) return null;
  const locale =
    snapshot.learningContext.explanationLanguage === "en-US"
      ? "en"
      : snapshot.learningContext.explanationLanguage;
  const reference = (
    unit: CourseUnit,
    activity: CourseActivity | undefined,
    mode: CourseReference["mode"] = "course",
  ) => courseReference(course, unit, activity, mode);
  const counts = (unit: CourseUnit) => lessonCounts(course, state, unit);
  const lessonNext = nextLessonActivity(course, state, selected);
  const followingLesson = course.units.find(
    (unit, index) =>
      index > course.units.findIndex((item) => item.id === selected.id) &&
      unit.stage === selected.stage,
  );
  const selectedMission = state.missions.find(
    (m) => m.unitId === selected.id && m.version === course.version && m.mode === "course",
  );
  const activity =
    selected.activities.find((item) => item.id === expandedActivity) ??
    lessonNext ??
    selected.activities[0];
  if (!activity) return null;
  const ref = reference(selected, activity);
  const status = courseActivityStatus(state, ref);
  const attempts = state.activities.filter(
    (a) =>
      sameCourseActivity(a.reference, ref) &&
      (!selectedMission || a.missionId === selectedMission.id),
  );
  const statusLabel = (item: CourseActivity) => {
    const itemReference = reference(selected, item);
    const itemStatus = courseActivityStatus(state, itemReference);
    const hasPreviousAttempt = state.activities.some(
      (attempt) =>
        sameCourseActivity(attempt.reference, itemReference) &&
        (!selectedMission || attempt.missionId === selectedMission.id),
    );
    return t(
      `learningPath.status.${itemStatus === "not-started" && hasPreviousAttempt ? "ready-to-retry" : itemStatus}`,
    );
  };
  const explanation = activity.delivery === "explanation";
  const firstExample = selected.examples[0];
  const finished = counts(selected).completed === counts(selected).total;
  const goForward = () => {
    if (lessonNext) setExpandedActivity(lessonNext.id);
    else if (followingLesson) openLesson(followingLesson);
    else onTrail();
  };
  return (
    <section ref={lessonRoot} className={styles.unit} aria-label={selected.title[locale]}>
      <Tabs
        key={selected.id}
        selectedKey={lessonTab.lesson === selected.id ? lessonTab.tab : "activities"}
        onSelectionChange={(tab) => setLessonTab({ lesson: selected.id, tab })}
        label={selected.title[locale]}
        density="compact"
        items={[
          {
            id: "activities",
            label: t("missions.unitActivities"),
            children: (
              <div className={styles.unit}>
                <div className={styles.lessonProgressHeader}>
                  <Muted as="span">{t("learningPath.counts", counts(selected))}</Muted>
                  <div
                    className={styles.activityTrack}
                    role="img"
                    aria-label={t("learningPath.counts", counts(selected))}
                  >
                    {selected.activities.map((item) => (
                      <span
                        key={item.id}
                        data-status={courseActivityStatus(state, reference(selected, item))}
                      />
                    ))}
                  </div>
                </div>
                <div className={styles.lessonWorkspace}>
                  <nav
                    className={styles.activityNavigation}
                    aria-label={t("missions.unitActivities")}
                  >
                    {selected.activities.map((item) => {
                      const itemStatus = courseActivityStatus(state, reference(selected, item));
                      const StatusIcon =
                        itemStatus === "completed"
                          ? Check
                          : itemStatus === "skipped"
                            ? SkipForward
                            : Circle;
                      return (
                        <Button
                          key={item.id}
                          variant="quiet"
                          className={styles.activityChoice}
                          {...(item.id === activity.id ? { "aria-current": "step" as const } : {})}
                          aria-label={`${item.title[locale]} — ${statusLabel(item)}`}
                          aria-controls="lesson-activity-panel"
                          data-path-activity={item.id}
                          data-path-focus={`select-activity:${item.id}`}
                          isDisabled={busy}
                          onPress={() => setExpandedActivity(item.id)}
                        >
                          <ActivityVisual
                            kind={
                              item.delivery === "explanation"
                                ? item.input
                                  ? "reading"
                                  : "grammar"
                                : item.delivery
                            }
                          />
                          <span className={styles.activityChoiceText}>{item.title[locale]}</span>
                          <span
                            className={styles.activityStatus}
                            data-status={itemStatus}
                            aria-hidden="true"
                          >
                            <StatusIcon />
                          </span>
                        </Button>
                      );
                    })}
                  </nav>
                  <Card
                    as="section"
                    id="lesson-activity-panel"
                    aria-labelledby="lesson-activity-heading"
                    className={styles.learningPanel}
                  >
                    <header className={styles.learningPanelHeader}>
                      <div className={styles.summaryText}>
                        <Muted as="span">{statusLabel(activity)}</Muted>
                        <h2 id="lesson-activity-heading">{activity.title[locale]}</h2>
                      </div>
                      {explanation && (
                        <Nina pose={finished ? "celebration" : "welcome"} size="medium" />
                      )}
                    </header>
                    <div key={activity.id} className={styles.learningPanelContent}>
                      {explanation && (
                        <p className={styles.activityInstruction}>
                          {activity.instructions[locale]}
                        </p>
                      )}
                      {explanation ? (
                        <>
                          {activity.input ? (
                            <div
                              className={styles.lessonPassage}
                              lang={snapshot.learningContext.targetLanguage}
                            >
                              {activity.input}
                            </div>
                          ) : firstExample ? (
                            <div className={styles.phraseSpotlight}>
                              <p lang={snapshot.learningContext.targetLanguage}>
                                {firstExample.text}
                              </p>
                              <Muted as="p">{firstExample.meaning[locale]}</Muted>
                            </div>
                          ) : null}
                          {activity.questions.length > 0 && (
                            <ItemList>
                              {activity.questions.map((question, index) => (
                                <li key={index}>{question[locale]}</li>
                              ))}
                            </ItemList>
                          )}
                          <Disclosure
                            variant="inline"
                            name={`${helpGroup}-${activity.id}`}
                            label={
                              <span className={styles.lessonDisclosureLabel}>
                                <Lightbulb aria-hidden="true" />
                                {t("lessonStudio.howItWorks")}
                              </span>
                            }
                          >
                            <p className={styles.explanation}>{selected.explanation[locale]}</p>
                          </Disclosure>
                          {(activity.input || selected.examples.length > 1) && (
                            <Disclosure
                              variant="inline"
                              name={`${helpGroup}-${activity.id}`}
                              label={
                                <span className={styles.lessonDisclosureLabel}>
                                  <BookOpen aria-hidden="true" />
                                  {t("lessonStudio.examples")}
                                </span>
                              }
                            >
                              <dl className={styles.lessonExamples}>
                                {(activity.input
                                  ? selected.examples
                                  : selected.examples.slice(1)
                                ).map((example) => (
                                  <div key={example.text}>
                                    <dt lang={snapshot.learningContext.targetLanguage}>
                                      {example.text}
                                    </dt>
                                    <dd>{example.meaning[locale]}</dd>
                                  </div>
                                ))}
                              </dl>
                            </Disclosure>
                          )}
                        </>
                      ) : (
                        <div className={styles.activityInvitation}>
                          <Nina
                            pose={
                              finished
                                ? "celebration"
                                : activity.delivery === "listening" ||
                                    activity.delivery === "speaking"
                                  ? "listening"
                                  : "thinking"
                            }
                            size="hero"
                          />
                        </div>
                      )}
                      {launchFeedback(`activity:${activity.id}`)}
                      {attempts.some((a) => a.evidence.length) && (
                        <Button
                          variant="quiet"
                          onPress={() =>
                            onOpenHistory(attempts.flatMap((a) => a.historyEntryIds).slice(0, 100))
                          }
                        >
                          {t("learningPath.evidence")}
                        </Button>
                      )}
                    </div>
                    <footer className={styles.lessonFooter}>
                      <Button
                        variant="quiet"
                        isDisabled={busy}
                        leadingIcon={<SkipForward aria-hidden="true" />}
                        onPress={() =>
                          void mutate(
                            ref,
                            ["completed", "skipped"].includes(status) ? "reopen" : "skip",
                          )
                        }
                      >
                        {t(
                          ["completed", "skipped"].includes(status)
                            ? "learningPath.reopen"
                            : "learningPath.skip",
                        )}
                      </Button>
                      <ActionGroup align="end">
                        {!lessonNext && !explanation && (
                          <Button
                            variant="secondary"
                            isDisabled={busy}
                            isPending={launchOrigin === `activity:${activity.id}`}
                            onPress={() => void launch(ref, `activity:${activity.id}`)}
                          >
                            {t(
                              attempts.some((attempt) => !attempt.completed)
                                ? "missions.resume"
                                : attempts.length
                                  ? "missions.retry"
                                  : "learningPath.start",
                            )}
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          isDisabled={busy}
                          isPending={launchOrigin === `activity:${activity.id}`}
                          data-path-focus={`activity:${activity.id}`}
                          trailingIcon={<ArrowRight aria-hidden="true" />}
                          onPress={() => {
                            if (!lessonNext || (explanation && status === "completed")) goForward();
                            else if (explanation) void mutate(ref, "complete-explanation");
                            else void launch(ref, `activity:${activity.id}`);
                          }}
                        >
                          {t(
                            !lessonNext
                              ? followingLesson
                                ? "pathLibrary.nextLesson"
                                : "pathFlow.backTrail"
                              : explanation
                                ? status === "completed"
                                  ? "actions.continue"
                                  : "lessonStudio.finishAndContinue"
                                : attempts.some((a) => !a.completed)
                                  ? "missions.resume"
                                  : attempts.length
                                    ? "missions.retry"
                                    : "learningPath.start",
                          )}
                        </Button>
                      </ActionGroup>
                    </footer>
                  </Card>
                </div>
              </div>
            ),
          },
          {
            id: "progress",
            label: t("lessonStudio.progress"),
            children: (
              <Card density="compact">
                <LearningPathProgress
                  snapshot={snapshot}
                  unit={selected}
                  busy={busy}
                  launchOrigin={launchOrigin}
                  launch={launch}
                  launchFeedback={launchFeedback}
                  onOpenHistory={onOpenHistory}
                />
              </Card>
            ),
          },
          {
            id: "resources",
            label: t("lessonStudio.resources"),
            children: (
              <Section className={styles.unitOverview}>
                <ActionGroup>
                  <Button variant="quiet" onPress={returnToActivity}>
                    {t("ui.back")} · {t("missions.unitActivities")}
                  </Button>
                </ActionGroup>
                <LessonGuide
                  snapshot={snapshot}
                  selected={selected}
                  busy={busy}
                  changingSituation={changingSituation}
                  situationChanged={situationChanged}
                  vocabularyAdded={vocabularyAdded}
                  onAddVocabulary={onAddVocabulary}
                  onChangeSituation={() =>
                    void mutate(reference(selected, selected.activities[0]), "new-mission")
                  }
                />
              </Section>
            ),
          },
        ]}
      />
    </section>
  );
}
