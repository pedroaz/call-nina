import { activityIdSchema, dataRootGenerationSchema } from "../common.js";
import {
  courseReferenceSchema,
  learningPathSnapshotSchema,
  learningPathUpdateSchema,
} from "../learning-path.js";
import { z } from "../schema-system.js";
import { storySnapshotSchema, storyUpdateSchema, storyVocabularySchema } from "../stories.js";
import { emptyPayload, request, response } from "./envelope.js";

export const learningPathReadRequest = request("learning-path/read", emptyPayload);

export const learningPathUpdateRequest = request("learning-path/update", learningPathUpdateSchema);

export const learningPathVocabularyRequest = request(
  "learning-path/vocabulary",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    reference: courseReferenceSchema,
  }),
);

export const learningPathPrepareVoiceRequest = request(
  "learning-path/prepare-voice",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    reference: courseReferenceSchema,
  }),
);

export const learningPathReadResponse = response("learning-path/read", learningPathSnapshotSchema);

export const learningPathUpdateResponse = response(
  "learning-path/update",
  learningPathSnapshotSchema,
);

export const learningPathVocabularyResponse = response(
  "learning-path/vocabulary",
  z.strictObject({ added: z.int().nonnegative() }),
);

export const learningPathPrepareVoiceResponse = response(
  "learning-path/prepare-voice",
  z.strictObject({ activityId: activityIdSchema }),
);

export const curriculumRequests = [
  request("stories/read", emptyPayload),
  request("stories/position", storyUpdateSchema),
  request("stories/vocabulary", storyVocabularySchema),
  learningPathReadRequest,
  learningPathUpdateRequest,
  learningPathVocabularyRequest,
  learningPathPrepareVoiceRequest,
] as const;

export const curriculumResponses = [
  response("stories/read", storySnapshotSchema),
  response("stories/position", z.strictObject({ saved: z.literal(true) })),
  response("stories/vocabulary", z.strictObject({ added: z.boolean() })),
  learningPathReadResponse,
  learningPathUpdateResponse,
  learningPathVocabularyResponse,
  learningPathPrepareVoiceResponse,
] as const;
