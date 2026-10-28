import { generatedFlashcardSchema } from "./flashcards.js";
import { z, strictBoundaryObject } from "./schema-system.js";
import { vocabularyExampleSchema } from "./vocabulary-content.js";
import { targetLanguageSchema } from "./learning-context.js";
import { dataRootGenerationSchema } from "./common.js";
const text = (max: number) => z.string().min(1).max(max).regex(/\S/u);
export const vocabularyImageSchema = z.strictObject({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z
    .string()
    .min(4)
    .max(13_981_016)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});
export const vocabularyObservationSchema = z.strictObject({
  lemma: text(160),
  meaning: text(500),
  lexeme: generatedFlashcardSchema.shape.lexeme,
  examples: z.array(vocabularyExampleSchema).min(1).max(3),
  reason: text(800),
  excerpt: text(500),
  outcome: z.enum(["requested", "difficulty", "success"]),
  attemptId: z.string().max(100).nullable(),
});
export const vocabularyAnalysisOutputSchema = strictBoundaryObject({
  title: text(160),
  extractedText: z.string().max(12_000),
  readable: z.boolean(),
  words: z.array(vocabularyObservationSchema).max(20),
});
export const vocabularyFocusSchema = z.strictObject({
  id: text(100),
  title: text(160),
  guidance: z.string().max(2_000),
  text: z.string().max(12_000),
  active: z.boolean(),
  createdAt: text(40),
});
export const vocabularyBatchSchema = z.strictObject({
  id: text(100),
  title: text(160),
  added: z.int().nonnegative(),
  createdAt: text(40),
  read: z.boolean(),
  undone: z.boolean(),
  focusId: z.string().nullable(),
  source: z.enum(["practice", "writing", "content"]),
  words: z
    .array(
      z.strictObject({
        vocabularyId: text(100),
        lemma: text(160),
        meaning: text(500),
        reason: text(800),
        examples: z.array(vocabularyExampleSchema).max(10),
        added: z.boolean(),
      }),
    )
    .max(20),
});
export const vocabularyLearningSnapshotSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  language: targetLanguageSchema,
  focuses: z.array(vocabularyFocusSchema).max(100),
  dueWords: z.array(text(160)).max(3),
  batches: z.array(vocabularyBatchSchema).max(50),
  pendingActivities: z.array(z.strictObject({ activityId: text(100), title: text(160) })).max(50),
});
