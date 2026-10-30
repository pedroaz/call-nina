import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const hostingEnvironments = ["preview", "production"];

export function hostingEnvironment(value = process.env.NINA_ENVIRONMENT) {
  if (!hostingEnvironments.includes(value))
    throw new Error("Select NINA_ENVIRONMENT=preview or production");
  return value;
}

export function clientConfigurationPath(environment = hostingEnvironment()) {
  return fileURLToPath(
    new URL(
      `../../packages/contracts/src/nina-public.${hostingEnvironment(environment)}.json`,
      import.meta.url,
    ),
  );
}

export function clientConfigurationAlias() {
  return {
    find: /^.*\/nina-public\.json$/,
    replacement: clientConfigurationPath(),
  };
}

export function requireClientConfiguration(environment = hostingEnvironment()) {
  const configuration = JSON.parse(readFileSync(clientConfigurationPath(environment), "utf8"));
  const profile = JSON.parse(
    readFileSync(new URL("../admin/infrastructure.json", import.meta.url), "utf8"),
  )[environment];
  const prefix = environment === "production" ? "pk_live_" : "pk_test_";
  if (
    configuration.environment !== environment ||
    !configuration.publishableKey?.startsWith(prefix) ||
    !configuration.serviceOrigin?.startsWith("https://") ||
    configuration.serviceOrigin !== profile.origin ||
    configuration.publishableKey !== profile.publishableKey ||
    !profile.projectId ||
    !profile.teamId
  )
    throw new Error(`Configure the ${environment} Clerk instance and client before building`);
  return configuration;
}
