import {
  type PracticeSource,
  activityIdSchema,
  type DesktopIpcRequest,
  type ExerciseEntryContext,
} from "@call-nina/contracts";
import { createDesktopSubmissionId, invokeDesktop } from "../../runtime/ipc.js";
import { type useLearningOperation } from "../operations/useLearningOperation.js";

export type PracticeGenerationRequest = Extract<
  Extract<DesktopIpcRequest, { channel: "learning-operation/start" }>["payload"]["input"],
  { kind: "exercise-generation" }
>["request"];

export async function generatePracticeActivity(
  request: PracticeGenerationRequest,
  run: ReturnType<typeof useLearningOperation>["run"],
  context: ExerciseEntryContext = request.source === "learning-path"
    ? { origin: "learning-path", reference: request.reference }
    : request.source === "saved-material"
      ? { origin: "materials" }
      : { origin: "free-practice" },
  practiceSource?: PracticeSource,
) {
  const result = await run({
    kind: "exercise-generation",
    request,
    context,
    ...(practiceSource ? { practiceSource } : {}),
  });
  return activityIdSchema.parse(result.activityId);
}

/** Pass a retained launchId when retrying a reuse request after a transport failure. */
export async function reusePracticeActivity(
  input: Omit<
    Extract<DesktopIpcRequest, { channel: "activity/reuse" }>["payload"],
    "action" | "launchId"
  >,
  launchId = createDesktopSubmissionId(),
) {
  return (
    await invokeDesktop("activity/reuse", {
      ...input,
      content: { contentId: input.content.contentId, revisionId: input.content.revisionId },
      action: "reuse-exercises",
      launchId,
    })
  ).activityId;
}
