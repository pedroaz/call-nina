import { speechAccountSchema } from "./speech.js";
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
  tier: z.enum(["free", "plus"]),
  hostedAiEnabled: z.boolean(),
  speech: speechAccountSchema.default({
    enabled: false,
    remainingCharacters: 0,
    serviceEnabled: false,
  }),
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
  reason: z.enum([
    "none",
    "credentials",
    "rate-limit",
    "network",
    "additional-step",
    "username-taken",
    "password-policy",
    "unknown",
  ]),
});
export type NinaLoginDiagnostic = z.infer<typeof ninaLoginDiagnosticSchema>;

export const ninaLoginCredentialsSchema = z.strictObject({
  username: z.string().max(64),
  password: z.string().max(256),
});
export type NinaLoginCredentials = z.infer<typeof ninaLoginCredentialsSchema>;

export function ninaAuthFailure(cause: unknown): NinaLoginDiagnostic["reason"] {
  if (!cause || typeof cause !== "object") return "unknown";
  const errors: unknown[] =
    "errors" in cause && Array.isArray(cause.errors) ? cause.errors : [cause];
  for (const error of errors) {
    if (!error || typeof error !== "object" || !("code" in error)) continue;
    const code = String(error.code);
    if (code === "form_identifier_exists") return "username-taken";
    if (code.startsWith("form_password_"))
      return code === "form_password_incorrect" ? "credentials" : "password-policy";
    if (code === "form_identifier_not_found") return "credentials";
    if (code === "too_many_requests") return "rate-limit";
    if (code === "network_error") return "network";
    if (code === "additional-step") return "additional-step";
  }
  return "unknown";
}
