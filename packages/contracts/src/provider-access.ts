import { generationKindSchema } from "./generation.js";
import { z } from "./schema-system.js";

// Only implemented routes belong here. Provider access is separate from local
// learner identity and does not imply a Nina account, plan or entitlement.
export const providerRouteIdSchema = z.literal("codex");
export const providerOperationSchema = z.union([generationKindSchema, z.literal("voice-handoff")]);
export const providerAccessReasonSchema = z.enum([
  "runtime-unavailable",
  "account-required",
  "account-unavailable",
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
    routeId: providerRouteIdSchema,
    operation: providerOperationSchema,
    status: z.literal("unavailable"),
    reason: providerAccessReasonSchema,
  }),
]);
export type ProviderOperation = z.infer<typeof providerOperationSchema>;
export type ProviderAccess = z.infer<typeof providerAccessSchema>;
