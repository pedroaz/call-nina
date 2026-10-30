import { z } from "./schema-system.js";
import { languageSchema } from "./learning-context.js";

export const speechSourceSchema = z.enum(["piper", "pocket", "managed"]);
export const speechTextSchema = z
  .string()
  .min(1)
  .max(12000)
  .refine((text) => /\S/u.test(text) && Array.from(text).length <= 6000);
export const speechPreferencesSchema = z.strictObject({
  de: speechSourceSchema,
  "en-US": speechSourceSchema,
  "pt-BR": speechSourceSchema,
  es: speechSourceSchema,
});
export const defaultSpeechPreferences = {
  de: "piper",
  "en-US": "piper",
  "pt-BR": "piper",
  es: "piper",
} as const;
export const speechRequestSchema = z.strictObject({
  id: z.uuid(),
  language: languageSchema,
  text: speechTextSchema,
});
export const speechActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("preferences"), preferences: speechPreferencesSchema }),
  z.strictObject({
    action: z.enum(["install", "remove", "cancel-download"]),
    packId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/u),
  }),
  z.strictObject({
    action: z.enum(["download-course", "remove-course"]),
    courseId: z.string().min(1).max(200),
  }),
  z.strictObject({
    action: z.enum(["clear-cache", "clear-private-cache", "cancel-course"]),
  }),
  z.strictObject({ action: z.literal("cancel"), id: z.uuid().optional() }),
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const speechManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  curriculumDigest: digest,
  clips: z
    .array(
      z.strictObject({
        id: digest,
        textDigest: digest,
        synthesisVersion: z.string().min(1).max(150),
        references: z.array(z.string().min(1).max(500)).min(1),
        language: languageSchema,
        voice: z.string().min(1).max(150),
        url: z.url().regex(/^https:\/\/[a-zA-Z0-9-]+\.public\.blob\.vercel-storage\.com\//u),
        sha256: digest,
        bytes: z.int().positive().max(20_000_000),
        durationMs: z.int().positive(),
        courses: z.array(z.string().min(1).max(200)).min(1),
      }),
    )
    .max(100000),
});
export const speechSnapshotSchema = z.strictObject({
  supported: z.boolean(),
  preferences: speechPreferencesSchema,
  cacheBytes: z.int().nonnegative(),
  privateBytes: z.int().nonnegative(),
  publicBytes: z.int().nonnegative(),
  modelBytes: z.int().nonnegative(),
  freeBytes: z.int().nonnegative(),
  cacheLimitBytes: z.literal(1_000_000_000),
  packs: z.array(
    z.strictObject({
      id: z.string(),
      engine: z.enum(["piper", "pocket"]),
      language: languageSchema,
      voice: z.string(),
      qualification: z.enum(["candidate", "qualified", "unavailable"]),
      unavailableReason: z.enum(["platform", "runtime", "qualification"]).nullable(),
      state: z.enum(["unavailable", "absent", "partial", "installed", "downloading", "update"]),
      downloadBytes: z.int().nonnegative(),
      downloadedBytes: z.int().nonnegative(),
      installedBytes: z.int().nonnegative(),
      diskBytes: z.int().nonnegative(),
      error: z.string().nullable(),
    }),
  ),
  courses: z.array(
    z.strictObject({
      id: z.string(),
      bytes: z.int().nonnegative(),
      downloadedBytes: z.int().nonnegative(),
      pinned: z.boolean(),
      hasDownload: z.boolean(),
      diskBytes: z.int().nonnegative(),
    }),
  ),
  downloadingCourse: z.string().nullable(),
  error: z.string().nullable(),
});
export const speechResultSchema = z.strictObject({
  clips: z.array(z.string().max(28_000_000)).max(12),
  mime: z.literal("audio/ogg"),
  source: z.enum(["curriculum", "cache", "piper", "pocket", "managed"]),
});
export const speechAccountSchema = z.strictObject({
  enabled: z.boolean(),
  remainingCharacters: z.int().nonnegative(),
  serviceEnabled: z.boolean(),
});
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export type SpeechPreferences = z.infer<typeof speechPreferencesSchema>;
export type SpeechSnapshot = z.infer<typeof speechSnapshotSchema>;
export type SpeechManifest = z.infer<typeof speechManifestSchema>;
export type SpeechAction = z.infer<typeof speechActionSchema>;
export type SpeechResult = z.infer<typeof speechResultSchema>;

export const waveNetVoices = {
  de: "de-DE-Wavenet-B",
  "en-US": "en-US-Wavenet-F",
  "pt-BR": "pt-BR-Wavenet-A",
  es: "es-ES-Wavenet-B",
} as const;

export const speechAvailabilitySchema = z.strictObject({
  available: z.boolean(),
  reason: z.enum(["ready", "offline", "model", "account", "allowance", "unavailable"]),
});
