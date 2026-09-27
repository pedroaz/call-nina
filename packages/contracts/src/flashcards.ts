import { z, strictBoundaryObject } from "./schema-system.js";
import { activityIdSchema, dataRootGenerationSchema, vocabularyIdSchema } from "./common.js";
import { vocabularyLexemeSchema, vocabularyExampleSchema } from "./vocabulary-content.js";
import { vocabularyVersionSchema } from "./vocabulary-library.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
export const practiceCountSchema = z.int().min(3).max(30);
export const flashcardSchema = z.strictObject({
  lemma: text(160),
  meaning: text(500),
  lexeme: vocabularyLexemeSchema,
  examples: z.array(vocabularyExampleSchema).min(1).max(12),
});
// AI structured output requires every property in each object branch. Persisted
// vocabulary still permits omitted morphology; generation supplies these fields.
export const generatedFlashcardSchema = flashcardSchema.extend({
  lexeme: z.discriminatedUnion("partOfSpeech", [
    vocabularyLexemeSchema.options[0],
    vocabularyLexemeSchema.options[1].required(),
    vocabularyLexemeSchema.options[2],
    vocabularyLexemeSchema.options[3],
    vocabularyLexemeSchema.options[4].required(),
    vocabularyLexemeSchema.options[5],
  ]),
  examples: z.array(vocabularyExampleSchema).length(1),
});
export const flashcardGenerationCandidateSchema = strictBoundaryObject({
  title: text(160),
  targetLevel: z.enum(["A1", "A2", "B1", "B2"]),
  cards: z.array(generatedFlashcardSchema).min(3).max(30),
});
export const flashcardProgressSchema = z.strictObject({
  position: z.int().min(0).max(29),
  completed: z.boolean(),
  revision: z.int().nonnegative(),
});
export const flashcardDeckSchema = z.strictObject({
  activityId: activityIdSchema,
  rootGeneration: dataRootGenerationSchema,
  title: text(160),
  source: z.enum(["generated", "vocabulary"]),
  cards: z.array(flashcardSchema).min(3).max(30),
  progress: flashcardProgressSchema,
  vocabulary: z
    .array(
      z.strictObject({
        position: z.int().min(0).max(29),
        vocabularyId: vocabularyIdSchema,
        status: z.enum(["candidate", "active", "suspended"]),
      }),
    )
    .max(30),
});
export const flashcardCreateRequestSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  title: text(160),
  entries: z
    .array(vocabularyVersionSchema)
    .min(3)
    .max(30)
    .refine((entries) => new Set(entries.map((e) => e.vocabularyId)).size === entries.length),
});
export const flashcardReadRequestSchema = z.strictObject({
  activityId: activityIdSchema,
  rootGeneration: dataRootGenerationSchema,
});
export const flashcardProgressRequestSchema = flashcardReadRequestSchema.extend({
  expectedRevision: z.int().nonnegative(),
  position: z.int().min(0).max(29),
  completed: z.boolean(),
});
export const flashcardSaveRequestSchema = flashcardReadRequestSchema.extend({
  positions: z
    .array(z.int().min(0).max(29))
    .min(1)
    .max(30)
    .refine((p) => new Set(p).size === p.length),
});
export type Flashcard = z.infer<typeof flashcardSchema>;
export type FlashcardDeck = z.infer<typeof flashcardDeckSchema>;
export function vocabularyLemma(card: Pick<Flashcard, "lemma" | "lexeme">): string {
  const lemma = card.lemma.trim();
  if (card.lexeme.partOfSpeech !== "noun") return lemma;
  const prefix = `${card.lexeme.nounForm.article} `;
  return lemma.toLocaleLowerCase("de").startsWith(prefix)
    ? lemma.slice(prefix.length).trim() || lemma
    : lemma;
}
export function vocabularyIdentity(card: Pick<Flashcard, "lemma" | "meaning" | "lexeme">): string {
  const normalize = (value: string) =>
    value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("de");
  return JSON.stringify([
    normalize(vocabularyLemma(card)),
    card.lexeme.partOfSpeech,
    normalize(card.meaning),
  ]);
}
