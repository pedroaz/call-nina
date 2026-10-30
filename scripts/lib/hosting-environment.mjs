import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const hostingEnvironments = ["dev", "prd"];

export function hostingEnvironment(value = process.env.NINA_ENVIRONMENT) {
  if (!hostingEnvironments.includes(value)) throw new Error("Select NINA_ENVIRONMENT=dev or prd");
  return value;
}

// Provider labels are translated only at the Vercel boundary.
export function vercelEnvironment(environment = hostingEnvironment()) {
  return hostingEnvironment(environment) === "prd" ? "production" : "preview";
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
  const prefix = environment === "prd" ? "pk_live_" : "pk_test_";
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

function desktopBuildConfiguration(environment) {
  return {
    version: JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
      .version,
    client: requireClientConfiguration(environment),
  };
}

export function desktopEnvironmentPlugin() {
  const configuration = desktopBuildConfiguration(hostingEnvironment());
  return {
    name: "nina-desktop-environment",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "nina-environment.json",
        source: JSON.stringify(configuration) + "\n",
      });
    },
  };
}

export function requireDesktopBuildEnvironment(environment) {
  const expected = desktopBuildConfiguration(hostingEnvironment(environment));
  for (const part of ["main", "renderer"]) {
    let actual;
    try {
      actual = JSON.parse(
        readFileSync(
          new URL(`../../apps/desktop/dist/${part}/nina-environment.json`, import.meta.url),
          "utf8",
        ),
      );
    } catch {
      throw new Error(`Desktop ${part} build has no environment marker; run make ${environment}`);
    }
    if (!isDeepStrictEqual(actual, expected))
      throw new Error(
        `Desktop ${part} build is stale or targets another environment; run make ${environment}`,
      );
  }
}
