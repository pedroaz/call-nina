import {
  activityIdSchema,
  attemptIdSchema,
  calendarDateSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  utcInstantSchema,
  vocabularyIdSchema,
} from "../common.js";
import {
  flashcardCreateRequestSchema,
  flashcardDeckSchema,
  flashcardProgressRequestSchema,
  flashcardReadRequestSchema,
  flashcardSaveRequestSchema,
} from "../flashcards.js";
import { targetLanguageSchema } from "../learning-context.js";
import { z } from "../schema-system.js";
import { uploadIdSchema } from "../uploads.js";
import { vocabularyExampleSchema, vocabularyLexemeSchema } from "../vocabulary-content.js";
import { vocabularyLearningSnapshotSchema } from "../vocabulary-learning.js";
import {
  vocabularyBulkRequestSchema,
  vocabularyCountsSchema,
  vocabularyLibraryFilterSchema,
  vocabularySummarySchema,
  vocabularyVersionSchema,
} from "../vocabulary-library.js";
import { request, response, text } from "./envelope.js";

export const vocabularyLearningReadRequest = request(
  "vocabulary/learning-read",
  z.strictObject({ activityId: activityIdSchema.optional() }),
);

export const vocabularyLearningUpdateRequest = request(
  "vocabulary/learning-update",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    action: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("read"), batchIds: z.array(text(100)).max(50) }),
      z.strictObject({ kind: z.literal("retry"), activityId: activityIdSchema }),
      z.strictObject({ kind: z.literal("undo"), batchId: text(100) }),
      z.strictObject({
        kind: z.literal("focus"),
        focusId: text(100),
        title: text(160),
        active: z.boolean(),
        text: z.string().max(12000),
      }),
    ]),
  }),
);

export const vocabularyReadRequest = request("vocabulary/read", vocabularyLibraryFilterSchema);

export const vocabularyDetailRequest = request(
  "vocabulary/detail",
  z.strictObject({ vocabularyId: vocabularyIdSchema, rootGeneration: dataRootGenerationSchema }),
);

export const vocabularyQueueRequest = request(
  "vocabulary/review-queue",
  z.strictObject({ rootGeneration: dataRootGenerationSchema, uploadId: uploadIdSchema.optional() }),
);

export const vocabularyBulkRequest = request("vocabulary/bulk", vocabularyBulkRequestSchema);

export const vocabularySetListRequest = request(
  "vocabulary-set/list",
  z.strictObject({ rootGeneration: dataRootGenerationSchema }),
);

export const vocabularySetCreateRequest = request(
  "vocabulary-set/create",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    title: text(160),
    naturalRequest: text(1_000),
    topic: text(160).optional(),
  }),
);

export const vocabularyConfirmRequest = request(
  "vocabulary/confirm",
  z.strictObject({ vocabularyId: vocabularyIdSchema, dueOn: calendarDateSchema }),
);

export const vocabularyReviewRequest = request(
  "vocabulary/review",
  vocabularyVersionSchema.extend({
    rootGeneration: dataRootGenerationSchema,
    grade: z.enum(["again", "hard", "good", "easy"]),
    retrieval: z.enum(["recognition", "recall", "use"]),
  }),
);

export const vocabularyEditRequest = request(
  "vocabulary/edit",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    vocabularyId: vocabularyIdSchema,
    expectedRevision: z.int().nonnegative(),
    expectedUpdatedAt: utcInstantSchema,
    lemma: text(160),
    meaning: text(500),
    example: text(500),
    exampleMeaning: text(500),
  }),
);

export const vocabularySuspendRequest = request(
  "vocabulary/suspend",
  z.strictObject({
    vocabularyId: vocabularyIdSchema,
    expectedRevision: z.int().nonnegative(),
    reason: z.enum(["learner-paused", "duplicate", "not-useful", "other"]),
  }),
);

export const vocabularyResumeRequest = request(
  "vocabulary/resume",
  z.strictObject({ vocabularyId: vocabularyIdSchema, expectedRevision: z.int().nonnegative() }),
);

export const vocabularyDeleteRequest = request(
  "vocabulary/delete",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    vocabularyId: vocabularyIdSchema,
  }),
);

export const vocabularyProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  vocabularyId: vocabularyIdSchema,
  lemma: text(160),
  meaning: text(500),
  targetLanguage: targetLanguageSchema,
  lexeme: vocabularyLexemeSchema,
  examples: z.array(vocabularyExampleSchema).min(1).max(12),
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("correction"),
      correctionId: correctionIdSchema,
      attemptId: attemptIdSchema,
      context: text(500),
    }),
    z.strictObject({
      kind: z.literal("activity"),
      activityId: activityIdSchema,
      context: text(500),
    }),
    z.strictObject({
      kind: z.literal("curriculum"),
      curriculumTopicId: curriculumTopicIdSchema,
      context: text(500),
    }),
    z.strictObject({ kind: z.literal("learner"), context: text(500) }),
  ]),
  state: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("candidate"), confirmation: z.literal("required") }),
    z.strictObject({
      status: z.literal("active"),
      confirmedAt: utcInstantSchema,
      dueOn: calendarDateSchema,
      stage: z.int().min(1).max(5),
      lastReview: z
        .strictObject({
          reviewedAt: utcInstantSchema,
          grade: z.enum(["again", "hard", "good", "easy"]),
        })
        .nullable(),
    }),
    z.strictObject({
      status: z.literal("suspended"),
      confirmedAt: utcInstantSchema,
      dueOn: calendarDateSchema,
      stage: z.int().min(1).max(5),
      suspendedAt: utcInstantSchema,
      reason: z.enum(["learner-paused", "duplicate", "not-useful", "other"]),
      lastReview: z
        .strictObject({
          reviewedAt: utcInstantSchema,
          grade: z.enum(["again", "hard", "good", "easy"]),
        })
        .nullable(),
    }),
  ]),
  revision: z.int().nonnegative(),
  updatedAt: utcInstantSchema,
});

