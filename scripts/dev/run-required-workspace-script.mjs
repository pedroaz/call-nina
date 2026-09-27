#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const requireCodex = args.includes("--require-codex");
const scriptName = args.find((argument) => !argument.startsWith("--"));
const unknown = args.filter(
  (argument) => argument !== "--require-codex" && argument !== scriptName,
);
if (!scriptName || unknown.length > 0) {
  process.stderr.write(
    "Usage: node scripts/dev/run-required-workspace-script.mjs <script> [--require-codex]\n",
  );
  process.exit(2);
}

function manifestsBelow(parent) {
  const parentPath = resolve(parent);
  try {
    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(parentPath, entry.name, "package.json"));
  } catch {
    return [];
  }
}

if (requireCodex) {
  const check = spawnSync(
    process.execPath,
    ["scripts/diagnostics/check-toolchain.mjs", "--require-codex"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (check.error || check.status !== 0) process.exit(check.status ?? 1);
}

const manifests = [
  ...manifestsBelow("apps"),
  ...manifestsBelow("packages"),
  ...manifestsBelow("plugins"),
];
const owners = manifests
  .map((manifestPath) => ({
    manifestPath,
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
  }))
  .filter(({ manifest }) => typeof manifest.scripts?.[scriptName] === "string");

if (owners.length === 0) {
  process.stderr.write(
    `[UNAVAILABLE] No workspace implements ${scriptName} yet. The command surface is ready, but its owning checklist capability must be completed first.\n`,
  );
  process.exit(78);
}

const result = spawnSync("pnpm", ["--recursive", "--parallel", "--if-present", "run", scriptName], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
