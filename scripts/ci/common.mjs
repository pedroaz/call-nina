import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostingEnvironment } from "../lib/hosting-environment.mjs";
import { childEnvironment } from "../lib/environment.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const output = path.join(root, "build/release-artifacts");
export const repository = "pedroaz/call-nina";
export const workflowUrl = `https://github.com/${repository}/actions/workflows/build.yml`;
export const deployUrl = `https://github.com/${repository}/actions/workflows/deploy-vercel.yml`;
export const publishUrl = `https://github.com/${repository}/actions/workflows/publish.yml`;
export const readJson = async (file) =>
  JSON.parse(await readFile(path.resolve(root, file), "utf8"));
export async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export function run(command, args, options = {}) {
  const { diagnosticLabel, ...spawnOptions } = options;
  const started = Date.now();
  if (diagnosticLabel) progress(`${diagnosticLabel}: started`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: childEnvironment(),
    stdio: "inherit",
    ...spawnOptions,
  });
  if (result.error || result.status !== 0) {
    if (diagnosticLabel) {
      // Never dump stdout or command arguments, which may contain private data.
      // Redact before truncating so partial secret values cannot escape masking.
      const stderr = diagnostic(result.stderr?.toString() ?? "", true);
      progress(
        `${diagnosticLabel}: stderr (last 1000 characters): ${stderr || "No stderr captured"}`,
      );
    }
    throw new Error(
      `Command failed: ${diagnosticLabel ?? path.basename(command)}; exit=${result.status ?? "none"}; signal=${result.signal ?? "none"}; code=${result.error?.code ?? "none"}; elapsed=${Date.now() - started}ms`,
    );
  }
  if (diagnosticLabel) progress(`${diagnosticLabel}: succeeded in ${Date.now() - started}ms`);
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
    ((process.env.GITHUB_REF !== "refs/heads/main" &&
      !(publishing === "vercel" && hostingEnvironment() === "preview")) ||
      (publishing === "vercel"
        ? process.env.RELEASE_OPERATION !== "deploy-vercel" ||
          process.env.RELEASE_TARGET !== "hosting" ||
          Boolean(process.env.RELEASE_SOURCE_COMMIT)
        : process.env.RELEASE_OPERATION !== "publish" || process.env.RELEASE_TARGET !== "desktop"))
  )
    throw new Error(
      "Publication requires an explicit manual workflow; production publication requires main",
    );
  const head = run("git", ["rev-parse", "HEAD"], { stdio: "pipe" });
  if (head !== GITHUB_SHA) throw new Error("Checkout does not match dispatch commit");
  if (process.env.RELEASE_SOURCE_COMMIT) {
    if (
      process.env.RELEASE_OPERATION !== "publish" ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      !/^[a-f0-9]{40}$/.test(process.env.RELEASE_SOURCE_COMMIT) ||
      !/^[1-9]\d*$/.test(process.env.RELEASE_BUILD_RUN_ID ?? "")
    )
      throw new Error("Invalid publication source identity");
    return {
      commit: process.env.RELEASE_SOURCE_COMMIT,
      runId: process.env.RELEASE_BUILD_RUN_ID,
      repository,
    };
  }
  return { commit: GITHUB_SHA, runId: GITHUB_RUN_ID, repository };
}
export async function releaseVersion() {
  if (process.env.RELEASE_OPERATION !== "publish") return (await readJson("package.json")).version;
  const version = process.env.RELEASE_SOURCE_VERSION;
  if (!process.env.RELEASE_SOURCE_COMMIT || !/^\d+\.\d+\.\d+$/.test(version ?? ""))
    throw new Error("Missing verified build version");
  return version;
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
// Only bounded, single-line diagnostics cross the CI logging boundary.
export function diagnostic(value, tail = false) {
  let text = String(value);
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY/.test(name))
      text = text.split(secret).join("[redacted]");
  }
  for (const directory of [root, process.env.HOME, process.env.USERPROFILE]) {
    if (directory) text = text.split(directory).join("[path]");
  }
  const sanitized = text
    // eslint-disable-next-line no-control-regex -- Strip ANSI controls from subprocess diagnostics.
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, "[redacted]")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159) ? " " : character;
    })
    .join("");
  return tail ? sanitized.slice(-1000) : sanitized.slice(0, 1000);
}
export function progress(message) {
  process.stdout.write(`[release] ${diagnostic(message)}\n`);
}
export async function github(
  endpoint,
  { method = "GET", body, missing = false, raw = false, headers = {} } = {},
) {
  if (!process.env.GH_TOKEN) throw new Error("Missing GitHub job token");
  const url = new URL(
    endpoint.startsWith("https://")
      ? endpoint
      : `https://api.github.com/repos/${repository}/${endpoint}`,
  );
  if (!["https://api.github.com", "https://uploads.github.com"].includes(url.origin))
    throw new Error("Unexpected GitHub endpoint");
  // Exclude query parameters, credentials, bodies and authorization headers.
  const label = `${method} ${url.origin}${url.pathname}`;
  const started = Date.now();
  progress(`GitHub ${label}: started`);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `GitHub ${label}: network failure after ${Date.now() - started}ms (${diagnostic(error.cause?.code ?? error.name)}); inspect remote state before retrying`,
    );
  }
  const details = [
    `HTTP ${response.status}`,
    `${Date.now() - started}ms`,
    ...[
      "x-github-request-id",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
      "retry-after",
      "x-accepted-github-permissions",
    ].flatMap((name) =>
      response.headers.has(name) ? [`${name}=${diagnostic(response.headers.get(name))}`] : [],
    ),
  ].join("; ");
  if (missing && response.status === 404) {
    progress(`GitHub ${label}: absent as expected (${details})`);
    return null;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      typeof payload?.message === "string" ? diagnostic(payload.message) : "No JSON error message";
    throw new Error(
      `GitHub ${label}: ${details}; ${message}; inspect remote state before retrying`,
    );
  }
  progress(`GitHub ${label}: succeeded (${details})`);
  if (raw) return response;
  try {
    return await response.json();
  } catch {
    throw new Error(
      `GitHub ${label}: invalid JSON response (${details}); inspect remote state before retrying`,
    );
  }
}
export function help() {
  process.stdout.write(
    `Desktop Build: ${workflowUrl}\nChoose target=desktop for desktop releases; all/hosting remain available for artifact preparation. Build never publishes.\nDesktop Release: ${publishUrl}\nFrom main, enter a successful main-branch Desktop Build run ID containing all four desktop artifacts. Hosting is not required or deployed.\nDeploy Vercel: ${deployUrl}\nRun from main to build and deploy the combined website/API without desktop builds.\nShared versions are retained; every artifact and deployment records its exact commit and run ID.\nBuild downloads expire after 30 days.\nNo local build or deployment is performed by this command.\n`,
  );
}
