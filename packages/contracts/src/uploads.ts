import { savedUploadItemSchema, websiteStudyPackSchema } from "./website-study-pack.js";
import { materialRevisionSchema, materialSourceSchema } from "./material.js";
import { dataRootGenerationSchema, utcInstantSchema } from "./common.js";
import { targetLanguageSchema } from "./learning-context.js";
import { z } from "./schema-system.js";

export const uploadIdSchema = z.string().regex(/^upload_[0-9a-z]{16,64}$/u);
export const uploadRevisionIdSchema = z.string().regex(/^upload-revision_[0-9a-z]{16,64}$/u);
export const uploadReferenceSchema = z.strictObject({
  uploadId: uploadIdSchema,
  revisionId: uploadRevisionIdSchema,
});
export const uploadImageInputSchema = z.strictObject({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z
    .string()
    .min(4)
    .max(13_981_016)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});
export const uploadImageMetadataSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaType: uploadImageInputSchema.shape.mediaType,
  byteSize: z
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export const uploadDraftSchema = z
  .strictObject({
    format: z.enum(["text", "website", "image"]),
    title: z.string().trim().min(1).max(160),
    text: z.string().max(12_000),
    url: materialSourceSchema.shape.url.optional(),
    image: uploadImageInputSchema.optional(),
  })
  .refine(
    (draft) =>
      (draft.format === "image" || /\S/u.test(draft.text)) &&
      (!draft.image || draft.format === "image") &&
      (!draft.url || draft.format === "website"),
  );
export const uploadSummarySchema = z.strictObject({
  ...uploadReferenceSchema.shape,
  title: z.string().min(1).max(160),
  format: z.enum(["text", "website", "image"]),
  language: targetLanguageSchema,
  createdAt: utcInstantSchema,
  archived: z.boolean(),
  hasText: z.boolean(),
  url: materialSourceSchema.shape.url.nullable(),
});
export const uploadDetailSchema = uploadSummarySchema.extend({
  revision: z.int().positive(),
  text: z.string().max(12_000),
  material: materialRevisionSchema.nullable(),
  image: uploadImageMetadataSchema.nullable(),
  items: z.array(savedUploadItemSchema).max(500).default([]),
  studyPack: websiteStudyPackSchema.nullable().default(null),
});
export const practiceSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("adaptive") }),
  z.strictObject({
    kind: z.literal("upload"),
    reference: uploadReferenceSchema,
    rootGeneration: dataRootGenerationSchema,
  }),
]);
/** A main-resolved immutable source, captured with the generation request. */
export const uploadPracticeContextSchema = z.strictObject({
  upload: uploadReferenceSchema,
  material: materialRevisionSchema,
  items: z.array(savedUploadItemSchema).max(500).default([]),
});
export type UploadReference = z.infer<typeof uploadReferenceSchema>;
export type UploadDraft = z.infer<typeof uploadDraftSchema>;
export type UploadDetail = z.infer<typeof uploadDetailSchema>;
export type UploadSummary = z.infer<typeof uploadSummarySchema>;
export type UploadImageInput = z.infer<typeof uploadImageInputSchema>;
export type UploadImageMetadata = z.infer<typeof uploadImageMetadataSchema>;
export type PracticeSource = z.infer<typeof practiceSourceSchema>;
export type UploadPracticeContext = z.infer<typeof uploadPracticeContextSchema>;
