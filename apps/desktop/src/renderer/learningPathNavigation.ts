import type {
  CourseActivity,
  CourseReference,
  CourseUnit,
  LearningCourse,
  LearningPathState,
} from "@call-nina/contracts";
import { courseActivityStatus, nextCourseActivity } from "@call-nina/domain";

export type PathDestination =
  | { kind: "library" }
  | { kind: "trail"; stage: string; selectedUnit?: string }
  | { kind: "lesson"; stage: string; unitId: string };
export type PathNavigation =
  | PathDestination
  | {
      kind: "review";
      origin: PathDestination;
    };

export function courseReference(
  course: LearningCourse,
  unit: CourseUnit,
  activity: CourseActivity | undefined,
  mode: CourseReference["mode"] = "course",
): CourseReference {
  if (!activity) throw new Error("OD_COURSE_REFERENCE_INVALID");
  return { version: course.version, unitId: unit.id, activityKey: activity.id, mode };
}
export function lessonCounts(course: LearningCourse, state: LearningPathState, unit: CourseUnit) {
  const statuses = unit.activities.map((activity) =>
    courseActivityStatus(state, courseReference(course, unit, activity)),
  );
  return {
    completed: statuses.filter((s) => s === "completed").length,
    skipped: statuses.filter((s) => s === "skipped").length,
    started: statuses.filter((s) => s === "started").length,
    total: statuses.length,
  };
}
export function nextLessonActivity(
  course: LearningCourse,
  state: LearningPathState,
  unit: CourseUnit,
) {
  const available = (activity: CourseActivity) =>
    !["completed", "skipped"].includes(
      courseActivityStatus(state, courseReference(course, unit, activity)),
    );
  return (
    unit.activities.find(
      (activity) =>
        state.current?.unitId === unit.id &&
        state.current.activityKey === activity.id &&
        available(activity),
    ) ?? unit.activities.find(available)
  );
}
export function nextPathActivity(course: LearningCourse, state: LearningPathState) {
  const current = nextCourseActivity(course, state);
  if (current) return current;
  for (const unit of course.units.filter((unit) => unit.kind !== "launchpad")) {
    const activity = nextLessonActivity(course, state, unit);
    if (activity) return courseReference(course, unit, activity);
  }
  return null;
}
export function lessonStateKey(course: LearningCourse, state: LearningPathState, unit: CourseUnit) {
  const counts = lessonCounts(course, state, unit);
  if (counts.completed === counts.total) return "learningPath.status.completed";
  if (counts.skipped) return "pathFlow.skippedRemaining";
  return counts.started || counts.completed
    ? "pathFlow.inProgress"
    : "learningPath.status.not-started";
}
export function lessonActionKey(
  course: LearningCourse,
  state: LearningPathState,
  unit: CourseUnit,
) {
  const counts = lessonCounts(course, state, unit);
  return counts.completed === counts.total
    ? "pathLibrary.revisitLesson"
    : counts.completed || counts.started || counts.skipped
      ? "pathLibrary.continueLesson"
      : "pathFlow.startLesson";
}
