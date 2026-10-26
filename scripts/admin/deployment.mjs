import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { ControlError, config, root, output, checkPublicConfiguration } from "./configuration.mjs";
import { childEnvironment } from "./credentials.mjs";
import { project } from "./providers.mjs";
export function runNode(file, args = []) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: root,
    stdio: ["ignore", 2, 2],
    env: childEnvironment(),
  });
  if (result.error || result.status !== 0)
    throw new ControlError("Local command failed; no deployment performed");
}
export async function deploy() {
  await project();
  await checkPublicConfiguration();
  runNode("scripts/build/package-hosting.mjs");
  for (const name of ["account", "generate"]) {
    const metadata = JSON.parse(
      await readFile(
        new URL(`build/hosting/.vercel/output/functions/api/${name}.func/.vc-config.json`, root),
        "utf8",
      ),
    );
    if (metadata.handler !== "index.mjs") throw new ControlError("Incomplete combined artifact");
  }
  const routes = JSON.parse(
    await readFile(new URL("build/hosting/.vercel/output/config.json", root), "utf8"),
  );
  if (routes.version !== 3 || !routes.routes.some((route) => route.handle === "filesystem"))
    throw new ControlError("Invalid combined routing");
  await readFile(new URL("build/hosting/.vercel/output/static/index.html", root));
  const child = spawnSync(
    "vercel",
    [
      "deploy",
      "--cwd",
      "build/hosting",
      "--project",
      config.projectId,
      "--scope",
      config.teamId,
      "--prebuilt",
      "--prod",
      "--non-interactive",
    ],
    {
      cwd: root,
      stdio: ["ignore", 2, 2],
      // Publishing uses the operator's `vercel login` session. The API token in
      // .env is for bounded admin API calls and may not support CLI user lookup.
      env: childEnvironment({ VERCEL_TELEMETRY_DISABLED: "1" }),
    },
  );
  if (child.error || child.status !== 0)
    throw new ControlError("Deployment failed; inspect Vercel before retrying");
  output({ deployed: true, inferenceActivated: false });
}
