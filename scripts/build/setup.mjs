#!/usr/bin/env node

import { pnpmCommand } from "../lib/package-command.mjs";
import { spawnSync } from "node:child_process";

const profileIndex = process.argv.indexOf("--profile");
const profile = profileIndex === -1 ? "dev" : process.argv[profileIndex + 1];
if (
  !profile ||
  !["dev", "build"].includes(profile) ||
  process.argv.length !== (profileIndex === -1 ? 2 : 4)
) {
  throw new Error("Usage: node scripts/build/setup.mjs [--profile dev|build]");
}

function run(command, args) {
  process.stdout.write(`+ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(...(command === "pnpm" ? pnpmCommand(args) : [command, args]), {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/diagnostics/check-toolchain.mjs"]);
const installArguments = ["install", "--frozen-lockfile", "--prod=false"];
if (profile === "build") {
  installArguments.push(
    "--filter",
    "@call-nina/desktop...",
    "--filter",
    "@call-nina/mcp-server...",
  );
}
run("pnpm", installArguments);
if (profile === "dev") run("pnpm", ["peers", "check"]);
