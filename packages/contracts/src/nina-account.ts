import { z } from "./schema-system.js";
import configuration from "./nina-public.json" with { type: "json" };

export const ninaPublicConfiguration = z
  .strictObject({
    publishableKey: z
      .string()
      .regex(/^pk_(test|live)_/u)
      .nullable(),
    serviceOrigin: z
      .url()
      .startsWith("https://")
      .regex(/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/u)
      .nullable(),
    modelId: z.string().min(1).max(200).nullable(),
  })
  .parse(configuration);
export const ninaAccessSchema = z.strictObject({
  userId: z.string().min(1).max(256),
  hostedAiEnabled: z.boolean(),
  remainingActions: z.int().nonnegative(),
  inferenceEnabled: z.boolean(),
});
export const ninaAccountStateSchema = z.strictObject({
  status: z.enum(["signed-out", "signing-in", "signed-in", "expired", "unavailable"]),
  access: ninaAccessSchema.nullable(),
});
export const ninaAccountUpdateSchema = z.strictObject({
  status: z.enum(["signed-out", "signing-in", "signed-in", "expired", "unavailable"]),
  token: z.string().min(1).max(16000).nullable(),
});
export type NinaAccountState = z.infer<typeof ninaAccountStateSchema>;
export type NinaAccess = z.infer<typeof ninaAccessSchema>;

// Diagnostics accept fixed labels only, never provider messages or credentials.
export const ninaLoginDiagnosticSchema = z.strictObject({
  stage: z.enum(["initialization", "desktop", "credentials", "session", "cleanup", "storage"]),
  outcome: z.enum(["started", "completed", "slow", "failed"]),
  reason: z.enum(["none", "credentials", "rate-limit", "network", "additional-step", "unknown"]),
});
export type NinaLoginDiagnostic = z.infer<typeof ninaLoginDiagnosticSchema>;

export const ninaLoginCredentialsSchema = z.strictObject({
  username: z.string().max(64),
  password: z.string().max(256),
});
export type NinaLoginCredentials = z.infer<typeof ninaLoginCredentialsSchema>;
