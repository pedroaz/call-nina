import { targetLanguageSchema } from "./learning-context.js";
import { utcInstantSchema } from "./common.js";
import { z } from "./schema-system.js";

export const materialIdSchema = z.string().regex(/^material_[0-9a-z]{16,64}$/u);
export const materialRevisionIdSchema = z.string().regex(/^material-revision_[0-9a-z]{16,64}$/u);
export const materialReferenceSchema = z.strictObject({
  materialId: materialIdSchema,
  revisionId: materialRevisionIdSchema,
});
// Source references are citations, never fetch instructions or local filesystem paths.
export const materialSourceSchema = z.strictObject({
  url: z
    .url({ protocol: /^https$/u })
    .max(2_000)
    .regex(/^https:\/\/[^/@?#\s]+(?:\/[^?#\s]*)?$/u),
});
export const materialDraftSchema = z.strictObject({
  kind: z.enum(["topic", "pasted-text"]),
  title: z.string().trim().min(1).max(160),
  language: targetLanguageSchema,
  text: z.string().min(1).max(12_000).regex(/\S/u),
  source: materialSourceSchema.optional(),
});
export const materialRevisionSchema = materialDraftSchema.extend({
  schemaVersion: z.literal(1),
  ...materialReferenceSchema.shape,
  revision: z.int().positive(),
  createdAt: utcInstantSchema,
});
export type MaterialDraft = z.infer<typeof materialDraftSchema>;
export type MaterialRevision = z.infer<typeof materialRevisionSchema>;
export type MaterialReference = z.infer<typeof materialReferenceSchema>;
