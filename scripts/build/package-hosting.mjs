#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkPublicConfiguration } from "../admin/configuration.mjs";
import { pnpmCommand } from "../lib/package-command.mjs";
import { runStage } from "../lib/run-stage.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps/website/dist");
const destination = "build/hosting";
const staging = path.join(root, destination);
const output = path.join(staging, ".vercel/output");

// Native configuration owns Git deployment policy; Build Output API v3 owns
// static files, routes, and explicitly bundled pilot API functions.
// https://vercel.com/docs/build-output-api/configuration
// https://vercel.com/docs/cli/deploy
// https://vercel.com/docs/cli/global-options
function help() {
  process.stdout.write(`Combined website and pilot API packaging

  make package hosting          Build the complete artifact locally.
  node scripts/admin/index.mjs infra plan            Inspect desired infrastructure.
  make deploy                   Review the production deployment target.
  make release                  Show the manual GitHub release workflow.

The artifact includes /api/account, /api/generate and /api/mobile-sync even while inference is disabled.
Never deploy static website output alone to the shared project.
Git-triggered deployments remain disabled. Packaging does not publish anything.
`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Hosting build command failed");
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
      (relative === "index.html" ||
        /^notices\/fonts\/OFL-(?:Fredoka|Figtree|JetBrainsMono|NotoSansMono|SourceSans3|SourceSerif4)\.txt$/.test(
          relative,
        ) ||
        /^assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg|png|jpg|jpeg|webp|avif|ico|woff2?|ttf)$/.test(
          relative,
        ))
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
  throw new Error("Usage: node scripts/build/package-hosting.mjs [--help]");
} else {
  await checkPublicConfiguration();
  run(process.execPath, ["scripts/diagnostics/check-toolchain.mjs"]);
  // Invalidate the old upload artifact before building, so failure cannot leave
  // a previous successful package looking current. This directory is ours alone.
  await rm(staging, { recursive: true, force: true });
  runStage("Build website", () =>
    run(...pnpmCommand(["--filter", "@call-nina/website", "run", "build"])),
  );
  runStage("Build API", () => run(...pnpmCommand(["--filter", "@call-nina/api", "run", "build"])));
  runStage("Package API functions", () =>
    run(process.execPath, ["scripts/build/package-functions.mjs"]),
  );
  const files = await filesIn(source);
  if (!files.includes("index.html")) throw new Error("Website build is missing its landing index");
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
  // Deliberately no SPA catch-all: removed routes and unknown assets keep HTTP 404.
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
    ...["account", "generate", "mobile-sync"].flatMap((name) => [
      `.vercel/output/functions/api/${name}.func/index.mjs`,
      `.vercel/output/functions/api/${name}.func/.vc-config.json`,
    ]),
    ...files.map((file) => `.vercel/output/static/${file}`),
  ]) {
    const bytes = await readFile(path.join(staging, file));
    process.stdout.write(`${createHash("sha256").update(bytes).digest("hex")}  ${file}\n`);
  }
  process.stdout.write(
    `Packaged ${files.length} static website files and 3 API functions in ${destination}.\n`,
  );
  process.stdout.write(
    "No remote actions. Publication uses the manual GitHub Publish workflow; see make release.\n",
  );
}
