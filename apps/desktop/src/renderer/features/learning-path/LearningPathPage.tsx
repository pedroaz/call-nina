import { resolveCourseReference } from "@call-nina/domain";
import { useTranslation } from "react-i18next";
import { Page } from "../../components/layout/index.js";
import { Button, Feedback, LoadingState, ModalDialog } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { nextPathActivity } from "../../learning/curriculum/learningPathNavigation.js";
import { LessonGuide } from "../../learning/curriculum/LessonGuide.js";
import { useLearningPath } from "../../runtime/useLearningPath.js";
import { LearningPathCatalog } from "./LearningPathCatalog.js";
import { LearningPathLesson } from "./LearningPathLesson.js";
import { type LearningPathWorkspaceProps, type Props } from "./LearningPathPage.types.js";
import { LearningPathReview } from "./LearningPathReview.js";

import { useLearningPathWorkspaceController } from "./useLearningPathWorkspaceController.js";

export function LearningPathWorkspace(props: LearningPathWorkspaceProps) {
  const model = useLearningPathWorkspaceController(props);
  if (model.listeningPlayer) return model.listeningPlayer;
  const {
    player,
    active,
    activeUnit,
    guideOpen,
    setGuideOpen,
    t,
    error,
    readFailure,
    snapshot,
    busy,
    changingSituation,
    changedUnit,
    vocabularyAdded,
    addVocabulary,
    title,
    navigation,
    course,
    stage,
    locale,
    navigate,
    onTrail,
    launchOrigin,
    catalogFilter,
    setCatalogFilter,
    state,
    selected,
    setNavigation,
    openLesson,
    dueCount,
    reviewPositionRef,
    capturePosition,
    expandedActivity,
    setExpandedActivity,
    launch,
    launchFeedback,
    mutate,
    onOpenResults,
    reviewStage,
    destination,
    returnFromReview,
    returnLabel,
  } = model;
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
          {error && <OperationError error={error} />}
          {readFailure}
          <LessonGuide
            snapshot={snapshot}
            selected={activeUnit}
            busy={busy}
            scenarioLocked
            changingSituation={changingSituation}
            situationChanged={changedUnit === activeUnit.id}
            vocabularyAdded={vocabularyAdded}
            onAddVocabulary={() => {
              addVocabulary(activeUnit);
            }}
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
        >
          {error && <OperationError error={error} />}
          {readFailure}
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
                reviewPositionRef.current = capturePosition();
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
              onAddVocabulary={() => {
                addVocabulary(selected);
              }}
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
export function LearningPathPage(props: Props) {
  const learning = useLearningPath();
  const { t } = useTranslation();
  const snapshot = learning.snapshot;
  if (!snapshot)
    return (
      <Page title={t("pathLibrary.title")}>
        {learning.error ? (
          <OperationError error={learning.error}>
            <Button
              variant="secondary"
              isPending={learning.busy}
              onPress={() => void learning.refresh()}
            >
              {t("actions.retry")}
            </Button>
          </OperationError>
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
      reading={learning.busy}
    />
  );
}
