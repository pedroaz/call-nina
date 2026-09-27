import { z } from "./schema-system.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const nounFormSchema = z.discriminatedUnion("gender", [
  z.strictObject({ gender: z.literal("masculine"), article: z.literal("der") }),
  z.strictObject({ gender: z.literal("feminine"), article: z.literal("die") }),
  z.strictObject({ gender: z.literal("neuter"), article: z.literal("das") }),
]);

const pluralSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("form"), form: text(160) }),
  z.strictObject({ status: z.literal("unchanged") }),
  z.strictObject({ status: z.literal("not-applicable") }),
  z.strictObject({ status: z.literal("unknown") }),
]);

export const vocabularyLexemeSchema = z.discriminatedUnion("partOfSpeech", [
  z.strictObject({
    partOfSpeech: z.literal("noun"),
    nounForm: nounFormSchema,
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
  german: text(500),
  meaning: text(500),
});
