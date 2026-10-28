import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "../lib/environment.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const output = path.join(root, "build/release-artifacts");
export const repository = "pedroaz/call-nina";
export const workflowUrl = `https://github.com/${repository}/actions/workflows/release.yml`;
export const readJson = async (file) =>
  JSON.parse(await readFile(path.resolve(root, file), "utf8"));
export async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: childEnvironment(),
    stdio: "inherit",
    ...options,
  });
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${command}`);
  return result.stdout?.toString().trim();
}
export const node = (file, ...args) => run(process.execPath, [file, ...args]);
export function context(publishing = false) {
  const { GITHUB_ACTIONS, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_EVENT_NAME } =
    process.env;
  if (
    GITHUB_ACTIONS !== "true" ||
    GITHUB_REPOSITORY !== repository ||
    GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    !/^[a-f0-9]{40}$/.test(GITHUB_SHA ?? "") ||
    !/^\d+$/.test(GITHUB_RUN_ID ?? "")
  )
    throw new Error("Release tooling requires this repository's manual GitHub workflow");
  if (
    publishing &&
    (process.env.GITHUB_REF !== "refs/heads/main" || process.env.RELEASE_OPERATION !== "publish")
  )
    throw new Error("Publication requires an explicit publish run from main");
  const head = run("git", ["rev-parse", "HEAD"], { stdio: "pipe" });
  if (head !== GITHUB_SHA) throw new Error("Checkout does not match dispatch commit");
  return { commit: GITHUB_SHA, runId: GITHUB_RUN_ID, repository };
}
export async function summary(message) {
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  else process.stdout.write(`${message}\n`);
}
export async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
export function cleanSource() {
  run("git", ["diff", "--exit-code", "HEAD", "--", "."]);
}
export async function github(
  endpoint,
  { method = "GET", body, missing = false, raw = false, headers = {} } = {},
) {
  if (!process.env.GH_TOKEN) throw new Error("Missing GitHub job token");
  const response = await fetch(
    endpoint.startsWith("https://")
      ? endpoint
      : `https://api.github.com/repos/${repository}/${endpoint}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (missing && response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `GitHub request failed (${response.status}); inspect remote state before retrying`,
    );
  return raw ? response : response.json();
}
export function help() {
  process.stdout.write(
    `Manual release: ${workflowUrl}\nChoose branch (normally main), target desktop/hosting/all, and build-only/publish.\nDesktop publication requires desktop_version matching committed manifests.\nBuild-only downloads expire after 30 days. Publishing requires main.\nNo local build or deployment is performed by this command.\n`,
  );
}
