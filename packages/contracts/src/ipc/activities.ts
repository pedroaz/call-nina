import { activityDestinationSchema, openActivityActionSchema } from "../activity-action.js";
import {
  activityLibraryCursorSchema,
  activityLibraryFilterSchema,
  activityLibraryItemSchema,
  preparedActivitySchema,
} from "../activity.js";
import {
  activityIdSchema,
  attemptIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  modelRequestIdSchema,
  utcInstantSchema,
} from "../common.js";
import { portableExerciseContentSchema } from "../content.js";
import { reuseExerciseActionSchema } from "../exercise-launch.js";
import { generationProvenanceSchema } from "../generation-provenance.js";
import { generationCandidateOutputSchemas } from "../generation.js";
import { learningScopeSchema } from "../learning-context.js";
import { z } from "../schema-system.js";
import { voiceActivityContextSchema } from "../voice.js";
import { generatedActivityProvenanceSchema, request, response, text } from "./envelope.js";
import { exerciseSessionAnswerSchema } from "./exercises.js";

export const codexActivityPrepareRequest = request(
  "codex-activity/prepare",
  z.strictObject({
    draftModelRequestId: modelRequestIdSchema,
    title: text(160),
    context: voiceActivityContextSchema,
  }),
);

export const activityListRequest = request("activity/list", activityLibraryFilterSchema);

export const activityReuseRequest = request("activity/reuse", reuseExerciseActionSchema);

export const activityResolveRequest = request("activity/resolve", openActivityActionSchema);

export const preparedActivityReadRequest = request(
  "prepared-activity/read",
  z.strictObject({ activityId: activityIdSchema }),
);

export const voiceActivityReadRequest = request(
  "voice-activity/read",
  z.strictObject({ activityId: activityIdSchema }),
);

export const voiceActivityOpenInCodexRequest = request(
  "voice-activity/open-in-codex",
  z.strictObject({ activityId: activityIdSchema }),
);

export const preparedActivityDeleteRequest = request(
  "prepared-activity/delete",
  z.strictObject({ activityId: activityIdSchema }),
);

export const codexActivityPrepareResponse = response(
  "codex-activity/prepare",
  z.strictObject({
    status: z.literal("prepared"),
    activityId: activityIdSchema,
  }),
);

export const activityListResponse = response(
  "activity/list",
  z.strictObject({
    learningScope: learningScopeSchema,
    rootGeneration: dataRootGenerationSchema,
    entries: z.array(activityLibraryItemSchema).max(50),
    nextCursor: activityLibraryCursorSchema.nullable(),
  }),
);

export const activityResolveResponse = response(
  "activity/resolve",
  z.strictObject({
    activity: preparedActivitySchema,
    rootGeneration: dataRootGenerationSchema,
    destination: activityDestinationSchema,
    deletionStatus: z.enum(["available", "cascade", "retained-data"]),
  }),
);

export const activityReuseResponse = response(
  "activity/reuse",
  z.strictObject({ activityId: activityIdSchema }),
);

export const preparedActivityReadResponse = response(
  "prepared-activity/read",
  z.strictObject({
    learningScope: learningScopeSchema,
    activityId: activityIdSchema,
    title: text(160),
    curriculumTopicIds: z.array(curriculumTopicIdSchema).max(20),
    deletionStatus: z.enum(["available", "cascade", "retained-data"]),
    activeSet: z
      .strictObject({
        startedAt: utcInstantSchema,
        attemptIds: z.array(attemptIdSchema).min(1).max(30),
        progress: z
          .array(
            z.strictObject({
              answer: exerciseSessionAnswerSchema.nullable(),
              feedback: generationCandidateOutputSchemas["exercise-feedback"].nullable(),
              feedbackProvenance: generationProvenanceSchema.nullable(),
              hintsUsed: z.int().nonnegative(),
            }),
          )
          .min(1)
          .max(30),
      })
      .nullable()
      .default(null),
    missionFacts: text(4000).optional(),
    provenance: generatedActivityProvenanceSchema,
    content: portableExerciseContentSchema,
  }),
);

export const voiceActivityReadResponse = response(
  "voice-activity/read",
  z.strictObject({
    activityId: activityIdSchema,
    title: text(160),
    originSurface: z.enum(["desktop", "codex"]),
    preparedAt: utcInstantSchema,
    deletionStatus: z.enum(["available", "cascade", "retained-data"]),
    context: voiceActivityContextSchema,
  }),
);

export const preparedActivityDeleteResponse = response(
  "prepared-activity/delete",
  z.strictObject({ activityId: activityIdSchema, status: z.literal("deleted") }),
);

export const voiceActivityOpenInCodexResponse = response(
  "voice-activity/open-in-codex",
  z.strictObject({ status: z.enum(["open-requested", "setup-required"]) }),
);

export const activitiesRequests = [
  codexActivityPrepareRequest,
  activityListRequest,
  activityResolveRequest,
  activityReuseRequest,
  preparedActivityReadRequest,
  voiceActivityReadRequest,
  voiceActivityOpenInCodexRequest,
  preparedActivityDeleteRequest,
] as const;

export const activitiesResponses = [
  codexActivityPrepareResponse,
  activityListResponse,
  activityResolveResponse,
  activityReuseResponse,
  preparedActivityReadResponse,
  voiceActivityReadResponse,
  voiceActivityOpenInCodexResponse,
  preparedActivityDeleteResponse,
] as const;
