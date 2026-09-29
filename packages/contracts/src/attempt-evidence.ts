import { vocabularyExampleSchema, vocabularyLexemeSchema } from "./vocabulary-content.js";
import {
  activityIdSchema,
  attemptIdSchema,
  exerciseIdSchema,
  utcInstantSchema,
  vocabularyIdSchema,
} from "./common.js";
import { contentReferenceSchema, contentExerciseRevisionSchema } from "./content-reference.js";
import { learningScopeSchema } from "./learning-context.js";
import { materialReferenceSchema } from "./material.js";
import { z } from "./schema-system.js";

export const originatingDeviceIdSchema = z.string().regex(/^device_[0-9a-z]{16,64}$/u);
export const attemptEventIdSchema = z.string().regex(/^attempt-event_[0-9a-z]{16,64}$/u);
export const attemptSupportSchema = z.enum([
  "hint",
  "helper",
  "translation",
  "model-answer",
  "repeat-attempt",
  "practice",
]);
export const attemptOwnershipSchema = z.strictObject({
  attemptId: attemptIdSchema,
  // Historic rows have no device evidence. Never assign today's device to their origin.
  originatingDeviceId: originatingDeviceIdSchema.nullable(),
  learningScope: learningScopeSchema,
  courseRevision: z.string().min(1).max(40).nullable(),
  startedAt: utcInstantSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("exercise"),
      activityId: activityIdSchema,
      exerciseId: exerciseIdSchema,
      content: contentReferenceSchema.nullable(),
      exerciseRevision: contentExerciseRevisionSchema.nullable(),
      materials: z.array(materialReferenceSchema).max(1),
    }),
    z.strictObject({
      kind: z.literal("activity"),
      activityId: activityIdSchema,
      revision: z.literal(1),
      content: contentReferenceSchema.nullable(),
      materials: z.array(materialReferenceSchema).max(1),
    }),
    z.strictObject({
      kind: z.literal("vocabulary-review"),
      vocabularyId: vocabularyIdSchema,
      revision: z.int().nonnegative(),
      snapshot: z
        .strictObject({
          lemma: z.string().min(1).max(160),
          meaning: z.string().min(1).max(500),
          lexeme: vocabularyLexemeSchema,
          examples: z.array(vocabularyExampleSchema).min(1).max(12),
        })
        .nullable(),
    }),
  ]),
});
export const attemptEventSchema = z.strictObject({
  eventId: attemptEventIdSchema,
  attemptId: attemptIdSchema,
  originatingDeviceId: originatingDeviceIdSchema.nullable(),
  occurredAt: utcInstantSchema.nullable(),
  detail: z.discriminatedUnion("kind", [
    // Payloads remain in their immutable native tables; these are exact record references.
    z.strictObject({ kind: z.literal("submitted-answer"), position: z.int().min(0).max(99) }),
    z.strictObject({ kind: z.literal("assistance"), support: attemptSupportSchema }),
    z.strictObject({ kind: z.literal("local-evaluation") }),
    z.strictObject({
      kind: z.literal("feedback"),
      source: z.enum(["ai", "external"]),
      recordId: z.string().min(1).max(96),
    }),
    z.strictObject({
      kind: z.literal("self-assessment"),
      grade: z.enum(["again", "hard", "good", "easy"]),
    }),
    z.strictObject({ kind: z.literal("participation") }),
  ]),
});
export const attemptEvidenceSchema = z.strictObject({
  ownership: attemptOwnershipSchema,
  events: z.array(attemptEventSchema).max(250),
  basis: z.enum(["independent", "supported", "self-assessment", "participation", "unknown"]),
});
export type AttemptOwnership = z.infer<typeof attemptOwnershipSchema>;
export type AttemptEvent = z.infer<typeof attemptEventSchema>;
export type AttemptEvidence = z.infer<typeof attemptEvidenceSchema>;

export const externalAttemptFeedbackSchema = z.strictObject({
  outcome: z.enum(["completed", "partially-completed", "abandoned"]),
  summary: z.string().min(1).max(1_000).regex(/\S/u),
  objectiveResults: z.array(z.enum(["met", "partially-met", "not-met", "not-evaluated"])).max(20),
  evidence: z.array(z.string().min(1).max(500).regex(/\S/u)).max(20),
});
