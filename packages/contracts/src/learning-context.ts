import { learnerIdSchema } from "./common.js";
import { z } from "./schema-system.js";

export const languageIds = ["en-US", "pt-BR", "es", "de"] as const;
export const languageSchema = z.enum(languageIds);
export const targetLanguageSchema = languageSchema;
export const explanationLanguageSchema = languageSchema;
export const interfaceLanguageSchema = languageSchema;
export type Language = z.infer<typeof languageSchema>;

// Registration and storage support do not imply implemented teaching or UI policies.
export const languageDefinitions = {
  "en-US": { name: "English", structuredCourseId: null },
  "pt-BR": { name: "Português brasileiro", structuredCourseId: null },
  es: { name: "Español", structuredCourseId: null },
  de: { name: "Deutsch", structuredCourseId: "german-foundations" },
} as const satisfies Record<Language, { name: string; structuredCourseId: string | null }>;
export const courseEnrollmentSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,79}$/u)
  .nullable();
export const learningScopeSchema = z.strictObject({
  learnerId: learnerIdSchema,
  courseId: courseEnrollmentSchema,
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

/** Implemented policies/resources, independently of selectable storage languages. Owners #73/#74 extend these with their implementations. */
export const languageCapabilities = {
  "en-US": {
    generation: true,
    evaluation: true,
    vocabulary: true,
    interface: true,
    structuredPath: false,
  },
  "pt-BR": {
    generation: true,
    evaluation: true,
    vocabulary: true,
    interface: false,
    structuredPath: false,
  },
  es: {
    generation: true,
    evaluation: true,
    vocabulary: true,
    interface: false,
    structuredPath: false,
  },
  de: {
    generation: true,
    evaluation: true,
    vocabulary: true,
    interface: true,
    structuredPath: true,
  },
} as const satisfies Record<
  Language,
  {
    generation: boolean;
    evaluation: boolean;
    vocabulary: boolean;
    interface: boolean;
    structuredPath: boolean;
  }
>;
