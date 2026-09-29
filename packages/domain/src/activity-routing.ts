import {
  preparedActivitySchema,
  type ActivityDestination,
  type DesktopIpcRequest,
  type CourseReference,
} from "@call-nina/contracts";

/** Deterministic routing for the workspaces the desktop currently implements. */
export function resolveActivityDestination(
  activityValue: unknown,
  hasGeneratedExercises: boolean,
): ActivityDestination {
  const activity = preparedActivitySchema.parse(activityValue);
  if (activity.activityType === "flashcards") return "flashcards";
  if (activity.context.voiceContext) return "prepared";
  return hasGeneratedExercises ? "generated-exercises" : "prepared";
}

/** Reject unsupported source/type combinations before dispatching a provider workload. */
export function assertExerciseGenerationContext(
  input: Extract<
    Extract<DesktopIpcRequest, { channel: "learning-operation/start" }>["payload"]["input"],
    { kind: "exercise-generation" }
  >,
) {
  const { context, request } = input;
  if (request.source === "learning-path") {
    if (
      context.origin !== "learning-path" ||
      !sameExerciseCourse(context.reference, request.reference)
    )
      throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
  } else if (context.origin === "learning-path") {
    throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
  }
  if (
    context.origin === "materials" &&
    request.source !== "saved-material" &&
    request.source !== "reading"
  )
    throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
}

export function sameExerciseCourse(left: CourseReference, right: CourseReference) {
  return (
    left.version === right.version &&
    left.unitId === right.unitId &&
    left.activityKey === right.activityKey &&
    left.mode === right.mode &&
    left.retrieval === right.retrieval
  );
}

export function assertSharedExerciseActivity(activityValue: unknown) {
  const activity = preparedActivitySchema.parse(activityValue);
  if (
    !["grammar", "custom-lesson", "reading", "writing", "vocabulary-review", "placement"].includes(
      activity.activityType,
    ) ||
    activity.context.voiceContext
  )
    throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
  return activity;
}
