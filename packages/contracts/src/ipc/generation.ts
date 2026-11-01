import {
  activityIdSchema,
  attemptIdSchema,
  correlationIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  modelRequestIdSchema,
} from "../common.js";
import { exerciseEntryContextSchema } from "../exercise-launch.js";
import { generationProvenanceSchema } from "../generation-provenance.js";
import { generationCandidateOutputSchemas } from "../generation.js";
import { courseReferenceSchema } from "../learning-path.js";
import { materialReferenceSchema, materialSourceSchema } from "../material.js";
import { ninaGenerationRequestSchema } from "../nina.js";
import { practiceSuggestionSchema } from "../practice-suggestion.js";
import { z } from "../schema-system.js";
import {
  translationCancelSchema,
  translationReadSchema,
  translationRequestSchema,
  translationRevealSchema,
  translationStartSchema,
} from "../translation.js";
import { practiceSourceSchema, uploadImageInputSchema, uploadReferenceSchema } from "../uploads.js";
import { vocabularyImageSchema } from "../vocabulary-learning.js";
import { request, response, text } from "./envelope.js";

export const learningOperationKinds = [
  "vocabulary-analysis",
  "website-study-pack",
  "writing-prompt",
  "voice-activity-draft",
  "writing-correction",
  "contextual-help",
  "flashcard-generation",
  "exercise-generation",
  "exercise-feedback",
] as const;

export const learningOperationKindSchema = z.enum(learningOperationKinds);

export const learningOperationInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("website-study-pack"),
    rootGeneration: dataRootGenerationSchema,
    captureId: correlationIdSchema,
  }),
  z.strictObject({
    kind: z.literal("vocabulary-analysis"),
    rootGeneration: dataRootGenerationSchema,
    source: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("import"),
        guidance: z.string().max(2000),
        text: z.string().max(12000),
        image: vocabularyImageSchema.optional(),
      }),
      z.strictObject({ kind: z.literal("upload"), reference: uploadReferenceSchema }),
      z.strictObject({ kind: z.literal("preview"), image: uploadImageInputSchema }),
      z.strictObject({
        kind: z.literal("activity"),
        activityId: activityIdSchema,
        sourceKey: text(200).optional(),
      }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("flashcard-generation"),
    practiceSource: practiceSourceSchema.optional(),
    topic: text(2_000),
    cardCount: z.int().min(3).max(30),
    targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
  }),
  z.strictObject({
    kind: z.literal("writing-prompt"),
    practiceSource: practiceSourceSchema.optional(),
    naturalRequest: text(1_000).optional(),
  }),
  z.strictObject({
    kind: z.literal("voice-activity-draft"),
    practiceSource: practiceSourceSchema.optional(),
    voiceKind: z.enum(["listening", "speaking"]),
    naturalRequest: text(2_000),
    targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]),
    correctionTiming: z.enum(["during", "after-each", "end"]),
    speakingPace: z.enum(["slow", "normal", "fast"]).optional(),
  }),
  z.strictObject({
    kind: z.literal("writing-correction"),
    practiceSource: practiceSourceSchema.optional(),
    learnerText: text(12_000),
    activityGoal: text(1_000).optional(),
    teachingProfile: z
      .enum(["profile-default", "conversation-partner", "strict-corrector"])
      .optional(),
    feedbackCoverage: z.enum(["all-meaningful", "priority-only"]).optional(),
  }),
  z.strictObject({
    kind: z.literal("contextual-help"),
    sessionId: correlationIdSchema,
    intent: z.enum(["chat", "translate"]),
    selectedText: text(4_000),
    containingSentence: text(4_000),
    question: text(1_000),
    activeResultSummary: text(2_000).optional(),
  }),
  z.strictObject({
    kind: z.literal("exercise-generation"),
    practiceSource: practiceSourceSchema.optional(),
    context: exerciseEntryContextSchema,
    request: z.discriminatedUnion("source", [
      ninaGenerationRequestSchema,
      z.strictObject({
        source: z.literal("learning-path"),
        expectedGeneration: dataRootGenerationSchema,
        reference: courseReferenceSchema,
      }),
      z.strictObject({
        source: z.literal("suggestion"),
        suggestion: practiceSuggestionSchema,
      }),
      z.strictObject({
        source: z.literal("natural-request"),
        materialTitle: text(160).optional(),
        materialSource: materialSourceSchema.optional(),
        naturalRequest: text(2_000),
        exerciseCount: z.int().min(3).max(30).optional(),
        targetLevel: z.enum(["a1", "a2", "b1", "b2"]).optional(),
      }),
      z.strictObject({
        source: z.literal("grammar"),
        materialTitle: text(160).optional(),
        materialSource: materialSourceSchema.optional(),
        naturalRequest: text(2_000),
        exerciseCount: z.int().min(3).max(30).optional(),
        targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
      }),
      z.strictObject({
        source: z.literal("reading"),
        materialTitle: text(160).optional(),
        materialSource: materialSourceSchema.optional(),
        naturalRequest: text(2_000),
        passage: text(12_000).optional(),
        exerciseCount: z.int().min(3).max(30).optional(),
        targetLevel: z.enum(["a1", "a2", "b1", "b2"]).optional(),
      }),
      z.strictObject({
        source: z.literal("saved-material"),
        practiceType: z.enum(["reading", "vocabulary-review"]),
        expectedGeneration: dataRootGenerationSchema,
        material: materialReferenceSchema,
        exerciseCount: z.int().min(3).max(30).optional(),
        targetLevel: z.enum(["a1", "a2", "b1", "b2"]).optional(),
      }),
      z.strictObject({
        source: z.literal("prepared-activity"),
        activityId: activityIdSchema,
        exerciseCount: z.int().min(3).max(30).optional(),
      }),
      z.strictObject({
        source: z.literal("mistake-pattern"),
        category: z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("grammar"),
            categoryKey: text(120),
            curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
          }),
          z.strictObject({
            kind: z.literal("vocabulary"),
            categoryKey: text(120),
            lemma: text(160),
          }),
        ]),
      }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("exercise-feedback"),
    expectedGeneration: dataRootGenerationSchema,
    activityId: activityIdSchema,
    attemptId: attemptIdSchema,
    answer: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("free-writing"), text: text(10_000) }),
      z.strictObject({ kind: z.literal("short-answer"), text: text(12_000) }),
      z.strictObject({ kind: z.literal("sentence-correction"), text: text(12_000) }),
    ]),
  }),
]);

