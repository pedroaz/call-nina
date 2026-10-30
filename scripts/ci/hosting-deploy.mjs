import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  context,
  output,
  root,
  readJson,
  run,
  summary,
  setOutput,
  progress,
  diagnostic,
} from "./common.mjs";
import { hostingEnvironment } from "../lib/hosting-environment.mjs";
import { childEnvironment } from "../lib/environment.mjs";
import { verify } from "./artifacts.mjs";
import { checkPublicConfiguration } from "../admin/configuration.mjs";

export async function deploy() {
  const current = context("vercel");
  const environment = hostingEnvironment();
  const token = process.env.VERCEL_TOKEN;
  if (!token)
    throw new Error("Set the CI-compatible VERCEL_TOKEN secret in the matching GitHub environment");
  const manifest = await verify("hosting");
  const { projectId, teamId, origin } = (await readJson("scripts/admin/infrastructure.json"))[
    environment
  ];
  if (
    manifest.projectId !== projectId ||
    manifest.teamId !== teamId ||
    manifest.environment !== environment ||
    manifest.origin !== origin
  )
    throw new Error("Hosting artifact targets a different project");
  await checkPublicConfiguration(environment);
  async function api(endpoint, label, method = "GET", body) {
    const started = Date.now();
    progress(`${label}: started`);
    const url = new URL(`https://api.vercel.com/${endpoint}`);
    url.searchParams.set("teamId", teamId);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new Error(`${label}: network failure (${diagnostic(error.cause?.code ?? error.name)})`);
    }
    const details = `HTTP ${response.status}; elapsed=${Date.now() - started}ms; request=${diagnostic(response.headers.get("x-vercel-id") ?? "unavailable")}`;
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        `${label}: ${details}; code=${diagnostic(payload?.error?.code ?? "unknown")}; ${diagnostic(payload?.error?.message ?? "No JSON error message")}`,
      );
    if (!payload) throw new Error(`${label}: invalid JSON response; ${details}`);
    progress(`${label}: succeeded (${details})`);
    return payload;
  }
  const project = await api(`v9/projects/${projectId}`, "Vercel project access");
  if (project.id !== projectId || project.accountId !== teamId)
    throw new Error("Vercel project identity mismatch");
  if (environment === "preview" && !project.targets?.production)
    throw new Error("Deploy production once before creating previews in a new Vercel project");
  // Re-running a failed publication must first establish whether the original upload succeeded.
  const prior = [];
  let until;
  for (let page = 0; ; page++) {
    if (page === 100)
      throw new Error("Deployment history exceeds recovery scan; inspect Vercel before retrying");
    const deployments = await api(
      `v6/deployments?projectId=${projectId}&limit=100${until ? `&until=${until}` : ""}`,
      `Vercel deployment history page ${page + 1}`,
    );
    prior.push(
      ...deployments.deployments.filter(
        (item) =>
          item.meta?.ninaRun === current.runId && item.meta?.ninaEnvironment === environment,
      ),
    );
    if (!deployments.pagination?.next) break;
    until = deployments.pagination.next;
  }
  if (prior.length) {
    if (prior.length !== 1)
      throw new Error("Multiple deployments for this run; inspect Vercel before retrying");
    const deployment = await api(
      `v13/deployments/${prior[0].uid}`,
      "Vercel prior deployment readback",
    );
    if (
      deployment.meta?.ninaCommit !== current.commit ||
      deployment.meta?.ninaVersion !== manifest.version ||
      deployment.meta?.ninaArtifact !== manifest.sha256 ||
      (environment === "production"
        ? deployment.target !== "production"
        : deployment.target != null) ||
      deployment.readyState !== "READY" ||
      deployment.meta?.ninaEnvironment !== environment
    )
      throw new Error(
        "Prior deployment has an uncertain or failed outcome; inspect Vercel before retrying",
      );
    await assignAlias(deployment);
    await report(origin, manifest.version);
    return;
  }
  async function assignAlias(deployment) {
    if (environment === "production") {
      if (!deployment.aliasAssigned)
        throw new Error("Production aliases are not assigned; inspect before retrying");
      return;
    }
    const hostname = new URL(origin).hostname;
    const aliases = await api(
      `v2/deployments/${deployment.id ?? deployment.uid}/aliases`,
      "Preview alias readback",
    );
    let alias = aliases.aliases.find((entry) => entry.alias === hostname);
    if (!alias)
      alias = await api(
        `v2/deployments/${deployment.id ?? deployment.uid}/aliases`,
        "Assign staging hostname",
        "POST",
        { alias: hostname },
      );
    const id = alias.uid ?? alias.id;
    if (!id) throw new Error("Staging alias identity missing; inspect before retrying");
    const details = await api(`v4/aliases/${id}`, "Staging alias verification");
    if (details.alias !== hostname || details.deployment?.id !== (deployment.id ?? deployment.uid))
      throw new Error("Staging alias targets a different deployment");
    if (
      !Object.values(details.protectionBypass ?? {}).some(
        (entry) => entry.scope === "alias-protection-override",
      )
    )
      await api(
        `aliases/${id}/protection-bypass`,
        "Allow native clients on staging hostname",
        "PATCH",
        { override: { scope: "alias-protection-override", action: "create" } },
      );
    const readback = await api(`v4/aliases/${id}`, "Staging protection exception readback");
    if (
      !Object.values(readback.protectionBypass ?? {}).some(
        (entry) => entry.scope === "alias-protection-override",
      )
    )
      throw new Error("Staging protection exception not verified");
  }
  const destination = path.join(root, "build/hosting");
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const archive = path.join(output, manifest.filename);
  const entries = run("tar", ["-tzf", archive], { stdio: "pipe" }).split("\n");
  if (entries.some((entry) => path.posix.isAbsolute(entry) || entry.split("/").includes("..")))
    throw new Error("Unsafe hosting archive");
  run("tar", ["-xzf", archive, "-C", destination]);
  if ((await readJson("build/hosting/nina-environment.json")).environment !== environment)
    throw new Error("Packaged environment mismatch");
  const config = await readJson("build/hosting/.vercel/output/config.json");
  if (config.version !== 3 || !config.routes.some((route) => route.handle === "filesystem"))
    throw new Error("Invalid hosting routes");
  if ((await readJson("build/hosting/vercel.json")).git?.deploymentEnabled !== false)
    throw new Error("Automatic Git deployment must remain disabled");
  for (const name of ["account", "generate", "mobile-sync", "speech", "speech-recovery"]) {
    const metadata = await readJson(
      `build/hosting/.vercel/output/functions/api/${name}.func/.vc-config.json`,
    );
    if (metadata.handler !== "index.mjs" || metadata.runtime !== "nodejs24.x")
      throw new Error("Invalid function metadata");
    await readFile(path.join(destination, `.vercel/output/functions/api/${name}.func/index.mjs`));
  }
  await readFile(path.join(destination, ".vercel/output/static/index.html"));
  await writeFile(
    path.join(destination, ".vercel/project.json"),
    JSON.stringify({ projectId, orgId: teamId }),
  );
  const env = childEnvironment({
    VERCEL_TOKEN: token,
    VERCEL_ORG_ID: teamId,
    VERCEL_PROJECT_ID: projectId,
    VERCEL_TELEMETRY_DISABLED: "1",
  });
  // Project access and ownership were verified above. Account identity lookup is
  // not a deployment prerequisite for a token scoped to the configured team.
  const result = run(
    "vercel",
    [
      "deploy",
      "--cwd",
      destination,
      "--prebuilt",
      ...(environment === "production" ? ["--prod"] : []),
      "--yes",
      "--scope",
      teamId,
      "--meta",
      `ninaRun=${current.runId}`,
      "--meta",
      `ninaEnvironment=${environment}`,
      "--meta",
      `ninaCommit=${current.commit}`,
      "--meta",
      `ninaVersion=${manifest.version}`,
      "--meta",
      `ninaArtifact=${manifest.sha256}`,
    ],
    {
      env,
      stdio: "pipe",
      diagnosticLabel: `Vercel ${environment} deployment (deploy --prebuilt)`,
    },
  );
  const url = result
    ?.split(/\s+/)
    .findLast((value) => /^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app\/?$/.test(value));
  if (!url) throw new Error("Deployment outcome unknown; inspect Vercel before retrying");
  const deployed = await api(
    `v13/deployments/${new URL(url).hostname}`,
    "Vercel production deployment readback",
  );
  if (
    deployed.projectId !== projectId ||
    deployed.meta?.ninaRun !== current.runId ||
    deployed.meta?.ninaCommit !== current.commit ||
    deployed.meta?.ninaVersion !== manifest.version ||
    deployed.meta?.ninaArtifact !== manifest.sha256 ||
    deployed.readyState !== "READY" ||
    (environment === "production" ? deployed.target !== "production" : deployed.target != null) ||
    deployed.meta?.ninaEnvironment !== environment
  )
    throw new Error("Deployment readback is incomplete; inspect Vercel before retrying");
  await assignAlias(deployed);
  await report(origin, manifest.version);
}
async function report(url, version) {
  await setOutput("url", url);
  await summary(
    `Vercel ${hostingEnvironment()} deployed: ${url}\nVersion: ${version}\nCommit: ${context().commit}\nRun: ${context().runId}\nNo migrations or inference activation performed.`,
  );
}
