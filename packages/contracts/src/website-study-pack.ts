import { z, strictBoundaryObject } from "./schema-system.js";
import { utcInstantSchema } from "./common.js";
import { materialSourceSchema } from "./material.js";
import { generationProvenanceSchema } from "./generation-provenance.js";
import { vocabularyLexemeSchema } from "./vocabulary-content.js";

const text = (max: number) => z.string().min(1).max(max).regex(/\S/u);
export const websiteSourceSchema = z.strictObject({
  title: text(160),
  url: materialSourceSchema.shape.url,
  text: text(120_000),
  capturedAt: utcInstantSchema,
  truncated: z.boolean(),
});
export const uploadLearningItemSchema = z.strictObject({
  lemma: text(160),
  meaning: text(500),
  lexeme: z.discriminatedUnion("partOfSpeech", [
    vocabularyLexemeSchema.options[0],
    vocabularyLexemeSchema.options[1].required(),
    vocabularyLexemeSchema.options[2],
    vocabularyLexemeSchema.options[3],
    vocabularyLexemeSchema.options[4].required(),
    vocabularyLexemeSchema.options[5],
  ]),
  origin: z.enum(["page", "suggestion"]),
  excerpt: text(500).nullable(),
  examples: z
    .array(
      z.strictObject({
        text: text(1_000),
        meaning: text(1_000),
        origin: z.enum(["quotation", "generated"]),
      }),
    )
    .min(1)
    .max(3),
});
export const websiteStudyPackOutputSchema = strictBoundaryObject({
  title: text(160),
  summary: text(12_000),
  items: z.array(uploadLearningItemSchema).max(20),
});
export const websiteStudyPackSchema = z.strictObject({
  source: websiteSourceSchema,
  output: websiteStudyPackOutputSchema,
  provenance: generationProvenanceSchema,
});
export const savedUploadItemSchema = uploadLearningItemSchema.extend({
  id: z.string().regex(/^upload-item_[a-f0-9]{32}$/u),
});
export type WebsiteSource = z.infer<typeof websiteSourceSchema>;
export type UploadLearningItem = z.infer<typeof uploadLearningItemSchema>;
export type SavedUploadItem = z.infer<typeof savedUploadItemSchema>;
export type WebsiteStudyPack = z.infer<typeof websiteStudyPackSchema>;
