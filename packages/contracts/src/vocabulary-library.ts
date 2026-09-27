import {
  calendarDateSchema,
  dataRootGenerationSchema,
  utcInstantSchema,
  vocabularyIdSchema,
} from "./common.js";
import { z } from "./schema-system.js";

export const vocabularyLibraryFilterSchema = z.strictObject({
  search: z.string().max(500).default(""),
  filter: z.enum(["all", "candidate", "due", "active", "suspended"]).default("all"),
  sort: z.enum(["word", "due"]).default("word"),
  page: z.int().nonnegative().max(1_000_000).default(0),
});
export const vocabularyVersionSchema = z.strictObject({
  vocabularyId: vocabularyIdSchema,
  expectedRevision: z.int().nonnegative(),
  expectedUpdatedAt: utcInstantSchema,
});
export const vocabularyBulkRequestSchema = z.strictObject({
  rootGeneration: dataRootGenerationSchema,
  action: z.enum(["confirm", "suspend", "resume"]),
  entries: z
    .array(vocabularyVersionSchema)
    .min(1)
    .max(30)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.vocabularyId)).size === entries.length,
    ),
});
export const vocabularySummarySchema = z.strictObject({
  vocabularyId: vocabularyIdSchema,
  lemma: z.string().min(1).max(160).regex(/\S/u),
  meaning: z.string().min(1).max(500).regex(/\S/u),
  status: z.enum(["candidate", "active", "suspended"]),
  dueOn: calendarDateSchema.nullable(),
  revision: z.int().nonnegative(),
  updatedAt: utcInstantSchema,
});
export const vocabularyCountsSchema = z.strictObject({
  all: z.int().nonnegative(),
  candidate: z.int().nonnegative(),
  active: z.int().nonnegative(),
  suspended: z.int().nonnegative(),
  due: z.int().nonnegative(),
});
