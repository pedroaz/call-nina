import { activityIdSchema, dataRootGenerationSchema, utcInstantSchema } from "./common.js";
import { contentReferenceSchema } from "./content-reference.js";
import { learningContextSchema, learningScopeSchema } from "./learning-context.js";
import { materialReferenceSchema } from "./material.js";
import { z } from "./schema-system.js";

export const ninaPracticeKindSchema = z.enum([
  "grammar",
  "reading",
  "vocabulary-review",
  "writing",
  "custom-lesson",
]);
const requestText = z.string().min(1).max(1_800).regex(/\S/u);
export const ninaRequestSchema = z.strictObject({
  expectedGeneration: dataRootGenerationSchema,
  scope: learningScopeSchema,
  naturalRequest: requestText,
  minutes: z.int().min(5).max(60).optional(),
  kind: ninaPracticeKindSchema.optional(),
  material: materialReferenceSchema.optional(),
});
export const ninaGenerationRequestSchema = z
  .strictObject({
    source: z.literal("nina"),
    expectedGeneration: dataRootGenerationSchema,
    learningContext: learningContextSchema,
    naturalRequest: requestText,
    kind: ninaPracticeKindSchema,
    estimatedMinutes: z.int().min(5).max(60),
    material: materialReferenceSchema.optional(),
  })
  .refine((value) => !value.material || ["reading", "vocabulary-review"].includes(value.kind));

// Only these existing app actions can leave the planner. No model-supplied routes or commands.
export const ninaPlanSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("clarification") }),
  z.strictObject({
    status: z.literal("ready"),
    request: ninaGenerationRequestSchema,
    prepared: z
      .strictObject({
        activityId: activityIdSchema,
        title: z.string().min(1).max(160),
        content: contentReferenceSchema,
      })
      .nullable(),
  }),
]);
export const ninaContinueSchema = z.strictObject({
  activityId: activityIdSchema,
  title: z.string().min(1).max(160),
  lastUsedAt: utcInstantSchema,
});
export type NinaRequest = z.infer<typeof ninaRequestSchema>;
export type NinaPlan = z.infer<typeof ninaPlanSchema>;
export type NinaGenerationRequest = z.infer<typeof ninaGenerationRequestSchema>;
