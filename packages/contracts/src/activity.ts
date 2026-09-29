import { materialReferenceSchema } from "./material.js";
import { exerciseEntryContextSchema } from "./exercise-launch.js";
import { learningScopeSchema } from "./learning-context.js";
import { courseReferenceSchema, courseTeachingContextSchema } from "./learning-path.js";
import {
  activityIdSchema,
  curriculumTopicIdSchema,
  mistakeIdSchema,
  vocabularyIdSchema,
  utcInstantSchema,
} from "./common.js";
import { voiceActivityContextSchema } from "./voice.js";
import { z } from "./schema-system.js";

export const activityTypeSchema = z.enum([
  "flashcards",
  "writing",
  "grammar",
  "vocabulary-review",
  "reading",
  "codex-listening",
  "voice-speaking",
  "placement",
  "custom-lesson",
]);

export const preparedActivitySchema = z
  .strictObject({
    activityId: activityIdSchema,
    activityType: activityTypeSchema,
    title: z.string().min(1).max(160),
    originSurface: z.enum(["desktop", "codex"]),
    context: z.strictObject({
      learningScope: learningScopeSchema,
      entry: exerciseEntryContextSchema.optional(),
      naturalRequest: z.string().min(1).max(1_000),
      instructions: z.string().min(1).max(2_000).optional(),
      curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
      mistakeIds: z.array(mistakeIdSchema).max(12),
      vocabularyIds: z.array(vocabularyIdSchema).max(24),
      voiceContext: voiceActivityContextSchema.optional(),
      learningPath: courseReferenceSchema.optional(),
      // Instructional/evaluation context survives reuse outside its originating course.
      // Course credit requires learningPath, independently of this context.
      courseTeaching: courseTeachingContextSchema.optional(),
    }),
    preparedAt: utcInstantSchema,
  })
  .superRefine((activity, context) => {
    if (
      activity.context.entry &&
      (activity.context.entry.origin === "learning-path"
        ? JSON.stringify(activity.context.entry.reference) !==
          JSON.stringify(activity.context.learningPath)
        : activity.context.learningPath !== undefined)
    )
      context.addIssue({
        code: "custom",
        path: ["context", "entry"],
        message: "OD_ACTIVITY_CAPABILITY_INVALID",
      });
    const expected =
      activity.activityType === "codex-listening"
        ? "listening"
        : activity.activityType === "voice-speaking"
          ? "speaking"
          : undefined;
    if (activity.context.voiceContext?.kind !== expected) {
      context.addIssue({
        code: "custom",
        path: ["context", "voiceContext"],
        message: "OD_VOICE_CONTEXT_INVALID",
      });
    }
  });

export const activityLibraryCursorSchema = z.strictObject({
  preparedAt: utcInstantSchema,
  activityId: activityIdSchema,
});
export const activityLibraryFilterSchema = z.strictObject({
  activityTypes: z.array(activityTypeSchema).max(9).default([]),
  maximum: z.int().min(1).max(50).default(20),
  cursor: activityLibraryCursorSchema.optional(),
  material: materialReferenceSchema.optional(),
});
export const activityLibraryItemSchema = z
  .strictObject(preparedActivitySchema.shape)
  .omit({ context: true })
  .extend({
    generated: z.boolean(),
    deletionStatus: z.enum(["available", "cascade", "retained-data"]),
  });
