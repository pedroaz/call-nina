import { activityIdSchema, correlationIdSchema, dataRootGenerationSchema } from "./common.js";
import { contentReferenceSchema } from "./content-reference.js";
import { courseReferenceSchema } from "./learning-path.js";
import { z } from "./schema-system.js";

// Entry context owns attribution; content provenance never confers course credit.
export const exerciseEntryContextSchema = z.discriminatedUnion("origin", [
  z.strictObject({ origin: z.enum(["free-practice", "nina", "materials", "history"]) }),
  z.strictObject({ origin: z.literal("learning-path"), reference: courseReferenceSchema }),
]);
export const reuseExerciseActionSchema = z.strictObject({
  action: z.literal("reuse-exercises"),
  activityId: activityIdSchema,
  content: contentReferenceSchema,
  context: exerciseEntryContextSchema,
  launchId: correlationIdSchema,
  expectedGeneration: dataRootGenerationSchema,
});
export type ExerciseEntryContext = z.infer<typeof exerciseEntryContextSchema>;
