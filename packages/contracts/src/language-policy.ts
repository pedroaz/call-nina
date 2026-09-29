import { type Language, targetLanguageSchema } from "./learning-context.js";

/** Keep accents and spelling contrasts (including German ß and Spanish ñ) significant. */
export function normalizeLanguageAnswer(value: string, language: Language): string {
  return value
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/gu, " ")
    .toLocaleLowerCase(targetLanguageSchema.parse(language));
}

export function normalizeVocabularyIdentity(value: string, language: Language): string {
  return value
    .normalize("NFC")
    .trim()
    .replaceAll(/\s+/gu, " ")
    .toLocaleLowerCase(targetLanguageSchema.parse(language));
}

export const languageTeachingPolicies = {
  "en-US":
    "Use US English spelling and everyday usage. Nouns have no grammatical gender: nounForm.gender is not-applicable, article is the or null. Teach count/mass distinctions, irregular plurals, a/an in examples, tense/aspect and natural word order. Do not assign German case or noun gender.",
  "pt-BR":
    "Use Brazilian Portuguese spelling and everyday usage. Noun gender is masculine, feminine or common; definite articles are o/a/os/as, or null when unknown or inapplicable. Preserve accents, cedilla, nasal vowels, contractions and agreement; teach Brazilian pronoun/verb usage and irregular plurals without imposing European Portuguese defaults.",
  es: "Use widely understood Spanish without a country-specific default. Accept valid regional vocabulary and pronoun choices when they fit the task; do not require a regional variant that was not requested. Noun gender is masculine, feminine or common; definite articles are el/la/los/las, or null when unknown or inapplicable. A stressed initial a can take el with a feminine noun. Preserve accents, ñ, agreement and inverted question/exclamation punctuation.",
  de: "Use German spelling, noun capitalization, case and agreement. Noun gender is masculine/feminine/neuter with nominative dictionary article der/die/das. Plural-only nouns may use die with not-applicable gender. Preserve umlauts and ß; do not silently equate them with unaccented spelling. Teach separable verbs and word order at the requested level.",
} as const satisfies Record<Language, string>;
