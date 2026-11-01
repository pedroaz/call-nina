import {
  activityIdSchema,
  attemptIdSchema,
  correlationIdSchema,
  dataRootGenerationSchema,
  utcInstantSchema,
} from "../common.js";
import { generationProvenanceSchema } from "../generation-provenance.js";
import { generationCandidateOutputSchemas } from "../generation.js";
import { z } from "../schema-system.js";
import { request, response, text } from "./envelope.js";

export const exerciseSupportRequest = request(
  "exercise-set/support",
  z.strictObject({ activityId: activityIdSchema, attemptId: attemptIdSchema }),
);

export const exerciseSetStartRequest = request(
  "exercise-set/start",
  z.strictObject({
    activityId: activityIdSchema,
    intent: z.enum(["resume", "new-attempt"]),
    launchId: correlationIdSchema,
    expectedGeneration: dataRootGenerationSchema,
  }),
);

export const exerciseSessionAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("free-writing"), text: text(10_000) }),
  z.strictObject({ kind: z.literal("short-answer"), text: text(12_000) }),
  z.strictObject({
    kind: z.literal("fill-in-the-blank"),
    valuesByBlankPosition: z.array(text(500)).min(1).max(20),
  }),
  z.strictObject({ kind: z.literal("sentence-correction"), text: text(12_000) }),
  z.strictObject({
    kind: z.literal("multiple-choice"),
    selectedOptionPosition: z.int().min(0).max(3),
  }),
  z.strictObject({ kind: z.literal("vocabulary-recall"), text: text(12_000) }),
]);

export const exerciseSetAnswerRequest = request(
  "exercise-set/answer",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    activityId: activityIdSchema,
    attemptId: attemptIdSchema,
    answer: exerciseSessionAnswerSchema,
  }),
);

export const exerciseSetCompleteRequest = request(
  "exercise-set/complete",
  z.strictObject({
    activityId: activityIdSchema,
    answers: z
      .array(
        z.strictObject({
          attemptId: attemptIdSchema,
          answer: exerciseSessionAnswerSchema,
        }),
      )
      .min(1)
      .max(30),
  }),
);

export const exerciseSetAbandonRequest = request(
  "exercise-set/abandon",
  z.strictObject({ activityId: activityIdSchema }),
);

export const exerciseSetAnswerResponse = response(
  "exercise-set/answer",
  z.strictObject({
    saved: z.literal(true),
    feedback: generationCandidateOutputSchemas["exercise-feedback"].nullable(),
    feedbackProvenance: generationProvenanceSchema.nullable(),
  }),
);

export const exerciseSupportResponse = response(
  "exercise-set/support",
  z.strictObject({ recorded: z.literal(true) }),
);

export const exerciseSetStartResponse = response(
  "exercise-set/start",
  z.strictObject({
    activityId: activityIdSchema,
    status: z.literal("started"),
    startedAt: utcInstantSchema,
    attemptIds: z.array(attemptIdSchema).min(1).max(30),
  }),
);

export const exerciseSetCompleteResponse = response(
  "exercise-set/complete",
  z.strictObject({
    activityId: activityIdSchema,
    status: z.literal("completed"),
    completedAt: utcInstantSchema,
  }),
);

export const exerciseSetAbandonResponse = response(
  "exercise-set/abandon",
  z.strictObject({
    activityId: activityIdSchema,
    status: z.literal("abandoned"),
    abandonedAt: utcInstantSchema,
  }),
);

export const exercisesRequests = [
  exerciseSupportRequest,
  exerciseSetStartRequest,
  exerciseSetAnswerRequest,
  exerciseSetCompleteRequest,
  exerciseSetAbandonRequest,
] as const;

export const exercisesResponses = [
  exerciseSupportResponse,
  exerciseSetStartResponse,
  exerciseSetAnswerResponse,
  exerciseSetCompleteResponse,
  exerciseSetAbandonResponse,
] as const;
