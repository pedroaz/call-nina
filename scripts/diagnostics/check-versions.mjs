#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pnpmCommand } from "../lib/package-command.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
// Let pnpm resolve its workspace patterns without installing project dependencies.
const listing = spawnSync(...pnpmCommand(["list", "--recursive", "--depth", "-1", "--json"]), {
  cwd: repositoryRoot,
  encoding: "utf8",
});
if (listing.error || listing.status !== 0) throw new Error("OD_WORKSPACE_DISCOVERY_FAILED");
const discovered = JSON.parse(listing.stdout).map((project) => {
  const relative = path.relative(repositoryRoot, project.path);
  if (path.isAbsolute(relative) || relative.split(path.sep).includes(".."))
    throw new Error("OD_WORKSPACE_PATH_INVALID");
  return path.join(relative, "package.json");
});
const manifests = [
  "package.json",
  ...new Set(discovered.filter((file) => file !== "package.json").sort()),
  "plugins/call-nina/.codex-plugin/plugin.json",
  "apps/mobile/app.json",
];

const versions = await Promise.all(
  manifests.map(async (relative) => {
    const data = JSON.parse(await readFile(path.join(repositoryRoot, relative), "utf8"));
    const manifest = relative === "apps/mobile/app.json" ? data.expo : data;
    if (typeof manifest.version !== "string") throw new Error(`OD_VERSION_MISSING:${relative}`);
    return { relative, version: manifest.version };
  }),
);
const expected = versions[0].version;
const mismatches = versions.filter(({ version }) => version !== expected);
if (mismatches.length) {
  throw new Error(
    `OD_VERSION_MISMATCH:${mismatches.map(({ relative, version }) => `${relative}=${version}`).join(",")}`,
  );
}
process.stdout.write(
  `[PASS] VERSION_ALIGNED: ${expected} across ${String(versions.length)} manifests\n`,
);
