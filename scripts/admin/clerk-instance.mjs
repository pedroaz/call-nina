import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { ControlError, config, clerkPolicy, output } from "./configuration.mjs";
import { need, secret, childEnvironment } from "./credentials.mjs";
import { clerk, identity } from "./providers.mjs";
import { confirm } from "./review.mjs";

// Official contract: https://github.com/clerk/openapi-specs/blob/main/platform/beta.yml
// Backend secret keys cannot authenticate the Platform API. Never fall back to one.
async function platform(path, method = "GET", body, headers) {
  // CLI owns OAuth refresh and storage. Never extract its tokens or inherit admin secrets.
  // The CLI does not expose If-Match; recheck the version immediately before a PATCH.
  if (headers?.["If-Match"]) {
    const current = await platform(path.split("?")[0]);
    if (current.config_version !== headers["If-Match"])
      throw new ControlError("Clerk configuration version changed; inspect again");
  }
  const args = [
    "--no-install",
    "clerk",
    "api",
    "--platform",
    `/platform${path}`,
    "--method",
    method,
  ];
  if (body !== undefined) args.push("--data", JSON.stringify(body), "--yes");
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    encoding: "utf8",
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024,
    env: childEnvironment({ CLERK_MODE: "agent" }),
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new ControlError(
      "Clerk CLI request failed; check npx clerk auth login and the selected application's access. No automatic mutation retry; inspect before retrying writes.",
    );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new ControlError(
      "Clerk CLI returned an unreadable response; inspect state before retrying writes",
    );
  }
}
function matches(current, desired) {
  if (desired && typeof desired === "object" && !Array.isArray(desired))
    return Object.entries(desired).every(([key, value]) => matches(current?.[key], value));
  return isDeepStrictEqual(current, desired);
}
const equalOrigins = (left, right) =>
  isDeepStrictEqual([...new Set(left)].sort(), [...new Set(right)].sort());

async function target() {
  const instance = await identity();
  const applicationId = need("CLERK_APPLICATION_ID");
  if (!/^app_[A-Za-z0-9]+$/.test(applicationId))
    throw new ControlError("Invalid CLERK_APPLICATION_ID");
  const application = await platform(`/applications/${applicationId}?include_secret_keys=false`);
  if (
    application.application_id !== applicationId ||
    !application.instances?.some((entry) => entry.instance_id === instance.id)
  )
    throw new ControlError("Selected Clerk application does not own the linked instance");
  return {
    instance,
    applicationId,
    path: `/applications/${applicationId}/instances/${instance.id}`,
  };
}

export async function inspectClerk() {
  const instance = await identity();
  const missing = ["CLERK_APPLICATION_ID"].filter((name) => !secret(name));
  const origins = {
    current: instance.allowed_origins ?? [],
    desired: config.allowedOrigins,
    verified: equalOrigins(instance.allowed_origins ?? [], config.allowedOrigins),
  };
  const base = {
    instanceId: instance.id,
    requirements: clerkPolicy.requirements,
    allowedOrigins: origins,
    passwordRecovery: "Administrator workflow: users reset-password",
    missing,
    authentication: "clerk-cli-session",
    concurrency: "version-check-before-write (CLI has no If-Match option)",
  };
  if (missing.length)
    return {
      ...base,
      verified: false,
      status: "platform-credentials-required",
      next: "Set CLERK_APPLICATION_ID in private root .env. Authenticate with npx clerk auth login.",
    };
  const selected = await target();
  const native = await platform(`${selected.path}/native_settings`);
  if (typeof native.api_enabled !== "boolean")
    throw new ControlError("Clerk Native API readback has an unsupported shape");
  const desired = clerkPolicy.platformConfig;
  if (
    !desired ||
    typeof desired !== "object" ||
    Array.isArray(desired) ||
    !Object.keys(desired).length
  )
    return {
      ...base,
      applicationId: selected.applicationId,
      nativeApi: { current: native.api_enabled, desired: true, verified: native.api_enabled },
      verified: false,
      status: "authentication-policy-mapping-required",
      next: "Run npx clerk config schema with the exact application and instance IDs and map all Nina authentication requirements to its supported keys in clerk-policy.json platformConfig; no configuration fields are guessed.",
    };
  const keys = Object.keys(desired);
  // Clerk hashes the selected projection: a filtered response has a different version.
  // Keep the full response in memory only to obtain the version used by PATCH.
  const current = await platform(`${selected.path}/config`);
  if (typeof current.config_version !== "string" || !current.config_version)
    throw new ControlError("Clerk configuration version is missing; refusing unversioned updates");
  // Values stay in memory. Reviews expose only changed key names, never raw provider config.
  const changedKeys = keys.filter((key) => !matches(current[key], desired[key]));
  return {
    ...base,
    applicationId: selected.applicationId,
    nativeApi: { current: native.api_enabled, desired: true, verified: native.api_enabled },
    configVersion: current.config_version,
    configuredKeys: keys,
    changedKeys,
    verified: !changedKeys.length && native.api_enabled && origins.verified,
    status: "inspected",
  };
}

export async function applyClerk(yes) {
  const review = await inspectClerk();
  if (review.status !== "inspected") {
    output(review);
    throw new ControlError("Clerk setup prerequisites incomplete; no remote settings changed");
  }
  const selected = await target();
  const desired = clerkPolicy.platformConfig;
  // Clerk validates its live schema and previews updates before any mutation.
  if (review.changedKeys.length) {
    const preview = await platform(`${selected.path}/config?dry_run=true`, "PATCH", desired, {
      "If-Match": review.configVersion,
    });
    if (preview.dry_run !== true)
      throw new ControlError("Clerk did not confirm dry-run mode; inspect state before proceeding");
  }
  await confirm({ operation: "infra clerk-apply", ...review, createsInstance: false }, yes);
  if (!isDeepStrictEqual(await inspectClerk(), review))
    throw new ControlError("Clerk settings changed after review; inspect again");
  if (review.changedKeys.length) {
    await platform(`${selected.path}/config`, "PATCH", desired, {
      "If-Match": review.configVersion,
    });
    output({ completed: "Clerk authentication configuration update" });
  }
  if (!review.nativeApi.verified) {
    await platform(`${selected.path}/native_settings`, "PATCH", { api_enabled: true });
    output({ completed: "Clerk Native API enabled" });
  }
  if (!review.allowedOrigins.verified) {
    await identity();
    await clerk("/instance", "PATCH", { allowed_origins: config.allowedOrigins });
    output({ completed: "Clerk renderer origins updated" });
  }
  const readback = await inspectClerk();
  output(readback);
  if (!readback.verified)
    throw new ControlError("Clerk settings readback differs from policy; inspect before retrying");
}
