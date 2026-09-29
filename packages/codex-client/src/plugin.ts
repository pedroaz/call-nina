import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "@call-nina/contracts";

const execFileAsync = promisify(execFile);
export const callNinaPluginName = "call-nina";
export const callNinaMarketplaceName = "call-nina-local";
const pluginId = `${callNinaPluginName}@${callNinaMarketplaceName}`;
const installedSchema = z.object({
  pluginId: z.string(),
  version: z.string(),
  enabled: z.boolean(),
});
const pluginsSchema = z.object({ installed: z.array(installedSchema) });
const serversSchema = z.array(
  z.object({
    name: z.string(),
    enabled: z.boolean(),
    transport: z.object({ type: z.string() }),
  }),
);
const marketplacesSchema = z.object({
  marketplaces: z.array(z.object({ name: z.string(), root: z.string() })),
});

export class ScopedPluginClient {
  constructor(readonly options: { executable: string; cwd: string; sourceVersion: string }) {}

  async #command(
    args: readonly string[],
    stage:
      | "LIST"
      | "MCP_LIST"
      | "MARKETPLACE_LIST"
      | "MARKETPLACE_REMOVE"
      | "MARKETPLACE_ADD"
      | "ADD"
      | "REMOVE",
  ): Promise<unknown> {
    let output: string;
    try {
      const { stdout } = await execFileAsync(this.options.executable, [...args, "--json"], {
        cwd: this.options.cwd,
        env: process.env,
        timeout: 20_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      output = stdout;
    } catch {
      throw new Error(`OD_PLUGIN_${stage}_COMMAND_FAILED`);
    }
    try {
      return JSON.parse(output) as unknown;
    } catch {
      throw new Error(`OD_PLUGIN_${stage}_RESPONSE_INVALID`);
    }
  }

  async requireLogin(): Promise<void> {
    try {
      await execFileAsync(this.options.executable, ["login", "status"], {
        cwd: this.options.cwd,
        env: process.env,
        timeout: 20_000,
        maxBuffer: 64 * 1024,
      });
    } catch {
      throw new Error("OD_CODEX_LOGIN_REQUIRED");
    }
  }

  async status() {
    const [plugins, servers] = await Promise.all([
      this.#command(["plugin", "list"], "LIST").then((value) => pluginsSchema.parse(value)),
      this.#command(["mcp", "list"], "MCP_LIST").then((value) => serversSchema.parse(value)),
    ]);
    const installed = plugins.installed.find((entry) => entry.pluginId === pluginId);
    const server = servers.find((entry) => entry.name === callNinaPluginName);
    const state = !installed
      ? "missing"
      : !installed.enabled || !server?.enabled || server.transport.type !== "stdio"
        ? "failed-start"
        : installed.version.split("+")[0] !== this.options.sourceVersion.split("+")[0]
          ? "stale"
          : "installed";
    return {
      state,
      installed: installed ? { version: installed.version, enabled: installed.enabled } : null,
      mcp: server ? { enabled: server.enabled, transport: server.transport.type } : null,
    } as const;
  }

  async install(marketplaceRoot: string, expectedVersion: string) {
    const marketplaces = marketplacesSchema.parse(
      await this.#command(["plugin", "marketplace", "list"], "MARKETPLACE_LIST"),
    );
    const previous = marketplaces.marketplaces.find(
      (entry) => entry.name === callNinaMarketplaceName,
    );
    if (previous && previous.root !== marketplaceRoot) {
      await this.#command(
        ["plugin", "marketplace", "remove", callNinaMarketplaceName],
        "MARKETPLACE_REMOVE",
      );
    }
    try {
      if (previous?.root !== marketplaceRoot)
        await this.#command(["plugin", "marketplace", "add", marketplaceRoot], "MARKETPLACE_ADD");
    } catch (error) {
      if (previous && previous.root !== marketplaceRoot) {
        await this.#command(
          ["plugin", "marketplace", "add", previous.root],
          "MARKETPLACE_ADD",
        ).catch(() => undefined);
      }
      throw error;
    }
    await this.#command(["plugin", "add", pluginId], "ADD");
    const status = await this.status();
    if (status.state !== "installed" || status.installed?.version !== expectedVersion)
      throw new Error("OD_PLUGIN_INSTALL_NOT_VERIFIED");
    return status;
  }

  async uninstall() {
    const plugins = pluginsSchema.parse(await this.#command(["plugin", "list"], "LIST"));
    if (plugins.installed.some((entry) => entry.pluginId === pluginId)) {
      await this.#command(["plugin", "remove", pluginId], "REMOVE");
    }
    const marketplaces = marketplacesSchema.parse(
      await this.#command(["plugin", "marketplace", "list"], "MARKETPLACE_LIST"),
    );
    if (marketplaces.marketplaces.some((entry) => entry.name === callNinaMarketplaceName)) {
      await this.#command(
        ["plugin", "marketplace", "remove", callNinaMarketplaceName],
        "MARKETPLACE_REMOVE",
      );
    }
    const status = await this.status();
    if (status.state !== "missing") throw new Error("OD_PLUGIN_UNINSTALL_NOT_VERIFIED");
    return status;
  }
}
