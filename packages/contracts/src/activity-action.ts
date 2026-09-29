import { learningScopeSchema } from "./learning-context.js";
import { reuseExerciseActionSchema } from "./exercise-launch.js";
import { activityIdSchema, dataRootGenerationSchema } from "./common.js";
import { courseReferenceSchema } from "./learning-path.js";
import { voiceActivityContextSchema } from "./voice.js";
import { z } from "./schema-system.js";

// Actions name application capabilities, never URLs, paths or executable commands.
// Omitted generation means resolve against the current root (e.g. an incoming link).
export const openActivityActionSchema = z.strictObject({
  action: z.literal("open-activity"),
  activityId: activityIdSchema,
  expectedGeneration: dataRootGenerationSchema.optional(),
  recordUse: z.literal(true).optional(),
});

export const activityActionSchema = z.discriminatedUnion("action", [
  openActivityActionSchema,
  reuseExerciseActionSchema,
  z.strictObject({
    action: z.enum([
      "read-generated",
      "read-voice",
      "open-voice-in-codex",
      "delete-activity",
      "prepare-exercises",
      "start-exercises",
    ]),
    activityId: activityIdSchema,
    expectedGeneration: dataRootGenerationSchema,
  }),
  z.strictObject({
    action: z.literal("prepare-voice"),
    learningScope: learningScopeSchema,
    title: z.string().min(1).max(160).regex(/\S/u),
    context: voiceActivityContextSchema,
    expectedGeneration: dataRootGenerationSchema,
  }),
  z.strictObject({
    action: z.literal("prepare-course-voice"),
    reference: courseReferenceSchema,
    expectedGeneration: dataRootGenerationSchema,
  }),
]);

export const activityDestinationSchema = z.enum(["flashcards", "generated-exercises", "prepared"]);
export type ActivityAction = z.infer<typeof activityActionSchema>;
export type ActivityDestination = z.infer<typeof activityDestinationSchema>;
