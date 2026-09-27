#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { developmentConfig, root } from "../lib/config.mjs";
const config = developmentConfig();
console.log(JSON.stringify({ configuration: "development.json", effective: config }, null, 2));
const result = spawnSync(process.execPath, ["scripts/diagnostics/check-toolchain.mjs", "--json"], {
  cwd: root,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
