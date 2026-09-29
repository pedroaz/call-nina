import { generationProvenanceSchema } from "./generation-provenance.js";
import { portableContentShape } from "./content-reference.js";
import { contentJsonByteLength, maximumFlashcardContentBytes } from "./content-limits.js";
import { germanVocabularyLemma, normalizeGermanVocabularyIdentity } from "./german-language.js";
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
export const portableFlashcardContentSchema = z
  .strictObject({
    ...portableContentShape,
    kind: z.literal("flashcard-deck"),
    provenance: z.union([
      generationProvenanceSchema,
      z.strictObject({ producer: z.literal("local-vocabulary") }),
    ]),
    evaluation: z.literal("self-assessment"),
    cardRevisions: z
      .array(
        z.strictObject({
          cardId: z.string().regex(/^content-card_[0-9a-z]{16,64}$/u),
          revisionId: z.string().regex(/^card-revision_[0-9a-z]{16,64}$/u),
        }),
      )
      .min(3)
      .max(30),
    cards: z.array(flashcardSchema).min(3).max(30),
  })
  .superRefine((content, ctx) => {
    if (
      contentJsonByteLength(content) > maximumFlashcardContentBytes ||
      content.cards.length !== content.cardRevisions.length ||
      new Set(content.cardRevisions.map((card) => card.cardId)).size !== content.cards.length ||
      new Set(content.cardRevisions.map((card) => card.revisionId)).size !== content.cards.length
    )
      ctx.addIssue({ code: "custom", message: "OD_CONTENT_INVALID" });
  });
export type PortableFlashcardContent = z.infer<typeof portableFlashcardContentSchema>;

export const flashcardDeckSchema = z.strictObject({
  activityId: activityIdSchema,
  rootGeneration: dataRootGenerationSchema,
  title: text(160),
  source: z.enum(["generated", "vocabulary"]),
  content: portableFlashcardContentSchema,
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
  return germanVocabularyLemma(
    card.lemma,
    card.lexeme.partOfSpeech === "noun" ? card.lexeme.nounForm.article : undefined,
  );
}
export function vocabularyIdentity(card: Pick<Flashcard, "lemma" | "meaning" | "lexeme">): string {
  const normalize = normalizeGermanVocabularyIdentity;
  return JSON.stringify([
    normalize(vocabularyLemma(card)),
    card.lexeme.partOfSpeech,
    normalize(card.meaning),
  ]);
}
