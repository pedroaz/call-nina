import { ControlError, config, clerkPolicy, read, output } from "./configuration.mjs";
import { need } from "./credentials.mjs";
import { verifiedRuntimeConnection } from "./runtime-role.mjs";
import { identity, project, clerk, vercel } from "./providers.mjs";
export async function apply(review) {
  if (JSON.stringify(await inspect()) !== JSON.stringify(review))
    throw new ControlError("Remote configuration changed after review; inspect again");
  const runtimeUrl = await verifiedRuntimeConnection();
  need("CLERK_SECRET_KEY");
  if ((await read("../../vercel.json")).git?.deploymentEnabled !== false)
    throw new ControlError("Automatic Git deployments must remain disabled");
  await identity();
  await project();
  await clerk("/instance", "PATCH", { allowed_origins: config.allowedOrigins });
  output({ completed: "Clerk origin update" });
  if ((await read("../../vercel.json")).git?.deploymentEnabled !== false)
    throw new ControlError("Automatic Git deployments must remain disabled");
  const secrets = {
    CLERK_SECRET_KEY: need("CLERK_SECRET_KEY"),
    NINA_STARTER_DATABASE_URL: runtimeUrl,
    NINA_STARTER_TEAM_ID: config.teamId,
    NINA_STARTER_ENABLED: "false",
  };
  await vercel(
    `/v10/projects/${config.projectId}/env?upsert=true`,
    "POST",
    Object.entries(secrets).map(([key, value]) => ({
      key,
      value,
      type: "encrypted",
      target: ["production"],
    })),
  );
  output({ completed: "Runtime environment upload", inferenceActivated: false });
  const environment = await vercel(`/v10/projects/${config.projectId}/env`);
  for (const [key, expected] of Object.entries(secrets)) {
    const entries = (environment.envs ?? []).filter(
      (entry) => entry.key === key && entry.target?.includes("production") && !entry.gitBranch,
    );
    if (entries.length !== 1 || entries[0].type !== "encrypted")
      throw new ControlError(`Vercel environment readback failed for ${key}`);
    const entry = await vercel(
      `/v1/projects/${config.projectId}/env/${encodeURIComponent(entries[0].id)}`,
    );
    if (entry.value !== expected)
      throw new ControlError(`Vercel value readback failed for ${key}; inspect before retrying`);
  }
  output({ completed: "Production runtime environment verified", valuesLogged: false });
  await project();
  const instance = await identity();
  if (!config.allowedOrigins.every((origin) => instance.allowed_origins?.includes(origin)))
    throw new ControlError("Clerk allowed-origin readback failed");
  return output({ applied: true, inferenceActivated: false });
}
export async function plan() {
  const { inferencePlan } = await import("./inference-plan.mjs");
  return {
    configuration: config,
    clerkRequirements: clerkPolicy.requirements,
    clerkSetup: {
      mode: "existing-instance-only",
      api: clerkPolicy.configuration,
      verified: false,
    },
    missing: [
      !config.teamId && "teamId",
      !config.origin && "origin",
      !config.clerkIssuer && "clerkIssuer",
      !config.publishableKey && "publishableKey",
      !config.clerkInstanceId && "clerkInstanceId",
    ].filter(Boolean),
    databaseSetup: {
      source: "Existing Vercel Marketplace database",
      parameters: ["PGHOST", "PGHOST_UNPOOLED", "PGUSER", "PGDATABASE", "PGPASSWORD"],
      additionalRuntimeSecret: "NINA_DATABASE_RUNTIME_PASSWORD",
      permissionsVerified: false,
      createsProviderResources: false,
    },
    inference: inferencePlan(),
    separateOperations: [
      "infra clerk-inspect",
      "infra clerk-apply",
      "infra apply",
      "infra database-connect",
      "infra database-check",
      "infra migrate",
      "infra runtime-setup",
      "infra configure-client",
      "deploy",
    ],
    inferenceActivated: false,
  };
}
export async function inspect() {
  const [instance, remote] = await Promise.all([identity(), project()]);
  const env = await vercel(`/v10/projects/${config.projectId}/env`);
  return {
    target: {
      clerkInstanceId: instance.id,
      vercelProjectId: remote.id,
      teamId: remote.accountId,
      environment: "production",
    },
    clerkInstanceVerified: true,
    allowedOrigins: { current: instance.allowed_origins ?? [], desired: config.allowedOrigins },
    runtimeEnvironment: [
      "CLERK_SECRET_KEY",
      "NINA_STARTER_DATABASE_URL",
      "NINA_STARTER_TEAM_ID",
      "NINA_STARTER_ENABLED",
    ].map((key) => ({
      key,
      operation: (env.envs ?? []).some(
        (entry) => entry.key === key && entry.target?.includes("production"),
      )
        ? "upsert (secret values not compared)"
        : "create",
      ...(key === "NINA_STARTER_ENABLED" ? { desired: "false" } : {}),
    })),
    missing: [
      !config.clerkIssuer && "clerkIssuer",
      !config.publishableKey && "publishableKey",
      !config.origin && "origin",
    ].filter(Boolean),
    automaticGitDeployments: "remain disabled",
  };
}