export const learningOperationStartRequest = request(
  "learning-operation/start",
  z.strictObject({
    submissionId: correlationIdSchema,
    input: learningOperationInputSchema,
  }),
);

export const learningOperationCancelRequest = request(
  "learning-operation/cancel",
  z.strictObject({ operationId: correlationIdSchema }),
);

export const learningOperationRetryRequest = request(
  "learning-operation/retry",
  z.strictObject({
    previousOperationId: correlationIdSchema,
    submissionId: correlationIdSchema,
  }),
);

export const learningOperationAcceptanceSchema = z.discriminatedUnion("status", [
  z.strictObject({
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    status: z.literal("accepted"),
    timeoutMilliseconds: z.int().positive().max(300_000),
    submission: z.literal("retained"),
  }),
  z.strictObject({
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    status: z.literal("retained-feedback"),
    submission: z.literal("retained"),
    modelRequestId: modelRequestIdSchema,
    provenance: generationProvenanceSchema.nullable(),
    output: generationCandidateOutputSchemas["exercise-feedback"],
  }),
]);

export const learningOperationStartResponse = response(
  "learning-operation/start",
  learningOperationAcceptanceSchema,
);

export const learningOperationCancelResponse = response(
  "learning-operation/cancel",
  z.strictObject({
    operationId: correlationIdSchema,
    status: z.enum(["cancelling", "already-finished"]),
  }),
);

export const learningOperationRetryResponse = response(
  "learning-operation/retry",
  learningOperationAcceptanceSchema,
);

export const generationRequests = [
  request("translation/read", translationRequestSchema),
  request("translation/start", translationStartSchema),
  request("translation/cancel", translationCancelSchema),
  request("translation/flashcard-visibility", translationRevealSchema),
  learningOperationStartRequest,
  learningOperationRetryRequest,
  learningOperationCancelRequest,
] as const;

export const generationResponses = [
  response("translation/read", translationReadSchema),
  response(
    "translation/start",
    z.strictObject({ operationId: correlationIdSchema, status: z.enum(["accepted", "saved"]) }),
  ),
  response(
    "translation/cancel",
    z.strictObject({ status: z.enum(["cancelling", "already-finished"]) }),
  ),
  response("translation/flashcard-visibility", z.strictObject({ visible: z.boolean() })),
  learningOperationStartResponse,
  learningOperationRetryResponse,
  learningOperationCancelResponse,
] as const;
