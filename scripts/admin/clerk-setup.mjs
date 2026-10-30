import { writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  ControlError,
  config,
  clerkPolicy,
  environment,
  here,
  read,
  output,
} from "./configuration.mjs";
import { clerk, identity } from "./providers.mjs";
import { need } from "./credentials.mjs";
import { confirm } from "./review.mjs";

export async function linkExisting(yes) {
  const selected = {
    clerkInstanceId: need("CLERK_INSTANCE_ID"),
    clerkIssuer: need("CLERK_ISSUER_URL"),
    publishableKey: need("CLERK_PUBLISHABLE_KEY"),
  };
  if (!/^ins_[A-Za-z0-9]+$/.test(selected.clerkInstanceId ?? ""))
    throw new ControlError("Invalid existing instance ID");
  let issuer;
  try {
    issuer = new URL(selected.clerkIssuer);
  } catch {
    throw new ControlError("Provide a valid HTTPS Clerk Frontend API URL");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.pathname !== "/"
  )
    throw new ControlError(
      "Use the Clerk HTTPS Frontend API origin, without a path or credentials",
    );
  selected.clerkIssuer = issuer.origin;
  const key = /^(pk_(test|live)_)([A-Za-z0-9=]+)$/.exec(selected.publishableKey ?? "");
  if (!key) throw new ControlError("Invalid publishable key");
  if (key[2] !== (environment === "production" ? "live" : "test"))
    throw new ControlError("Clerk key does not match the selected environment");
  if (Buffer.from(key[3], "base64").toString("utf8") !== `${issuer.host}$`)
    throw new ControlError("Publishable key does not match the Clerk issuer URL");
  if (!need("CLERK_SECRET_KEY").startsWith(`sk_${key[2]}_`))
    throw new ControlError(
      "Secret and publishable keys must use the same development/production environment",
    );
  await identity(selected.clerkInstanceId);
  const response = await clerk("/domains");
  const domains = Array.isArray(response) ? response : response.data;
  if (
    !domains?.some(
      (domain) =>
        domain.frontend_api_url === issuer.host || domain.frontend_api_url === issuer.origin,
    )
  )
    throw new ControlError("Issuer URL is not a domain of the selected Clerk instance");
  await confirm(
    {
      operation: "Link existing Clerk instance locally",
      ...selected,
      createsInstance: false,
      authenticationRequirements: clerkPolicy.requirements,
      note: clerkPolicy.configuration,
    },
    yes,
  );
  const prior = await read("infrastructure.json");
  if (JSON.stringify(prior[environment]) !== JSON.stringify(config))
    throw new ControlError("Infrastructure settings changed; restart the command before saving");
  const next = { ...config, ...selected };
  prior[environment] = next;
  const temporary = new URL(`.infrastructure-${randomUUID()}.tmp`, here);
  try {
    await writeFile(temporary, JSON.stringify(prior, null, 2) + "\n", { flag: "wx" });
    await rename(temporary, new URL("infrastructure.json", here));
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  Object.assign(config, next);
  output({
    linked: true,
    clerkInstanceId: selected.clerkInstanceId,
    remoteSettingsChanged: false,
    next: "Run infra clerk-inspect, then infra clerk-apply for API configuration. Run infra configure-client separately after setting the Nina service origin and Vercel team.",
    inferenceActivated: false,
  });
}
