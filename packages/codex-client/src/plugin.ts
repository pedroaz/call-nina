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

  async #command(args: readonly string[]): Promise<unknown> {
    try {
      const { stdout } = await execFileAsync(this.options.executable, [...args, "--json"], {
        cwd: this.options.cwd,
        env: process.env,
        timeout: 20_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return JSON.parse(stdout) as unknown;
    } catch {
      throw new Error("OD_PLUGIN_COMMAND_FAILED");
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
      this.#command(["plugin", "list"]).then((value) => pluginsSchema.parse(value)),
      this.#command(["mcp", "list"]).then((value) => serversSchema.parse(value)),
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
      await this.#command(["plugin", "marketplace", "list"]),
    );
    const previous = marketplaces.marketplaces.find(
      (entry) => entry.name === callNinaMarketplaceName,
    );
    if (previous && previous.root !== marketplaceRoot) {
      await this.#command(["plugin", "marketplace", "remove", callNinaMarketplaceName]);
    }
    try {
      if (previous?.root !== marketplaceRoot)
        await this.#command(["plugin", "marketplace", "add", marketplaceRoot]);
    } catch (error) {
      if (previous && previous.root !== marketplaceRoot) {
        await this.#command(["plugin", "marketplace", "add", previous.root]).catch(() => undefined);
      }
      throw error;
    }
    await this.#command(["plugin", "add", pluginId]);
    const status = await this.status();
    if (status.state !== "installed" || status.installed?.version !== expectedVersion)
      throw new Error("OD_PLUGIN_INSTALL_NOT_VERIFIED");
    return status;
  }

  async uninstall() {
    const plugins = pluginsSchema.parse(await this.#command(["plugin", "list"]));
    if (plugins.installed.some((entry) => entry.pluginId === pluginId)) {
      await this.#command(["plugin", "remove", pluginId]);
    }
    const marketplaces = marketplacesSchema.parse(
      await this.#command(["plugin", "marketplace", "list"]),
    );
    if (marketplaces.marketplaces.some((entry) => entry.name === callNinaMarketplaceName)) {
      await this.#command(["plugin", "marketplace", "remove", callNinaMarketplaceName]);
    }
    const status = await this.status();
    if (status.state !== "missing") throw new Error("OD_PLUGIN_UNINSTALL_NOT_VERIFIED");
    return status;
  }
}
