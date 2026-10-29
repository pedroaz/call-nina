import { z } from "./schema-system.js";
import { dataRootGenerationSchema, curriculumTopicIdSchema } from "./common.js";
import { languageSchema, learningContextSchema } from "./learning-context.js";

const text = z.string().trim().min(1).max(6000);
export const storyLocalizedSchema = z.strictObject({ en: text, de: text, es: text, "pt-BR": text });
export const storySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
  version: z.literal(1),
  language: languageSchema,
  level: z.enum(["A1", "A2", "B1", "B2"]),
  topicId: curriculumTopicIdSchema,
  title: storyLocalizedSchema,
  summary: storyLocalizedSchema,
  paragraphs: z.array(text).min(2).max(30),
  vocabulary: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(160),
        meaning: storyLocalizedSchema,
        example: text,
        exampleMeaning: storyLocalizedSchema,
      }),
    )
    .min(1)
    .max(20),
});
export const storyCatalogSchema = z
  .strictObject({ schemaVersion: z.literal(1), stories: z.array(storySchema).max(1000) })
  .superRefine((value, context) => {
    if (new Set(value.stories.map((story) => story.id)).size !== value.stories.length)
      context.addIssue({ code: "custom", message: "Duplicate story identifier" });
  });
export const storySnapshotSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  learningContext: learningContextSchema,
  stories: z.array(storySchema),
  positions: z.record(z.string(), z.int().nonnegative()),
});
export const storyUpdateSchema = z.strictObject({
  expectedGeneration: dataRootGenerationSchema,
  language: languageSchema,
  storyId: z.string().max(80),
  paragraph: z.int().nonnegative(),
});
export const storyVocabularySchema = storyUpdateSchema
  .omit({ paragraph: true })
  .extend({ word: z.int().nonnegative() });
export type Story = z.infer<typeof storySchema>;
export type StorySnapshot = z.infer<typeof storySnapshotSchema>;