export const vocabularyLearningReadResponse = response(
  "vocabulary/learning-read",
  vocabularyLearningSnapshotSchema,
);

export const vocabularyLearningUpdateResponse = response(
  "vocabulary/learning-update",
  vocabularyLearningSnapshotSchema,
);

export const vocabularyReadResponse = response(
  "vocabulary/read",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    entries: z.array(vocabularySummarySchema).max(30),
    total: z.int().nonnegative(),
    page: z.int().nonnegative(),
    counts: vocabularyCountsSchema,
  }),
);

export const vocabularyDetailResponse = response(
  "vocabulary/detail",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    entry: vocabularyProjectionSchema,
  }),
);

export const vocabularyQueueResponse = response(
  "vocabulary/review-queue",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    entries: z
      .array(
        vocabularyProjectionSchema.extend({
          retrievalSchedules: z
            .array(
              z.strictObject({
                retrieval: z.enum(["recognition", "recall", "use"]),
                dueOn: calendarDateSchema,
              }),
            )
            .length(3),
        }),
      )
      .max(20),
  }),
);

export const vocabularyBulkResponse = response(
  "vocabulary/bulk",
  z.strictObject({ status: z.literal("updated") }),
);

export const vocabularySetListResponse = response(
  "vocabulary-set/list",
  z.strictObject({
    entries: z
      .array(
        z.strictObject({
          setId: activityIdSchema,
          title: text(160),
          candidateCount: z.int().nonnegative().max(50),
        }),
      )
      .max(50),
  }),
);

export const vocabularySetCreateResponse = response(
  "vocabulary-set/create",
  z.strictObject({
    setId: activityIdSchema,
    status: z.literal("created"),
    candidateCount: z.int().min(1).max(50),
  }),
);

export const vocabularyMutationResponse = <
  const Channel extends
    | "vocabulary/confirm"
    | "vocabulary/edit"
    | "vocabulary/suspend"
    | "vocabulary/resume"
    | "vocabulary/delete",
>(
  channel: Channel,
) =>
  response(
    channel,
    z.strictObject({ vocabularyId: vocabularyIdSchema, status: z.literal("updated") }),
  );

export const vocabularyConfirmResponse = vocabularyMutationResponse("vocabulary/confirm");

export const vocabularyReviewResponse = response(
  "vocabulary/review",
  z.strictObject({
    vocabularyId: vocabularyIdSchema,
    status: z.literal("updated"),
    dueOn: calendarDateSchema,
  }),
);

export const vocabularyEditResponse = vocabularyMutationResponse("vocabulary/edit");

export const vocabularySuspendResponse = vocabularyMutationResponse("vocabulary/suspend");

export const vocabularyResumeResponse = vocabularyMutationResponse("vocabulary/resume");

export const vocabularyDeleteResponse = vocabularyMutationResponse("vocabulary/delete");

export const vocabularyRequests = [
  request("flashcards/create", flashcardCreateRequestSchema),
  request("flashcards/read", flashcardReadRequestSchema),
  request("flashcards/progress", flashcardProgressRequestSchema),
  request("flashcards/save-vocabulary", flashcardSaveRequestSchema),
  vocabularyLearningReadRequest,
  vocabularyLearningUpdateRequest,
  vocabularyReadRequest,
  vocabularyDetailRequest,
  vocabularyQueueRequest,
  vocabularyBulkRequest,
  vocabularySetListRequest,
  vocabularySetCreateRequest,
  vocabularyConfirmRequest,
  vocabularyReviewRequest,
  vocabularyEditRequest,
  vocabularySuspendRequest,
  vocabularyResumeRequest,
  vocabularyDeleteRequest,
] as const;

export const vocabularyResponses = [
  response("flashcards/create", flashcardDeckSchema),
  response("flashcards/read", flashcardDeckSchema),
  response("flashcards/progress", flashcardDeckSchema),
  response("flashcards/save-vocabulary", flashcardDeckSchema),
  vocabularyLearningReadResponse,
  vocabularyLearningUpdateResponse,
  vocabularyReadResponse,
  vocabularyDetailResponse,
  vocabularyQueueResponse,
  vocabularyBulkResponse,
  vocabularySetListResponse,
  vocabularySetCreateResponse,
  vocabularyConfirmResponse,
  vocabularyReviewResponse,
  vocabularyEditResponse,
  vocabularySuspendResponse,
  vocabularyResumeResponse,
  vocabularyDeleteResponse,
] as const;
