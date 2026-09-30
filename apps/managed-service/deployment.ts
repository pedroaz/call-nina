import { z } from "@call-nina/contracts";
import { servicePolicySchema } from "@call-nina/managed-generation/server";
import desired from "./desired.json" with { type: "json" };

export const activeDeploymentSchema = z.strictObject({
  enabled: z.literal(true),
  projectId: z.string().regex(/^prj_[a-zA-Z0-9]+$/u),
  teamId: z.string().regex(/^team_[a-zA-Z0-9]+$/u),
  origin: z.url().startsWith("https://"),
  // Maintainer-approved evidence for a dedicated Gateway scope without cached
  // BYOK keys, automatic funding top-ups, prompt logging or another proxy hop.
  approvalReference: z.url().startsWith("https://"),
  boundary: z.literal("vercel-direct-no-trusted-proxy"),
  funding: z.literal("isolated-gateway-system-credits-only"),
  policy: servicePolicySchema,
});
export function selectedDeployment(environment: NodeJS.ProcessEnv) {
  if (
    environment["VERCEL"] !== "1" ||
    !["preview", "production"].includes(environment["VERCEL_ENV"] ?? "")
  )
    return null;
  const name = environment["VERCEL_ENV"] as "preview" | "production";
  const parsed = activeDeploymentSchema.safeParse(desired[name]);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (
    value.policy.environment !== name ||
    value.projectId !== environment["VERCEL_PROJECT_ID"] ||
    value.teamId !== environment["NINA_STARTER_TEAM_ID"] ||
    environment["NINA_STARTER_ENABLED"] !== "true" ||
    new URL(value.origin).origin !== value.origin
  )
    return null;
  return value;
}
