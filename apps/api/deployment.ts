import infrastructure from "./runtime.json" with { type: "json" };
import {
  openBudgetSql,
  type BudgetSql,
  servicePolicySchema,
} from "@call-nina/managed-generation/server";
import { z } from "@call-nina/contracts";
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

const infrastructureSchema = z.object({
  projectId: z.string(),
  teamId: z.string(),
  origin: z.url(),
  clerkIssuer: z.url(),
  allowedOrigins: z.array(z.string()).min(1),
});
export function accountDeployment(environment: NodeJS.ProcessEnv) {
  const parsed = infrastructureSchema.safeParse(infrastructure);
  if (
    !parsed.success ||
    environment["VERCEL"] !== "1" ||
    environment["VERCEL_ENV"] !== "production" ||
    environment["VERCEL_PROJECT_ID"] !== parsed.data.projectId ||
    environment["NINA_STARTER_TEAM_ID"] !== parsed.data.teamId ||
    !environment["CLERK_SECRET_KEY"]
  )
    return null;
  const config = parsed.data;
  if (new URL(config.origin).origin !== config.origin || !config.origin.startsWith("https://"))
    return null;
  return {
    origin: config.origin,
    auth: {
      secretKey: environment["CLERK_SECRET_KEY"],
      issuer: config.clerkIssuer,
      authorizedParties: config.allowedOrigins,
    },
  };
}
let database: ReturnType<typeof openBudgetSql> | undefined;
export function accountSql(): BudgetSql {
  if (!database)
    database = openBudgetSql(z.string().min(1).parse(process.env["NINA_STARTER_DATABASE_URL"]));
  return database;
}

// Keep snapshot transfers from occupying the account/generation connection pool.
let mobileDatabase: ReturnType<typeof openBudgetSql> | undefined;
export function mobileSql(): BudgetSql {
  mobileDatabase ??= openBudgetSql(
    z.string().min(1).parse(process.env["NINA_STARTER_DATABASE_URL"]),
    "mobile-sync",
  );
  return mobileDatabase;
}
