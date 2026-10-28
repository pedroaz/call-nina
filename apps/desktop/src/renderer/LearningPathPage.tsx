import { ProviderActionSummary } from "./ProviderActionSummary.js";
import { BookOpen } from "lucide-react";
import { ActivityHeaderActionsContext } from "./components/activity/index.js";
import type {
  ProviderOperation,
  ActivityId,
  CourseReference,
  CourseUnit,
  DesktopIpcRequest,
  CallNinaError,
} from "@call-nina/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dueCourseReviews, sameCourseActivity, resolveCourseReference } from "@call-nina/domain";
import { Button, ModalDialog, Feedback, LoadingState } from "./components/ui/index.js";
import { Page } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { useLearningPath, type LearningPathSnapshot } from "./useLearningPath.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { generatePracticeActivity } from "./generatePracticeActivity.js";
import { OperationError } from "./Startup.js";
import { OperationProgress } from "./OperationProgress.js";
import { PracticePage } from "./PracticePage.js";
import { LearningPathCatalog } from "./LearningPathCatalog.js";
import { LessonGuide } from "./LessonGuide.js";
import { LearningPathLesson } from "./LearningPathLesson.js";
import { LearningPathReview } from "./LearningPathReview.js";
import { LearningPathCompletion } from "./LearningPathCompletion.js";
import {
  courseReference,
  nextLessonActivity,
  nextPathActivity,
  type PathNavigation,
} from "./learningPathNavigation.js";
import styles from "./LearningPathPage.module.css";

