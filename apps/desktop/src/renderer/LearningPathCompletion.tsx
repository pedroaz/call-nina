import type {
  ActivityId,
  CourseReference,
  CourseUnit,
  DataRootGeneration,
} from "@call-nina/contracts";
import { dueCourseReviews, sameCourseActivity } from "@call-nina/domain";
import { useTranslation } from "react-i18next";
import { Button, LoadingState } from "./components/ui/index.js";
import { ActionGroup, Section } from "./components/layout/index.js";
import { OperationError } from "./Startup.js";
import { useLearningPath, type LearningPathSnapshot } from "./useLearningPath.js";
import {
  courseReference,
  lessonCounts,
  nextLessonActivity,
  type PathNavigation,
} from "./learningPathNavigation.js";

/** Mounted by the player after saving, or by the voice workspace while awaiting a saved result. */
export function LearningPathCompletion({
  activityId,
  reference,
  rootGeneration,
  origin,
  busy,
  onLaunch,
  onLesson,
  onReturn,
  onTrail,
  onLeaveReview,
}: {
  activityId: ActivityId;
  reference: CourseReference;
  rootGeneration: DataRootGeneration;
  origin: PathNavigation;
  busy: boolean;
  onLaunch: (ref: CourseReference, snapshot: LearningPathSnapshot) => Promise<void>;
  onLesson: (unit: CourseUnit) => void;
  onReturn: () => void;
  onTrail: () => void;
  onLeaveReview: () => void;
}) {
  const { t } = useTranslation();
  const learning = useLearningPath();
  const snapshot = learning.snapshot;
  if (learning.error)
    return (
      <Section>
        <OperationError error={learning.error} />
        <Button
          variant="secondary"
          isPending={learning.busy}
          onPress={() => void learning.refresh()}
        >
          {t("actions.retry")}
        </Button>
        <Button variant="secondary" onPress={onReturn}>
          {t(origin.kind === "review" ? "ui.review" : "pathFlow.backLesson")}
        </Button>
      </Section>
    );
  if (!snapshot) return <LoadingState live>{t("learningPath.loading")}</LoadingState>;
  if (
    snapshot.rootGeneration !== rootGeneration ||
    !snapshot.course ||
    snapshot.course.version !== reference.version
  )
    return null;
  const { course, state } = snapshot;
  const completed = state.activities.some(
    (a) => a.activityId === activityId && sameCourseActivity(a.reference, reference) && a.completed,
  );
  if (!completed) return null;
  const unit = course.units.find((unit) => unit.id === reference.unitId);
  if (!unit) return null;
  const next = nextLessonActivity(course, state, unit);
  const following = course.units.find(
    (item, index) =>
      index > course.units.findIndex((item) => item.id === unit.id) && item.stage === unit.stage,
  );
  const destination = origin.kind === "review" ? origin.origin : origin;
  const reviewStage = destination.kind === "library" ? undefined : destination.stage;
  const nextReview = dueCourseReviews(course, state).find(
    (item) =>
      !sameCourseActivity(item.reference, reference) &&
      (!reviewStage ||
        course.units.some(
          (unit) => unit.id === item.reference.unitId && unit.stage === reviewStage,
        )),
  );
  const isReview = reference.mode === "review";
  const backLabel = isReview
    ? destination.kind === "lesson"
      ? "pathFlow.backLesson"
      : destination.kind === "trail"
        ? "pathFlow.backTrail"
        : "pathLibrary.allPaths"
    : "pathFlow.backLesson";
  return (
    <Section>
      <h2>
        {t(
          isReview
            ? "pathFlow.reviewFinished"
            : next
              ? "pathFlow.activityFinished"
              : lessonCounts(course, state, unit).skipped
                ? "pathFlow.skippedRemaining"
                : "pathLibrary.lessonFinished",
        )}
      </h2>
      {!isReview && <p>{t("learningPath.counts", lessonCounts(course, state, unit))}</p>}
      <ActionGroup>
        {isReview ? (
          nextReview && (
            <Button
              variant="primary"
              isDisabled={busy}
              onPress={() => void onLaunch(nextReview.reference, snapshot)}
            >
              {t("pathFlow.continueReview")}
            </Button>
          )
        ) : next ? (
          <Button
            variant="primary"
            isDisabled={busy}
            onPress={() => void onLaunch(courseReference(course, unit, next), snapshot)}
          >
            {t("pathFlow.nextActivity")}
          </Button>
        ) : (
          <Button
            variant="primary"
            isDisabled={busy}
            onPress={() => {
              if (following) onLesson(following);
              else onTrail();
            }}
          >
            {t(
              following
                ? following.kind === "checkpoint"
                  ? "pathFlow.tryCheckpoint"
                  : "pathLibrary.nextLesson"
                : "pathFlow.backTrail",
            )}
          </Button>
        )}
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={isReview && origin.kind === "review" ? onLeaveReview : onReturn}
        >
          {t(backLabel)}
        </Button>
      </ActionGroup>
    </Section>
  );
}
