import { developmentConfig } from "../../../scripts/lib/config.mjs";
import path from "node:path";
import os from "node:os";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const pluginRoot = path.join(repositoryRoot, "plugins/call-nina");
const action = process.argv[2];
try {
  const {
    ScopedPluginClient,
    readPluginSourceVersion,
    stagePluginSource,
    discoverCodex,
    resolveCodexExecutable,
  } = await import("../../../packages/codex-client/dist/index.js").catch(() => {
    throw new Error("OD_PLUGIN_BUILD_REQUIRED");
  });
  if (!["install", "refresh", "status", "uninstall"].includes(action))
    throw new Error("OD_PLUGIN_ACTION_INVALID");
  const configuredExecutable = developmentConfig().executables.codex ?? undefined;
  const executable = await resolveCodexExecutable(configuredExecutable, process.env);
  if (!executable) throw new Error("OD_CODEX_DESKTOP_RUNTIME_MISSING");
  const client = new ScopedPluginClient({
    executable,
    cwd: repositoryRoot,
    sourceVersion: await readPluginSourceVersion(pluginRoot),
  });
  let status;
  if (action === "status") status = await client.status();
  else {
    const discovery = await discoverCodex(
      configuredExecutable ? { executable: configuredExecutable } : {},
    );
    if (discovery.status !== "available") throw new Error("OD_CODEX_VERSION_UNSUPPORTED");
    if (action === "uninstall") status = await client.uninstall();
    else {
      await client.requireLogin();
      const configRoot = path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
        "Call Nina",
      );
      const bootstrapFile = path.join(configRoot, "bootstrap.json");
      const staged = await stagePluginSource({
        pluginRoot,
        runtimeRoot: path.join(configRoot, "integration"),
        bootstrapFile,
        runtime: { kind: "development", executable: process.execPath, repositoryRoot },
      });
      status = await client.install(staged.marketplaceRoot, staged.version);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, pluginName: "call-nina", marketplaceName: "call-nina-local", ...status })}\n`,
  );
} catch (error) {
  const code =
    error instanceof Error && /^OD_[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "OD_PLUGIN_ACTION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
