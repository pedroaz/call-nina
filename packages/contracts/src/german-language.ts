import { z } from "./schema-system.js";

export const germanArticleSchema = z.enum(["der", "die", "das"]);
export const germanNounFormSchema = z.discriminatedUnion("gender", [
  z.strictObject({ gender: z.literal("masculine"), article: z.literal("der") }),
  z.strictObject({ gender: z.literal("feminine"), article: z.literal("die") }),
  z.strictObject({ gender: z.literal("neuter"), article: z.literal("das") }),
]);

export function germanNounGender(article: z.infer<typeof germanArticleSchema>) {
  return ({ der: "masculine", die: "feminine", das: "neuter" } as const)[
    germanArticleSchema.parse(article)
  ];
}

export function normalizeGermanAnswer(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("de-DE");
}

export function normalizeGermanVocabularyIdentity(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("de");
}

export function germanVocabularyLemma(lemmaValue: string, article?: string): string {
  const lemma = lemmaValue.trim();
  if (!article) return lemma;
  const prefix = `${germanArticleSchema.parse(article)} `;
  return lemma.toLocaleLowerCase("de").startsWith(prefix)
    ? lemma.slice(prefix.length).trim() || lemma
    : lemma;
}
