import { preparedActivitySchema, type ActivityDestination } from "@call-nina/contracts";

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
