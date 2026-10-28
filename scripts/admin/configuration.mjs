import { readFile, writeFile } from "node:fs/promises";
export class ControlError extends Error {}
export const here = new URL("./", import.meta.url);
export const root = new URL("../../", here);
export const read = async (name) => JSON.parse(await readFile(new URL(name, here), "utf8"));
export const config = await read("infrastructure.json");
export const clerkPolicy = await read("clerk-policy.json");
const desired = await read("../../apps/api/desired.json");
export const results = [];
export const output = (value) => results.push(value);
const runtimeKeys = ["projectId", "teamId", "origin", "clerkIssuer", "allowedOrigins"];
export function publicConfiguration() {
  for (const key of ["origin", "clerkIssuer"]) {
    if (config[key] !== null) {
      let url;
      try {
        url = new URL(config[key]);
      } catch {
        throw new ControlError(`Invalid ${key}`);
      }
      if (url.protocol !== "https:" || url.origin !== config[key])
        throw new ControlError(`Invalid ${key}`);
    }
  }
  if (
    config.publishableKey !== null &&
    !/^pk_(test|live)_[A-Za-z0-9=]+$/.test(config.publishableKey)
  )
    throw new ControlError("Invalid Clerk publishable key");
  return {
    runtime: Object.fromEntries(runtimeKeys.map((key) => [key, config[key]])),
    client: {
      publishableKey: config.publishableKey,
      serviceOrigin: config.origin,
      modelId: desired.production.enabled ? desired.production.policy.model.id : null,
    },
  };
}
export async function configureClient() {
  const values = publicConfiguration();
  if (!config.publishableKey || !config.origin || !config.clerkIssuer || !config.teamId)
    throw new ControlError("Set public Clerk key, issuer, service origin and team first");
  await writeFile(
    new URL("apps/api/runtime.json", root),
    JSON.stringify(values.runtime, null, 2) + "\n",
  );
  await writeFile(
    new URL("packages/contracts/src/nina-public.json", root),
    JSON.stringify(values.client, null, 2) + "\n",
  );
  output({
    clientConfigured: true,
    runtimeConfigured: true,
    rebuildRequired: true,
    inferenceActivated: false,
  });
}
export async function checkPublicConfiguration() {
  const values = publicConfiguration();
  for (const [file, expected] of [
    ["apps/api/runtime.json", values.runtime],
    ["packages/contracts/src/nina-public.json", values.client],
  ]) {
    const actual = JSON.parse(await readFile(new URL(file, root), "utf8"));
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new ControlError(
        "Generated public configuration is stale; run node scripts/admin/index.mjs infra configure-client",
      );
  }
}
