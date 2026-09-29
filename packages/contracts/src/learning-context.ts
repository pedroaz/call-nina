import { learnerIdSchema } from "./common.js";
import { z } from "./schema-system.js";

// These are learning capabilities, independent of interface localization.
export const targetLanguageSchema = z.literal("de");
export const explanationLanguageSchema = z.enum(["en", "de"]);
export const learningScopeSchema = z.strictObject({
  learnerId: learnerIdSchema,
  courseId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
  targetLanguage: targetLanguageSchema,
});
export const learningGoalSchema = z.strictObject({
  purpose: z.literal("everyday-life"),
  description: z.string().trim().min(1).max(500),
  motivation: z.string().trim().min(1).max(500),
  targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
  preferredTopics: z.array(z.string().trim().min(1).max(120)).max(20),
});
export const learningContextSchema = learningScopeSchema.extend({
  explanationLanguage: explanationLanguageSchema,
  goal: learningGoalSchema,
});
export type LearningScope = z.infer<typeof learningScopeSchema>;
export type LearningContext = z.infer<typeof learningContextSchema>;
