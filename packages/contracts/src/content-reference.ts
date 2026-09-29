import { curriculumTopicIdSchema, utcInstantSchema } from "./common.js";
import { materialRevisionSchema } from "./material.js";
import { learningGoalSchema, targetLanguageSchema } from "./learning-context.js";
import { z } from "./schema-system.js";

export const contentIdSchema = z.string().regex(/^content_[0-9a-z]{16,64}$/u);
export const contentRevisionIdSchema = z.string().regex(/^content-revision_[0-9a-z]{16,64}$/u);
export const contentReferenceSchema = z.strictObject({
  contentId: contentIdSchema,
  revisionId: contentRevisionIdSchema,
});
export const contentExerciseRevisionSchema = z.strictObject({
  exerciseId: z.string().regex(/^content-exercise_[0-9a-z]{16,64}$/u),
  revisionId: z.string().regex(/^exercise-revision_[0-9a-z]{16,64}$/u),
  evaluation: z.enum(["deterministic", "accepted-answer-or-ai", "requires-ai"]),
});
export const contentAssetReferenceSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaType: z.enum(["image/png", "image/jpeg", "audio/mpeg"]),
  byteLength: z.int().positive().max(10_000_000),
});

export const portableContentShape = {
  schemaVersion: z.literal(1),
  ...contentReferenceSchema.shape,
  title: z.string().min(1).max(160),
  language: targetLanguageSchema,
  createdAt: utcInstantSchema,
  goal: z.strictObject({
    learnerGoal: learningGoalSchema.nullable(),
    courseId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
    request: z.string().min(1).max(2_000),
    curriculumTopicIds: z.array(curriculumTopicIdSchema).max(20),
  }),
  materials: z.array(materialRevisionSchema).length(1),
  // The text players cannot resolve media. Reject assets until a resolver exists.
  assets: z.array(contentAssetReferenceSchema).max(0),
};
