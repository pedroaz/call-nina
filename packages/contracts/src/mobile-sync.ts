import { z } from "./schema-system.js";
import { activityIdSchema, utcInstantSchema } from "./common.js";
import { portableFlashcardContentSchema } from "./flashcards.js";
export const mobileChunkBytes = 1024 * 1024;
export const mobileSnapshotBytes = 100 * mobileChunkBytes;
export const mobileHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const mobileDeckSchema = z.strictObject({
  activityId: activityIdSchema,
  title: z.string().min(1).max(160),
  content: portableFlashcardContentSchema,
});
export const mobileSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    createdAt: utcInstantSchema,
    decks: z.array(mobileDeckSchema).max(100_000),
  })
  .refine((s) => new Set(s.decks.map((d) => d.activityId)).size === s.decks.length);
export const mobileManifestSchema = z
  .strictObject({
    id: z.uuid(),
    byteLength: z.int().positive().max(mobileSnapshotBytes),
    sha256: mobileHashSchema,
    chunkHashes: z.array(mobileHashSchema).min(1).max(100),
  })
  .refine((m) => m.chunkHashes.length === Math.ceil(m.byteLength / mobileChunkBytes));
export const mobilePublishedSchema = z.strictObject({
  manifest: mobileManifestSchema,
  publishedAt: utcInstantSchema,
});
export const mobileRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("begin"), manifest: mobileManifestSchema }),
  z.strictObject({
    action: z.literal("chunk"),
    id: z.uuid(),
    index: z.int().min(0).max(99),
    data: z
      .string()
      .max(1_398_104)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  }),
  z.strictObject({ action: z.literal("commit"), id: z.uuid() }),
]);
export const mobileSyncResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("empty") }),
  z.strictObject({ status: z.literal("synced"), publishedAt: utcInstantSchema }),
  z.strictObject({
    status: z.literal("failed"),
    reason: z.enum(["sign-in", "unavailable", "too-large", "changed", "busy"]),
  }),
]);
export type MobileSnapshot = z.infer<typeof mobileSnapshotSchema>;
export type MobileDeck = z.infer<typeof mobileDeckSchema>;
export type MobileManifest = z.infer<typeof mobileManifestSchema>;
export type MobilePublished = z.infer<typeof mobilePublishedSchema>;