type Props = {
  onLanguageSwitchBlockedChange?: (blocked: boolean) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onNina: () => void;
  onOpenResults: (
    ids?: NonNullable<
      Extract<DesktopIpcRequest, { channel: "history/read" }>["payload"]["historyEntryIds"]
    >,
  ) => void;
};
export function LearningPathPage(props: Props) {
  const learning = useLearningPath();
  const { t } = useTranslation();
  const snapshot = learning.snapshot;
  if (!snapshot)
    return (
      <Page title={t("pathLibrary.title")} refresh={{ onRefresh: learning.refresh }}>
        {learning.error ? (
          <OperationError error={learning.error} />
        ) : (
          <LoadingState live>{t("learningPath.loading")}</LoadingState>
        )}
      </Page>
    );
  // A different learner/course owns a new navigation and operation lifetime.
  const scope = `${String(snapshot.rootGeneration)}:${snapshot.learningContext.learnerId}:${snapshot.learningContext.targetLanguage}:${snapshot.course?.version ?? "none"}`;
  return (
    <LearningPathWorkspace
      key={scope}
      {...props}
      snapshot={snapshot}
      refresh={learning.refresh}
      readError={learning.error}
    />
  );
}
function LearningPathWorkspace({
  onLanguageSwitchBlockedChange,
  snapshot,
  refresh,
  readError,
  requestAiAccess,
  onOpenResults,
  onNina,
}: Props & {
  snapshot: LearningPathSnapshot;
  refresh: () => Promise<LearningPathSnapshot | undefined>;
  readError: CallNinaError | undefined;
}) {
  const { t } = useTranslation();
  const generation = useLearningOperation();
  const [guideOpen, setGuideOpen] = useState(false);
  const [navigation, setNavigation] = useState<PathNavigation>({ kind: "library" });
  const [catalogFilter, setCatalogFilter] = useState({ query: "", kind: "all", level: "all" });
  const [expandedActivity, setExpandedActivity] = useState<string>();
  const [active, setActive] = useState<{
    id: ActivityId;
    reference: CourseReference;
    origin: PathNavigation;
  }>();
  const [vocabularyAdded, setVocabularyAdded] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [launchOrigin, setLaunchOrigin] = useState<string>();
  const [changingSituation, setChangingSituation] = useState(false);
  const [changedUnit, setChangedUnit] = useState<string>();
  const languageSwitchBlocked = Boolean(active || busy || generation.busy || changingSituation);
  useEffect(() => {
    onLanguageSwitchBlockedChange?.(languageSwitchBlocked);
    return () => onLanguageSwitchBlockedChange?.(false);
  }, [languageSwitchBlocked, onLanguageSwitchBlockedChange]);
  const [error, setError] = useState<CallNinaError>();
  const navigationPositions = useRef(
    new Map<string, { scroll: number; focus: string | undefined }>(),
  );
  const pending = useRef(false);
  const alive = useRef(true);
  const returnPosition = useRef<{ scroll: number; focus: string | undefined } | undefined>(
    undefined,
  );
  const reviewPosition = useRef<{ scroll: number; focus: string | undefined } | undefined>(
    undefined,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const isAlive = () => alive.current;
  const { course, state } = snapshot;
  const locale =
    snapshot.learningContext.explanationLanguage === "en-US"
      ? "en"
      : snapshot.learningContext.explanationLanguage;
  const destination = navigation.kind === "review" ? navigation.origin : navigation;
  const stage = destination.kind === "library" ? state.selectedStage : destination.stage;
  const selected = course?.units.find((unit) =>
    destination.kind === "lesson"
      ? unit.id === destination.unitId
      : destination.kind === "trail" && unit.id === destination.selectedUnit,
  );
  const capturePosition = () => ({
    scroll: window.scrollY,
    focus: document.activeElement?.getAttribute("data-path-focus") ?? undefined,
  });
  const restorePosition = (position: { scroll: number; focus: string | undefined } | undefined) => {
    window.requestAnimationFrame(() => {
      if (!isAlive() || !position) return;
      window.scrollTo(0, position.scroll);
      if (position.focus)
        document
          .querySelector<HTMLElement>(`[data-path-focus="${CSS.escape(position.focus)}"]`)
          ?.focus({ preventScroll: true });
    });
  };
  const navigationKey = (value: PathNavigation): string => {
    if (value.kind === "library") return "library";
    if (value.kind === "review") return `review:${navigationKey(value.origin)}`;
    return value.kind === "trail" ? `trail:${value.stage}` : `lesson:${value.unitId}`;
  };
  const navigate = (next: PathNavigation, returning = false) => {
    if (!active) navigationPositions.current.set(navigationKey(navigation), capturePosition());
    setNavigation(next);
    if (returning) restorePosition(navigationPositions.current.get(navigationKey(next)));
  };
  const openLesson = (unit: CourseUnit) => {
    if (!course) return;
    setActive(undefined);
    navigate({ kind: "lesson", stage: unit.stage, unitId: unit.id });
    setExpandedActivity((nextLessonActivity(course, state, unit) ?? unit.activities[0])?.id);
    setVocabularyAdded(undefined);
    setChangedUnit(undefined);
    setError(undefined);
  };
  const mutate = async (
    ref: CourseReference,
    action: "select" | "complete-explanation" | "skip" | "reopen" | "new-mission",
  ) => {
    if (pending.current) return;
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
      if (!isAlive()) return;
      const fresh = await refresh();
      if (!isAlive()) return;
      if (action === "new-mission") setChangedUnit(ref.unitId);
      if (fresh?.course && ["complete-explanation", "skip"].includes(action)) {
        const unit = fresh.course.units.find((unit) => unit.id === ref.unitId);
        if (unit) setExpandedActivity(nextLessonActivity(fresh.course, fresh.state, unit)?.id);
      }
    } catch (cause) {
      if (isAlive()) setError(normalizeDesktopError(cause).detail);
    } finally {
      pending.current = false;
      if (isAlive()) {
        setBusy(false);
        setChangingSituation(false);
      }
    }
  };
  const launch = async (ref: CourseReference, origin: string, fresh = snapshot) => {
    if (
      !fresh.course ||
      pending.current ||
      fresh.rootGeneration !== snapshot.rootGeneration ||
      fresh.learningContext.targetLanguage !== snapshot.learningContext.targetLanguage
    )
      return;
    const { unit, activity } = resolveCourseReference(fresh.course, ref);
    const launchDestination: PathNavigation =
      ref.mode === "course" ? { kind: "lesson", stage: unit.stage, unitId: unit.id } : navigation;
    if (activity.delivery === "explanation") {
      setActive(undefined);
      setNavigation(launchDestination);
      setExpandedActivity(activity.id);
      window.requestAnimationFrame(() => {
        if (!isAlive()) return;
        const summary = document.querySelector<HTMLElement>(
          `[data-path-activity="${CSS.escape(activity.id)}"]`,
        );
        summary?.focus();
        summary?.scrollIntoView({ block: "nearest" });
      });
      await mutate(ref, "select");
      return;
    }
    const mission = fresh.state.missions.find(
      (m) => m.version === ref.version && m.unitId === ref.unitId && m.mode === "course",
    );
    const saved = fresh.state.activities.find(
      (a) =>
        sameCourseActivity(a.reference, ref) &&
        !a.completed &&
        (ref.mode === "review" || a.missionId === mission?.id),
    );
    const position = active ? returnPosition.current : capturePosition();
    pending.current = true;
    setBusy(true);
    setLaunchOrigin(origin);
    setError(undefined);
    try {
      let id = saved?.activityId;
      if (!id) {
        if (activity.delivery !== "listening" && activity.delivery !== "speaking") {
          if (!(await requestAiAccess("exercise-generation")) || !isAlive()) return;
        }
        if (activity.delivery === "listening" || activity.delivery === "speaking") {
          const result = await invokeDesktop("learning-path/prepare-voice", {
            expectedGeneration: fresh.rootGeneration,
            reference: ref,
          });
          id = result.activityId;
        } else {
          id = await generatePracticeActivity(
            { source: "learning-path", expectedGeneration: fresh.rootGeneration, reference: ref },
            generation.run,
          );
        }
      }
      if (!isAlive()) return;
      if (ref.mode === "course") {
        await invokeDesktop("learning-path/update", {
          expectedGeneration: fresh.rootGeneration,
          reference: ref,
          action: "select",
        });
        if (!isAlive()) return;
      }
      returnPosition.current = position;
      setActive({ id, reference: ref, origin: launchDestination });
      if (ref.mode === "course") {
        setNavigation(launchDestination);
        setExpandedActivity(activity.id);
      }
    } catch (cause) {
      if (isAlive()) setError(normalizeDesktopError(cause).detail);
    } finally {
      pending.current = false;
      if (isAlive()) {
        setBusy(false);
        setLaunchOrigin(undefined);
      }
    }
  };
  const launchFeedback = (origin: string) =>
    launchOrigin === origin ? (
      <div className={styles.launchProgress}>
        {generation.progress ? (
          <>
            <ProviderActionSummary operation="exercise-generation" busy={generation.busy} />
            <OperationProgress progress={generation.progress} onCancel={generation.cancel} />
          </>
        ) : (
          <p role="status">{t("learningPath.preparing")}</p>
        )}
      </div>
    ) : null;
  const closeActivity = () => {
    if (pending.current) return;
    if (active) setNavigation(active.origin);
    setActive(undefined);
    setError(undefined);
    void refresh();
    restorePosition(returnPosition.current);
  };
  const returnFromReview = () => {
    if (navigation.kind !== "review") return;
    setNavigation(navigation.origin);
    restorePosition(reviewPosition.current);
  };
  const onTrail = () => {
    if (pending.current) return;
    setActive(undefined);
    navigate({ kind: "trail", stage, ...(selected ? { selectedUnit: selected.id } : {}) }, true);
  };
  const addVocabulary = (unit: CourseUnit) => {
    if (pending.current || !course) return;
    pending.current = true;
    setBusy(true);
    setVocabularyAdded(undefined);
    setError(undefined);
    void invokeDesktop("learning-path/vocabulary", {
      expectedGeneration: snapshot.rootGeneration,
      reference: courseReference(course, unit, unit.activities[0]),
    })
      .then((result) => {
        if (isAlive()) setVocabularyAdded(result.added);
      })
      .catch((cause: unknown) => {
        if (isAlive()) setError(normalizeDesktopError(cause).detail);
      })
      .finally(() => {
        pending.current = false;
        if (isAlive()) setBusy(false);
      });
  };
  const activeUnit = course?.units.find((unit) => unit.id === active?.reference.unitId);
  const activeActivity = activeUnit?.activities.find(
    (item) => item.id === active?.reference.activityKey,
  );
  const activePath = course?.paths.find((path) => path.id === activeUnit?.stage);
  const player = active ? (
    <div className={styles.page}>
      {error && <OperationError error={error} />}
      {launchOrigin && launchFeedback(launchOrigin)}
      <ActivityHeaderActionsContext.Provider
        value={
          <Button
            variant="secondary"
            leadingIcon={<BookOpen aria-hidden="true" />}
            onPress={() => setGuideOpen(true)}
          >
            {t("lessonStudio.resources")}
          </Button>
        }
      >
        <PracticePage
          key={active.id}
          activityId={active.id}
          activityTitle={activeActivity?.title[locale]}
          activityBreadcrumbs={[
            {
              label: t("pathLibrary.title"),
              onPress: () => {
                if (pending.current) return;
                setActive(undefined);
                navigate({ kind: "library" }, true);
              },
            },
            ...(active.origin.kind === "review"
              ? [{ label: t("ui.review"), onPress: closeActivity }]
              : [
                  ...(activePath ? [{ label: activePath.title[locale], onPress: onTrail }] : []),
                  ...(activeUnit
                    ? [{ label: activeUnit.title[locale], onPress: closeActivity }]
                    : []),
                ]),
          ]}
          parentLabel={
            active.origin.kind === "review"
              ? t("ui.review")
              : (course?.units.find((unit) => unit.id === active.reference.unitId)?.title[locale] ??
                t("pathLibrary.title"))
          }
          onResults={() => {
            onOpenResults();
          }}
          onNina={onNina}
          requestAiAccess={requestAiAccess}
          onOpenActivity={(id) => {
            setActive((current) => (current ? { ...current, id } : undefined));
          }}
          onCloseActivity={closeActivity}
          courseCompletionActions={
            <LearningPathCompletion
              key={active.id}
              activityId={active.id}
              reference={active.reference}
              rootGeneration={snapshot.rootGeneration}
              busy={busy}
              origin={active.origin}
              onLaunch={(ref, fresh) => launch(ref, "completion-next", fresh)}
              onLesson={openLesson}
              onReturn={closeActivity}
              onTrail={onTrail}
              onLeaveReview={() => {
                setActive(undefined);
                if (navigation.kind === "review") returnFromReview();
              }}
            />
          }
        />
      </ActivityHeaderActionsContext.Provider>
    </div>
  ) : null;

  const returnLabel =
    destination.kind === "lesson"
      ? t("pathFlow.backLesson")
      : destination.kind === "trail"
        ? t("pathFlow.backTrail")
        : t("pathLibrary.allPaths");
  const reviewStage = destination.kind === "library" ? undefined : stage;
  const dueCount = course
    ? dueCourseReviews(course, state).filter(
        (item) =>
          !reviewStage ||
          course.units.some(
            (unit) => unit.id === item.reference.unitId && unit.stage === reviewStage,
          ),
      ).length
    : 0;
  const title =
    navigation.kind === "review"
      ? t("ui.review")
      : navigation.kind === "library"
        ? t("pathLibrary.title")
        : navigation.kind === "lesson" && selected
          ? selected.title[locale]
          : (course?.paths.find((path) => path.id === stage)?.title[locale] ?? stage);
  const displayedError = error ?? readError;
  return (
    <>
      {player}
      {active && activeUnit && (
        <ModalDialog
          isOpen={guideOpen}
          onOpenChange={setGuideOpen}
          size="large"
          title={t("lessonStudio.resources")}
          closeLabel={t("actions.close")}
        >
          {displayedError && <OperationError error={displayedError} />}
          <LessonGuide
            snapshot={snapshot}
            selected={activeUnit}
            busy={busy}
            scenarioLocked
            changingSituation={changingSituation}
            situationChanged={changedUnit === activeUnit.id}
            vocabularyAdded={vocabularyAdded}
            onAddVocabulary={() => addVocabulary(activeUnit)}
            onChangeSituation={() => {}}
          />
        </ModalDialog>
      )}
      <div hidden={!!active}>
        <Page
          title={title}
          description={
            navigation.kind === "library"
              ? t("pathFlow.libraryHint")
              : navigation.kind === "review"
                ? t("pathFlow.reviewHint")
                : navigation.kind === "lesson"
                  ? ""
                  : (course?.paths.find((path) => path.id === stage)?.description[locale] ?? "")
          }
          {...(navigation.kind !== "library"
            ? {
                breadcrumbs: [
                  {
                    label: t("pathLibrary.title"),
                    onPress: () => {
                      if (!busy) navigate({ kind: "library" }, true);
                    },
                  },
                  ...(navigation.kind === "lesson"
                    ? [
                        {
                          label:
                            course?.paths.find((path) => path.id === stage)?.title[locale] ?? stage,
                          onPress: onTrail,
                        },
                      ]
                    : []),
                ],
              }
            : {})}
          refresh={{ onRefresh: refresh, disabled: busy }}
        >
          {displayedError && <OperationError error={displayedError} />}
          {!course && <Feedback live="off">{t("learningPath.courseUnavailable")}</Feedback>}
          {busy && !launchOrigin && (
            <Feedback live="polite">{t("learningPath.preparing")}</Feedback>
          )}
          {course && (navigation.kind === "library" || navigation.kind === "trail") && (
            <LearningPathCatalog
              filter={catalogFilter}
              onFilter={setCatalogFilter}
              course={course}
              state={state}
              locale={locale}
              view={navigation.kind}
              stage={stage}
              selectedUnit={selected?.id}
              busy={busy}
              onStage={(value) => {
                navigate({ kind: "trail", stage: value });
              }}
              onSelect={(id) => {
                setNavigation({ kind: "trail", stage, selectedUnit: id });
              }}
              onOpen={openLesson}
              reviewCount={dueCount}
              onReview={() => {
                reviewPosition.current = capturePosition();
                setNavigation({ kind: "review", origin: navigation });
              }}
            />
          )}
          {course && navigation.kind === "lesson" && selected && (
            <LearningPathLesson
              snapshot={snapshot}
              selected={selected}
              expandedActivity={expandedActivity}
              setExpandedActivity={setExpandedActivity}
              busy={busy}
              launchOrigin={launchOrigin}
              launch={launch}
              launchFeedback={launchFeedback}
              mutate={mutate}
              onOpenResults={onOpenResults}
              openLesson={openLesson}
              onTrail={onTrail}
              vocabularyAdded={vocabularyAdded}
              changingSituation={changingSituation}
              situationChanged={changedUnit === selected.id}
              onAddVocabulary={() => addVocabulary(selected)}
            />
          )}
          {navigation.kind === "review" && (
            <LearningPathReview
              snapshot={snapshot}
              stage={reviewStage}
              busy={busy}
              launchOrigin={launchOrigin}
              launch={launch}
              launchFeedback={launchFeedback}
              onReturn={() => {
                if (destination.kind === "library" && course) {
                  const next = nextPathActivity(course, state);
                  if (next) {
                    openLesson(resolveCourseReference(course, next).unit);
                    return;
                  }
                }
                returnFromReview();
              }}
              returnLabel={
                destination.kind === "library" && course && nextPathActivity(course, state)
                  ? t("pathFlow.continueLearning")
                  : returnLabel
              }
            />
          )}
        </Page>
      </div>
    </>
  );
}
