import { type Language } from "./learning-context.js";
import { z } from "./schema-system.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const pluralSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("form"), form: text(160) }),
  z.strictObject({ status: z.literal("unchanged") }),
  z.strictObject({ status: z.literal("not-applicable") }),
  z.strictObject({ status: z.literal("unknown") }),
]);

export const vocabularyLexemeSchema = z.discriminatedUnion("partOfSpeech", [
  z.strictObject({
    partOfSpeech: z.literal("noun"),
    nounForm: z.strictObject({
      gender: z.enum(["masculine", "feminine", "neuter", "common", "not-applicable", "unknown"]),
      article: z
        .enum(["der", "die", "das", "the", "el", "la", "los", "las", "o", "a", "os", "as"])
        .nullable(),
    }),
    plural: pluralSchema,
  }),
  z.strictObject({ partOfSpeech: z.literal("verb"), pattern: text(160).optional() }),
  z.strictObject({ partOfSpeech: z.literal("adjective") }),
  z.strictObject({ partOfSpeech: z.literal("adverb") }),
  z.strictObject({
    partOfSpeech: z.literal("phrase"),
    function: text(160).optional(),
    register: z.enum(["informal", "formal", "neutral"]).optional(),
  }),
  z.strictObject({ partOfSpeech: z.literal("other") }),
]);

export const vocabularyExampleSchema = z.strictObject({
  text: text(500),
  meaning: text(500),
});

/** Cross-field policy at every boundary that knows the content owner. */
export function vocabularyLexemeMatchesLanguage(
  lexeme: z.infer<typeof vocabularyLexemeSchema>,
  language: Language,
): boolean {
  if (lexeme.partOfSpeech !== "noun") return true;
  const { gender, article } = lexeme.nounForm;
  if (language === "en-US")
    return gender === "not-applicable" && (article === "the" || article === null);
  if (gender === "unknown") return article === null;
  if (language === "de") {
    if (gender === "not-applicable")
      return article === "die" && lexeme.plural.status === "not-applicable";
    return (
      (gender === "masculine" && article === "der") ||
      (gender === "feminine" && article === "die") ||
      (gender === "neuter" && article === "das")
    );
  }
  if (!["masculine", "feminine", "common"].includes(gender)) return false;
  if (article === null) return true;
  if (language === "pt-BR")
    return gender === "common"
      ? ["o", "a", "os", "as"].includes(article)
      : gender === "masculine"
        ? ["o", "os"].includes(article)
        : ["a", "as"].includes(article);
  return gender === "common"
    ? ["el", "la", "los", "las"].includes(article)
    : gender === "masculine"
      ? ["el", "los"].includes(article)
      : ["el", "la", "las"].includes(article);
}
