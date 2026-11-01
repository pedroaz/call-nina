import { spawnSync } from "node:child_process";
import { pnpmCommand } from "../lib/package-command.mjs";
import { runStage as stage } from "../lib/run-stage.mjs";
import { appendFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const desktopRequire = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
function runStage(label, action) {
  if (process.env.GITHUB_ACTIONS !== "true") return stage(label, action);
  mkdirSync("build/release-diagnostics", { recursive: true });
  const record = (status) =>
    appendFileSync(
      "build/release-diagnostics/stages.jsonl",
      JSON.stringify({
        timestamp: new Date().toISOString(),
        label,
        status,
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        electron: desktopRequire("electron/package.json").version,
        builder: desktopRequire("electron-builder/package.json").version,
      }) + "\n",
    );
  record("started");
  try {
    const result = stage(label, action);
    record("completed");
    return result;
  } catch (error) {
    record("failed");
    throw error;
  }
}
process.env.NINA_ENVIRONMENT ??= "prd";
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
if (process.platform === "darwin")
  runStage("Stage Mac MCP runtime", () => node("stage-mac-runtime.mjs"));
runStage("Package desktop", () =>
  pnpm([
    "--dir",
    "apps/desktop",
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.yml",
    ...(process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true"
      ? ["--mac", "dmg", "--config.artifactName=Call-Nina-${version}-darwin-${arch}.${ext}"]
      : ["--dir"]),
    `--${process.arch}`,
    "--publish",
    "never",
    "--config.directories.output=../../release/local",
  ]),
);
runStage("Inspect desktop resources and size", () => node("inspect-package.mjs"));

if (process.platform === "darwin")
  runStage("Inspect Mac signatures and distribution", () => node("inspect-mac-package.mjs"));
