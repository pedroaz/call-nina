import { spawnSync } from "node:child_process";
import { pnpmCommand } from "../lib/package-command.mjs";
const supported = { linux: ["x64"], darwin: ["x64", "arm64"], win32: ["x64"] };
if (!supported[process.platform]?.includes(process.arch))
  throw new Error("OD_PLATFORM_UNSUPPORTED");
for (const file of ["generate-third-party-notices.mjs", "build-mcp-helper.mjs"]) {
  const child = spawnSync(process.execPath, [`scripts/build/${file}`], { stdio: "inherit" });
  if (child.error || child.status !== 0) throw new Error("OD_PACKAGE_FAILED");
}
for (const args of [
  ["--filter", "@call-nina/desktop", "run", "build"],
  [
    "--dir",
    "apps/desktop",
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.yml",
    "--dir",
    `--${process.arch}`,
    "--publish",
    "never",
    "--config.directories.output=../../release/local",
  ],
]) {
  const result = spawnSync(...pnpmCommand(args), {
    stdio: "inherit",
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
  if (result.error || result.status !== 0) throw new Error("OD_PACKAGE_FAILED");
}
const inspection = spawnSync(process.execPath, ["scripts/build/inspect-package.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (inspection.error || inspection.status !== 0) throw new Error("OD_PACKAGE_INSPECTION_FAILED");
