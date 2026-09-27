import { z } from "./schema-system.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const runtimeId = (maximum = 200) => text(maximum).regex(/^[A-Za-z0-9._:/-]+$/u);

export const accountStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("signed-out") }),
  z.strictObject({ status: z.literal("signed-in"), planType: text(100).nullable() }),
  z.strictObject({ status: z.literal("expired"), planType: text(100).nullable() }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["runtime-not-ready", "account-read-failed"]),
  }),
  z.strictObject({
    status: z.literal("unsupported"),
    reason: z.enum(["authentication-method", "account-shape"]),
  }),
]);

const modelUpgradeSchema = z.strictObject({
  targetModelId: runtimeId(),
  displayName: text(200).nullable(),
  description: text(500).nullable(),
});

export const modelCatalogSchema = z.strictObject({
  models: z
    .array(
      z.strictObject({
        id: runtimeId(),
        displayName: text(200),
        isDefault: z.boolean(),
        defaultReasoningEffort: runtimeId(100).nullable(),
        supportedReasoningEfforts: z.array(runtimeId(100)).max(20),
        inputModalities: z
          .array(z.enum(["text", "image"]))
          .min(1)
          .max(2),
        upgrade: modelUpgradeSchema.nullable().default(null),
      }),
    )
    .max(200),
  runtimeDefaultModelId: runtimeId().nullable(),
  missingReasoningMetadata: z.array(runtimeId()).max(200),
});

const rateLimitWindowSchema = z.strictObject({
  usedPercent: z.number().min(0).max(100).nullable(),
  resetsAt: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  windowDurationMinutes: z.int().positive().max(525_600).nullable().default(null),
});
const rateLimitCreditsSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unavailable") }),
  z.strictObject({
    status: z.literal("available"),
    availableCount: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
]);
const rateLimitBucketSchema = z.strictObject({
  limitId: runtimeId(100),
  planType: text(100).nullable(),
  primary: rateLimitWindowSchema.nullable(),
  secondary: rateLimitWindowSchema.nullable(),
});
const rateLimitBucketsSchema = z.array(rateLimitBucketSchema).max(20);

export const rateLimitStateSchema = z.union([
  z.strictObject({
    status: z.literal("available").default("available"),
    buckets: rateLimitBucketsSchema,
    resetCredits: rateLimitCreditsSchema.default({ status: "unavailable" }),
  }),
  z.strictObject({
    status: z.literal("limited"),
    reached: z.enum(["primary", "secondary", "both", "unknown"]),
    buckets: rateLimitBucketsSchema,
    resetCredits: rateLimitCreditsSchema.default({ status: "unavailable" }),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["runtime-not-ready", "not-reported", "read-failed"]),
  }),
]);
