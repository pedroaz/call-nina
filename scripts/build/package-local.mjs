import { spawnSync } from "node:child_process";
import { pnpmCommand } from "../lib/package-command.mjs";
import { runStage } from "../lib/run-stage.mjs";
process.env.NINA_ENVIRONMENT ??= "production";
const supported = { linux: ["x64"], darwin: ["x64", "arm64"], win32: ["x64"] };
if (!supported[process.platform]?.includes(process.arch))
  throw new Error("OD_PLATFORM_UNSUPPORTED");
function node(file, ...args) {
  const child = spawnSync(process.execPath, [`scripts/build/${file}`, ...args], {
    stdio: "inherit",
  });
  if (child.error || child.status !== 0) throw new Error("OD_PACKAGE_FAILED");
}
function pnpm(args) {
  const result = spawnSync(...pnpmCommand(args), {
    stdio: "inherit",
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
  if (result.error || result.status !== 0) throw new Error("OD_PACKAGE_FAILED");
}
runStage("Generate third-party notices", () => node("generate-third-party-notices.mjs"));
runStage("Build desktop and MCP server", () =>
  pnpm(["--filter", "@call-nina/desktop", "run", "build"]),
);
runStage("Stage MCP helper", () => node("build-mcp-helper.mjs", "--skip-build"));
runStage("Package desktop", () =>
  pnpm([
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
  ]),
);
runStage("Inspect desktop resources and size", () => node("inspect-package.mjs"));
