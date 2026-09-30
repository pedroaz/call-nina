import { z } from "./schema-system.js";
import { modelCatalogSchema } from "./app-server-state.js";
import { languageSchema } from "./learning-context.js";

export const offlineOperationSchema = z.enum(["writing-prompt", "contextual-help"]);
export const offlinePreflightSchema = z.strictObject({
  platformSupported: z.boolean(),
  totalMemoryBytes: z.int().nonnegative(),
  freeMemoryBytes: z.int().nonnegative(),
  availableDiskBytes: z.int().nonnegative().nullable(),
  requiredDiskBytes: z.int().nonnegative(),
  memorySufficient: z.boolean(),
  diskSufficient: z.boolean(),
  hardwareVerified: z.literal(false),
});
export const offlineSnapshotSchema = z.strictObject({
  candidateId: z.string().min(1).max(100),
  modelId: z.string().min(1).max(100),
  quality: z.literal("unverified"),
  platform: z.literal("linux-x64"),
  state: z.enum([
    "absent",
    "partial",
    "installed",
    "downloading",
    "verifying",
    "generating",
    "removing",
    "unavailable",
  ]),
  downloadedBytes: z.int().nonnegative(),
  downloadBytes: z.int().positive(),
  errorCode: z
    .string()
    .regex(/^OD_OFFLINE_[A-Z_]+$/u)
    .max(100)
    .nullable(),
  preflight: offlinePreflightSchema.nullable(),
});
export const offlineCatalogSchema = z.strictObject({
  routeId: z.literal("local"),
  quality: z.literal("unverified"),
  nativeExecution: z.literal("unverified"),
  license: z.literal("Apache-2.0"),
  platform: z.literal("linux-x64"),
  models: modelCatalogSchema,
  operations: z.array(offlineOperationSchema).max(2),
  languages: z.array(languageSchema).max(4),
  contextTokens: z.int().positive(),
  outputTokens: z.int().positive(),
  maximumRequestBytes: z.int().positive(),
  admissionMemoryBytes: z.int().positive(),
  admissionFreeMemoryBytes: z.int().positive(),
});
export const offlineModelViewSchema = z.strictObject({
  catalog: offlineCatalogSchema,
  snapshot: offlineSnapshotSchema,
});
// Device-owned, independent of the learner root. No paths, URLs or executables cross IPC.
export const offlineModelActionSchema = z.strictObject({
  action: z.enum(["install", "cancel", "remove"]),
});
export type OfflineSnapshot = z.infer<typeof offlineSnapshotSchema>;
export type OfflinePreflight = z.infer<typeof offlinePreflightSchema>;
