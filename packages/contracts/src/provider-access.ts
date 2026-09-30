import { generationKindSchema } from "./generation.js";
import { aiRouteSchema } from "./ai-connections.js";
import { z } from "./schema-system.js";

// Configured routes may be unavailable. Provider access is separate from local
// learner identity and does not imply a Nina account, plan or entitlement.
export const providerRouteIdSchema = aiRouteSchema;
export const providerOperationSchema = z.union([generationKindSchema, z.literal("voice-handoff")]);
export const providerAccessReasonSchema = z.enum([
  "connection-required",
  "runtime-unavailable",
  "account-required",
  "account-unavailable",
  "credential-required",
  "secure-storage-unavailable",
  "capability-unavailable",
  "model-unavailable",
  "plugin-required",
]);
export const providerAccessSchema = z.discriminatedUnion("status", [
  z.strictObject({
    routeId: providerRouteIdSchema,
    operation: providerOperationSchema,
    status: z.literal("available"),
    modelSelection: z
      .strictObject({ modelId: z.string().min(1).max(200), effortId: z.string().min(1).max(100) })
      .nullable(),
  }),
  z.strictObject({
    routeId: providerRouteIdSchema.nullable(),
    operation: providerOperationSchema,
    status: z.literal("unavailable"),
    reason: providerAccessReasonSchema,
  }),
]);
export type ProviderOperation = z.infer<typeof providerOperationSchema>;
export type ProviderAccess = z.infer<typeof providerAccessSchema>;
