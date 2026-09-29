import { z } from "./schema-system.js";

export const generationProvenanceSchema = z.strictObject({
  producer: z.string().regex(/^(?!local-vocabulary$)[a-z][a-z0-9-]{0,79}$/u),
  modelId: z.string().min(1).max(200),
  effortId: z.string().min(1).max(128),
});

export type GenerationProvenance = z.infer<typeof generationProvenanceSchema>;
