import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { hostingEnvironment, hostingEnvironments } from "../lib/hosting-environment.mjs";
export class ControlError extends Error {}
export const here = new URL("./", import.meta.url);
export const root = new URL("../../", here);
export const read = async (name) => JSON.parse(await readFile(new URL(name, here), "utf8"));
const flag = process.argv.indexOf("--environment");
const selected = flag === -1 ? process.env.NINA_ENVIRONMENT : process.argv[flag + 1];
export const selectionError =
  flag !== -1 && process.env.NINA_ENVIRONMENT && selected !== process.env.NINA_ENVIRONMENT
    ? "Environment flag conflicts with NINA_ENVIRONMENT"
    : selected !== undefined && !hostingEnvironments.includes(selected)
      ? "Select --environment preview or production"
      : null;
export const environment = hostingEnvironments.includes(selected) ? selected : undefined;
export const infrastructure = await read("infrastructure.json");
export const config = environment ? infrastructure[environment] : undefined;
export const clerkPolicy = await read("clerk-policy.json");
const desired = await read("../../apps/api/desired.json");
export const results = [];
export const output = (value) => results.push(value);
const runtimeKeys = ["projectId", "teamId", "origin", "clerkIssuer", "allowedOrigins"];
export function publicConfiguration(selectedEnvironment = environment) {
  const name = hostingEnvironment(selectedEnvironment);
  const profile = infrastructure[name];
  for (const key of ["origin", "clerkIssuer"]) {
    if (profile[key] !== null) {
      let url;
      try {
        url = new URL(profile[key]);
      } catch {
        throw new ControlError(`Invalid ${key}`);
      }
      if (url.protocol !== "https:" || url.origin !== profile[key])
        throw new ControlError(`Invalid ${key}`);
    }
  }
  const prefix = name === "production" ? "live" : "test";
  if (
    profile.publishableKey !== null &&
    !new RegExp(`^pk_${prefix}_[A-Za-z0-9=]+$`).test(profile.publishableKey)
  )
    throw new ControlError(`Clerk publishable key does not match ${name}`);
  const policy = desired[name];
  return {
    runtime: {
      environment: name,
      ...Object.fromEntries(runtimeKeys.map((key) => [key, profile[key]])),
    },
    client: {
      environment: name,
      publishableKey: profile.publishableKey,
      serviceOrigin: profile.origin,
      modelId: policy.enabled ? policy.policy.model.id : null,
    },
  };
}
export async function configureClient() {
  const runtime = {};
  for (const name of hostingEnvironments) {
    const values = publicConfiguration(name);
    runtime[name] = values.runtime;
    await writeFile(
      new URL(`packages/contracts/src/nina-public.${name}.json`, root),
      JSON.stringify(values.client, null, 2) + "\n",
    );
  }
  await writeFile(new URL("apps/api/runtime.json", root), JSON.stringify(runtime, null, 2) + "\n");
  output({
    clientConfigured: true,
    runtimeConfigured: true,
    rebuildRequired: true,
    inferenceActivated: false,
  });
}
export async function checkPublicConfiguration(selectedEnvironment = environment) {
  const name = hostingEnvironment(selectedEnvironment);
  const profile = infrastructure[name];
  if (
    !profile.projectId ||
    !profile.teamId ||
    !profile.clerkInstanceId ||
    !profile.clerkIssuer ||
    !profile.publishableKey
  )
    throw new ControlError(`Complete the ${name} infrastructure profile before building`);
  const values = publicConfiguration(name);
  const runtime = await read("../../apps/api/runtime.json");
  const client = await read(`../../packages/contracts/src/nina-public.${name}.json`);
  if (
    !isDeepStrictEqual(runtime[name], values.runtime) ||
    !isDeepStrictEqual(client, values.client)
  )
    throw new ControlError(
      "Generated public configuration is stale; run infra configure-client for the selected environment",
    );
  const other = infrastructure[name === "production" ? "preview" : "production"];
  if (
    profile.clerkInstanceId === other.clerkInstanceId ||
    profile.clerkIssuer === other.clerkIssuer
  )
    throw new ControlError("Preview and production must use separate Clerk instances");
}
