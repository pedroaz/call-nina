#!/usr/bin/env node

import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const workspace = parse(await readFile(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8"));
if (
  !Array.isArray(workspace.packages) ||
  !workspace.packages.every((pattern) => typeof pattern === "string" && !pattern.startsWith("!"))
) {
  throw new Error("OD_WORKSPACE_PATTERNS_INVALID");
}
const discovered = [];
for await (const manifest of glob(
  workspace.packages.map((pattern) => `${pattern}/package.json`),
  { cwd: repositoryRoot },
)) {
  discovered.push(manifest);
}
const manifests = [
  "package.json",
  ...new Set(discovered.sort()),
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
