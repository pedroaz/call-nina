import {
  activityIdSchema,
  attemptIdSchema,
  correlationIdSchema,
  dataRootGenerationSchema,
  utcInstantSchema,
} from "./common.js";
import { contentReferenceSchema } from "./content-reference.js";
import { generationProvenanceSchema } from "./generation-provenance.js";
import { languageSchema, learningScopeSchema } from "./learning-context.js";
import { strictBoundaryObject, z } from "./schema-system.js";

const position = z.int().min(0).max(29);
export const translationFieldSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("lesson-explanation") }),
  z.strictObject({ kind: z.literal("lesson-section"), index: z.int().min(0).max(19) }),
  z.strictObject({ kind: z.literal("lesson-vocabulary"), index: z.int().min(0).max(19) }),
  z.strictObject({ kind: z.literal("exercise-explanation"), position, attemptId: attemptIdSchema }),
  z.strictObject({
    kind: z.literal("exercise-hint"),
    position,
    index: z.int().min(0).max(4),
    attemptId: attemptIdSchema,
  }),
  z.strictObject({ kind: z.literal("feedback-summary"), position, attemptId: attemptIdSchema }),
  z.strictObject({
    kind: z.literal("feedback-strength"),
    position,
    index: z.int().min(0).max(19),
    attemptId: attemptIdSchema,
  }),
  z.strictObject({
    kind: z.literal("feedback-improvement"),
    position,
    index: z.int().min(0).max(19),
    attemptId: attemptIdSchema,
  }),
  z.strictObject({ kind: z.literal("flashcard-meaning"), position, revealId: correlationIdSchema }),
  z.strictObject({
    kind: z.literal("flashcard-example"),
    position,
    index: z.int().min(0).max(11),
    revealId: correlationIdSchema,
  }),
]);
export const translationRequestSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  activityId: activityIdSchema,
  content: contentReferenceSchema,
  field: translationFieldSchema,
});
export const translationStartSchema = translationRequestSchema.extend({
  operationId: correlationIdSchema,
  language: languageSchema,
});
export const translationCancelSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  operationId: correlationIdSchema,
});
export const translationRevealSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  activityId: activityIdSchema,
  content: contentReferenceSchema,
  position,
  progressRevision: z.int().nonnegative(),
  revealId: correlationIdSchema,
  visible: z.boolean(),
});
export const savedTranslationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  activityId: activityIdSchema,
  content: contentReferenceSchema,
  // Stable field key excludes transient reveal capabilities and, except for feedback,
  // attempt IDs. Availability is checked independently on every read and write.
  fieldKey: z.string().min(1).max(250),
  learningScope: learningScopeSchema,
  original: z.string().min(1).max(12_000),
  language: languageSchema,
  text: z.string().min(1).max(32_000).regex(/\S/u),
  createdAt: utcInstantSchema,
  provenance: generationProvenanceSchema,
});
export const translationReadSchema = z.strictObject({
  translations: z.array(savedTranslationSchema).max(4),
});
export const translationFinishedEventSchema = strictBoundaryObject({
  event: z.literal("translation-finished"),
  operationId: correlationIdSchema,
  rootGeneration: dataRootGenerationSchema,
  // Never push translated text: the reader must recheck current visibility.
  outcome: z.enum(["saved", "cancelled", "failed"]),
});
export type TranslationRequest = z.infer<typeof translationRequestSchema>;
export type TranslationStart = z.infer<typeof translationStartSchema>;
export type TranslationReveal = z.infer<typeof translationRevealSchema>;
export type SavedTranslation = z.infer<typeof savedTranslationSchema>;

export function translationFieldKey(field: TranslationRequest["field"]): string {
  return [
    field.kind,
    "position" in field ? field.position : "",
    "index" in field ? field.index : "",
    field.kind.startsWith("feedback-") && "attemptId" in field ? field.attemptId : "",
  ].join(":");
}
