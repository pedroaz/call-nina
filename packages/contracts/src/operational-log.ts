import { correlationIdSchema } from "./common.js";
import { strictBoundaryObject, z } from "./schema-system.js";

export const operationalLogSeveritySchema = z.enum(["debug", "info", "warn", "error"]);
export const operationalLogComponentSchema = z.enum([
  "lifecycle",
  "desktop",
  "renderer",
  "persistence",
  "app-server",
  "mcp",
  "plugin",
  "build",
  "packaging",
  "electron",
]);
export const operationalLogPhaseSchema = z.enum([
  "received",
  "started",
  "queued",
  "running",
  "validating",
  "persisting",
  "completed",
  "cancelled",
  "failed",
]);
export const operationalLogOutcomeSchema = z.enum([
  "ok",
  "rejected",
  "cancelled",
  "rate-limited",
  "error",
]);

const safeValueSchema = z.union([z.string().min(1).max(200), z.number(), z.boolean(), z.null()]);

export const operationalLogRecordSchema = strictBoundaryObject({
  timestamp: z.iso.datetime({ offset: false, precision: 3 }),
  severity: operationalLogSeveritySchema,
  component: operationalLogComponentSchema,
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,96}$/u),
  message: z
    .string()
    .min(1)
    .max(400)
    .regex(/^[^\r\n]+$/u),
  runId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .optional(),
  sessionId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .optional(),
  correlationId: correlationIdSchema.optional(),
  action: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._/-]*$/u)
    .optional(),
  phase: operationalLogPhaseSchema.optional(),
  outcome: operationalLogOutcomeSchema.optional(),
  durationMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  metadata: z.record(z.string().min(1).max(80), safeValueSchema).optional(),
});

export type OperationalLogRecord = Readonly<z.infer<typeof operationalLogRecordSchema>>;
