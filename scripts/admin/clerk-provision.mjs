import { writeFile } from "node:fs/promises";
import { platform } from "./clerk-instance.mjs";
import {
  config,
  environment,
  infrastructure,
  here,
  output,
  ControlError,
} from "./configuration.mjs";
import { saveSecrets } from "./credentials.mjs";
import { confirm } from "./review.mjs";

export async function provisionClerk(yes) {
  const path = `/applications/${config.clerkApplicationId}`;
  const application = await platform(`${path}?include_secret_keys=false`);
  if (application.application_id !== config.clerkApplicationId)
    throw new ControlError("Clerk application identity mismatch");
  const type = environment === "production" ? "production" : "development";
  const instances = application.instances.filter((instance) => instance.environment_type === type);
  if (
    instances.length > 1 ||
    (config.clerkInstanceId && instances[0]?.instance_id !== config.clerkInstanceId)
  )
    throw new ControlError("Clerk instance identity mismatch");
  if (!instances.length && type !== "production")
    throw new ControlError(
      "Create the development instance in the selected Clerk application first",
    );
  await confirm(
    {
      operation: "infra clerk-provision",
      applicationId: application.application_id,
      environment,
      action: instances.length
        ? "link existing instance and securely save its keys"
        : "create production instance and securely save its keys",
      domain: type === "production" ? new URL(config.origin).hostname : null,
      importsUsers: false,
    },
    yes,
  );
  if (!instances.length)
    await platform(`${path}/instances`, "POST", {
      domain: new URL(config.origin).hostname,
      environment_type: "production",
    });
  const current = await platform(`${path}?include_secret_keys=true`);
  const instance = current.instances.find((entry) => entry.environment_type === type);
  const prefix = type === "production" ? "live" : "test";
  if (
    !instance?.secret_key?.startsWith(`sk_${prefix}_`) ||
    !instance.publishable_key?.startsWith(`pk_${prefix}_`)
  )
    throw new ControlError(
      "Clerk keys do not match the selected environment; inspect before retrying",
    );
  const host = Buffer.from(
    instance.publishable_key.replace(/^pk_(test|live)_/, ""),
    "base64",
  ).toString("utf8");
  if (!/^[a-zA-Z0-9.-]+\$$/.test(host))
    throw new ControlError("Invalid Clerk Frontend API hostname");
  const issuer = `https://${host.slice(0, -1)}`;
  await saveSecrets({
    CLERK_APPLICATION_ID: config.clerkApplicationId,
    CLERK_INSTANCE_ID: instance.instance_id,
    CLERK_ISSUER_URL: issuer,
    CLERK_PUBLISHABLE_KEY: instance.publishable_key,
    CLERK_SECRET_KEY: instance.secret_key,
  });
  Object.assign(config, {
    clerkInstanceId: instance.instance_id,
    clerkIssuer: issuer,
    publishableKey: instance.publishable_key,
  });
  await writeFile(
    new URL("infrastructure.json", here),
    JSON.stringify(infrastructure, null, 2) + "\n",
  );
  output({
    environment,
    applicationId: config.clerkApplicationId,
    instanceId: instance.instance_id,
    keysSaved: true,
    importsUsers: false,
  });
}
