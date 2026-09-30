import { desktopPathOption } from "./options.js";
import { diagnosticErrorCode } from "./backend-support.js";
import { appendDesktopLog } from "./logging.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import {
  ScopedPluginClient,
  resolveCodexExecutable,
  readPluginSourceVersion,
  stagePluginSource,
} from "@call-nina/codex-client";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
function pluginRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "plugin")
    : path.join(repositoryRoot, "plugins/call-nina");
}
async function client() {
  const sourceVersion = await readPluginSourceVersion(pluginRoot());
  const executable = await resolveCodexExecutable(
    desktopPathOption("codex-executable"),
    process.env,
  );
  if (!executable) throw new Error("CODEX_DESKTOP_RUNTIME_MISSING");
  return new ScopedPluginClient({
    executable,
    cwd: app.isPackaged ? app.getPath("userData") : repositoryRoot,
    sourceVersion,
  });
}
function project(status: Awaited<ReturnType<ScopedPluginClient["status"]>>, codexVersion: string) {
  return {
    status: "available" as const,
    codexVersion,
    plugin:
      status.state === "missing"
        ? ("not-installed" as const)
        : status.state === "installed"
          ? ("installed" as const)
          : ("refresh-required" as const),
  };
}
export async function readPluginIntegrationState(codexVersion: string) {
  try {
    return project(await (await client()).status(), codexVersion);
  } catch {
    return { status: "available" as const, codexVersion, plugin: "refresh-required" as const };
  }
}
export async function runPluginIntegrationAction(
  action: "install" | "refresh" | "uninstall",
  codexVersion: string,
) {
  let sourceVersion = "unavailable";
  let stage = "client";
  try {
    const integration = await client();
    sourceVersion = integration.options.sourceVersion;
    let status: Awaited<ReturnType<ScopedPluginClient["status"]>>;
    if (action === "uninstall") {
      stage = "uninstall";
      status = await integration.uninstall();
    } else {
      stage = "external-account";
      await integration.requireLogin();
      stage = "stage-source";
      const staged = await stagePluginSource({
        pluginRoot: pluginRoot(),
        runtimeRoot: path.join(app.getPath("userData"), "integration"),
        bootstrapFile: path.join(app.getPath("userData"), "bootstrap.json"),
        runtime: app.isPackaged
          ? { kind: "packaged", executable: process.execPath, resourcesRoot: process.resourcesPath }
          : { kind: "development", executable: process.execPath, repositoryRoot, electron: true },
      });
      stage = "install";
      status = await integration.install(staged.marketplaceRoot, staged.version);
    }
    return {
      action,
      result: "verified" as const,
      sourceVersion,
      status: project(status, codexVersion),
      steps: [
        action === "uninstall"
          ? "Removed and verified the scoped Call Nina plugin and marketplace."
          : "Installed the stable Call Nina plugin source and verified plugin/MCP registration. Start a new Codex session to use it.",
      ],
    };
  } catch (error) {
    const code = diagnosticErrorCode(error);
    await appendDesktopLog(path.join(app.getPath("userData"), "bootstrap.json"), {
      timestamp: new Date().toISOString(),
      severity: "warn",
      component: "desktop",
      code: "DESKTOP_PLUGIN_ACTION_FAILED",
      action: "codex/integration/action",
      phase: "failed",
      outcome: "error",
      message: "Scoped plugin action failed.",
      metadata: { action, stage, code },
    }).catch(() => undefined);
    return {
      action,
      result: "failed" as const,
      sourceVersion,
      status: await readPluginIntegrationState(codexVersion),
      steps: [`The scoped integration action failed (${stage}: ${code}); no success is reported.`],
    };
  }
}
