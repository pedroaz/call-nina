#!/usr/bin/env node

import { developmentConfig } from "../lib/config.mjs";
import { pnpmCommand } from "../lib/package-command.mjs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { resolveCodexExecutable } from "../../packages/codex-client/src/desktop-runtime.ts";
import { diagnoseToolchain } from "../lib/toolchain-diagnostics.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const policy = JSON.parse(readFileSync(resolve(root, "toolchain.json"), "utf8"));
const allowedArguments = new Set(["--require-codex", "--json"]);
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => !allowedArguments.has(argument));
if (unknownArguments.length > 0) {
  process.stderr.write(
    `Unknown argument${unknownArguments.length === 1 ? "" : "s"}: ${unknownArguments.join(", ")}\nUsage: node scripts/diagnostics/check-toolchain.mjs [--require-codex] [--json]\n`,
  );
  process.exit(2);
}
const requireCodex = process.argv.includes("--require-codex");
const json = process.argv.includes("--json");

function run(command, args) {
  return spawnSync(...(command === "pnpm" ? pnpmCommand(args) : [command, args]), {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: process.env,
  });
}

const pnpm = run("pnpm", ["--version"]);
const executable = await resolveCodexExecutable(developmentConfig().executables.codex, process.env);
const codex = executable ? run(executable, ["--version"]) : { status: null };
const appServer =
  codex.status === 0 ? run(executable, policy.codex.appServerCommand) : { status: null };
const appServerStatus =
  appServer.status === 0
    ? "available"
    : appServer.error?.code === "ETIMEDOUT"
      ? "timeout"
      : "failed";

const result = diagnoseToolchain(
  {
    nodeVersion: process.version,
    pnpmAvailable: pnpm.status === 0,
    pnpmVersion: pnpm.status === 0 ? pnpm.stdout : "unavailable",
    codexAvailable: codex.status === 0,
    codexVersion: codex.status === 0 ? codex.stdout : "",
    appServerStatus,
    appServerDetail:
      appServerStatus === "failed" ? `exit ${appServer.status ?? "unknown"}` : undefined,
  },
  policy,
  { requireCodex },
);

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  for (const item of result.checks) {
    process.stdout.write(`[${item.status.toUpperCase()}] ${item.code}: ${item.message}\n`);
  }
}

process.exitCode = result.ok ? 0 : 1;
