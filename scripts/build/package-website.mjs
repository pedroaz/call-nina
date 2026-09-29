#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pnpmCommand } from "../lib/package-command.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps/website/dist");
const destination = "apps/website/build/vercel";
const staging = path.join(root, destination);
const output = path.join(staging, ".vercel/output");
const project = "prj_G6dX6jZ4E9hnlSxxLZXnRhMfndba";

// Native configuration owns Git deployment policy; Build Output API v3 owns
// static files and routes. No remote build, environment pull or functions.
// https://vercel.com/docs/build-output-api/configuration
// https://vercel.com/docs/cli/deploy
// https://vercel.com/docs/cli/global-options
function help() {
  process.stdout.write(`Manual website deployment (coordinator only)

Local preparation: make setup && make package-website
Review the source commit, printed file hashes and ${destination} before upload.
Independent local review, make check and the editorial publication decision must
be complete before deploying. Packaging does not authorize publication.

Desired configuration / expected remote settings diff:
  Existing project: call-nina (${project}), Pedro Azevedo projects, Hobby.
  git.deploymentEnabled: false (preserved by the root and staged vercel.json).
  Root directory: . (unchanged); framework: Other (unchanged).
  Remote Node: 24.x (unchanged and unused); local Node/pnpm: toolchain.json.
  No changes to build/install commands, domains, protection, plan or other settings.
  Deployment only: replace website files/routes with .vercel/output (version 3).
  No functions, runtime environment variables, application credentials or secrets.

Use the existing authenticated Vercel CLI session (vercel whoami must be pedroaz).
Set VERCEL_SCOPE to the existing Pedro Azevedo team slug/ID from vercel teams ls.
Read back the project first and confirm its ID, owner, Hobby plan and settings:
  vercel project inspect ${project} --scope "$VERCEL_SCOPE" --json
  vercel api /v9/projects/${project} --scope "$VERCEL_SCOPE"
If settings drift, stop and review that diff; these commands do not reconcile it.
Do not use vercel pull, env pull, install, remote build or project creation.

After those gates, manually upload only the prepared artifact to production:
  vercel deploy --cwd ${destination} --project ${project} --scope "$VERCEL_SCOPE" --prebuilt --prod --non-interactive
The explicit existing project ID avoids directory-name project discovery.
Do not add --yes or accept a create-project/upgrade prompt.

Readback (DEPLOYMENT_URL is the successful deploy command's returned URL):
  vercel inspect "$DEPLOYMENT_URL" --scope "$VERCEL_SCOPE" --wait
  vercel project inspect ${project} --scope "$VERCEL_SCOPE" --json
  vercel api /v9/projects/${project} --scope "$VERCEL_SCOPE"
Confirm the same project/owner/plan, Ready production deployment, assigned URL,
static files only and automatic Git deployments still disabled.
Inspect /, /?lang=de, /blog, /blog/, all published article URLs and an asset URL.
Unknown paths and /blog/preview/format-example/ must return HTTP 404.
Verify the public page content, contact mailto and Coming soon states manually.

Provider state is ignored; make clean removes this generated deployment directory.
`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.name.startsWith(".") || entry.isSymbolicLink())
      throw new Error(`Unexpected hidden file or symlink in website output: ${relative}`);
    if (entry.isDirectory()) {
      files.push(...(await filesIn(path.join(directory, entry.name), `${relative}/`)));
    } else if (
      entry.isFile() &&
      (/^(?:blog\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?)?index\.html$/.test(relative) ||
        /^assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg|png|jpg|jpeg|webp|avif|ico|woff2?)$/.test(relative))
    ) {
      files.push(relative);
    } else {
      throw new Error(`Unexpected file in static website output: ${relative}`);
    }
  }
  return files.sort();
}

if (process.argv.length === 3 && process.argv[2] === "--help") {
  help();
} else if (process.argv.length !== 2) {
  throw new Error("Usage: node scripts/build/package-website.mjs [--help]");
} else {
  run(process.execPath, ["scripts/diagnostics/check-toolchain.mjs"]);
  // Invalidate the old upload artifact before building, so failure cannot leave
  // a previous successful package looking current. This directory is ours alone.
  await rm(staging, { recursive: true, force: true });
  run(...pnpmCommand(["--filter", "@call-nina/website", "run", "build"]));
  const files = await filesIn(source);
  if (!files.includes("index.html") || !files.includes("blog/index.html"))
    throw new Error("Website build is missing its landing or blog index");
  const vercelConfig = await readFile(path.join(root, "vercel.json"), "utf8");
  if (JSON.parse(vercelConfig).git?.deploymentEnabled !== false)
    throw new Error("Automatic Git deployments must remain disabled");

  const pages = files.filter((file) => file.endsWith("index.html"));
  const config = {
    version: 3,
    routes: [
      { handle: "filesystem" },
      ...pages.map((file) => ({
        src: file === "index.html" ? "^/$" : `^/${file.slice(0, -11)}/?$`,
        dest: `/${file}`,
      })),
    ],
  };
  // Deliberately no SPA catch-all: only built pages resolve; missing articles,
  // development previews and unknown assets keep the platform's HTTP 404.
  for (const file of files) {
    const target = path.join(output, "static", file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, file), target);
  }
  await writeFile(path.join(output, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(path.join(staging, "vercel.json"), vercelConfig);

  for (const file of [
    "vercel.json",
    ".vercel/output/config.json",
    ...files.map((file) => `.vercel/output/static/${file}`),
  ]) {
    const bytes = await readFile(path.join(staging, file));
    process.stdout.write(`${createHash("sha256").update(bytes).digest("hex")}  ${file}\n`);
  }
  process.stdout.write(`Packaged ${files.length} static website files in ${destination}.\n`);
  process.stdout.write("No remote actions. Next: make website-deployment-help\n");
}
