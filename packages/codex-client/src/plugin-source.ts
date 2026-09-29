import { assertNoLinks, assertOwnedPath, writeOwnedTreeInventory } from "@call-nina/platform";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "@call-nina/contracts";
import { callNinaMarketplaceName, callNinaPluginName } from "./plugin.js";

const manifestSchema = z.object({
  name: z.literal("call-nina"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:\+[A-Za-z0-9.-]+)?$/u),
});
const pluginFiles = [".codex-plugin", ".mcp.json", "skills", "prompts", "bin"];

export async function readPluginSourceVersion(pluginRoot: string) {
  const raw: unknown = JSON.parse(
    await readFile(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  ) as unknown;
  return manifestSchema.parse(raw).version;
}

async function hashTree(root: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink()) throw new Error("OD_PLUGIN_SOURCE_SYMLINK_UNSAFE");
  if (metadata.isDirectory()) {
    for (const name of (await readdir(root)).sort()) {
      hash.update(name).update("\0");
      await hashTree(path.join(root, name), hash);
    }
  } else if (metadata.isFile()) {
    hash.update(String(metadata.size)).update("\0");
    for await (const chunk of createReadStream(root)) hash.update(chunk as Buffer);
  } else throw new Error("OD_PLUGIN_SOURCE_INVALID");
}

type SourceOptions = {
  pluginRoot: string;
  runtimeRoot: string;
  bootstrapFile: string;
  runtime:
    | { kind: "development"; executable: string; repositoryRoot: string; electron?: boolean }
    | { kind: "packaged"; executable: string; resourcesRoot: string };
};

// Called only by an explicit install/refresh. Installed commands never reference
// an AppImage mount, the caller's working directory, or the host's PATH.
export async function stagePluginSource(options: SourceOptions) {
  const paths = [
    options.pluginRoot,
    options.runtimeRoot,
    options.bootstrapFile,
    options.runtime.executable,
    options.runtime.kind === "packaged"
      ? options.runtime.resourcesRoot
      : options.runtime.repositoryRoot,
  ];
  if (paths.some((value) => !path.isAbsolute(value) || value.includes("\0")))
    throw new Error("OD_PLUGIN_PATH_INVALID");
  const sourceVersion = await readPluginSourceVersion(options.pluginRoot);
  const hash = createHash("sha256").update("call-nina-plugin-source-v1");
  const ownedFiles: string[] = [];
  for (const name of pluginFiles) {
    const source = path.join(options.pluginRoot, name);
    const exists = await lstat(source).then(
      () => true,
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      },
    );
    if (exists) {
      ownedFiles.push(name);
      hash.update(name);
      await hashTree(source, hash);
    }
  }
  const helperRoot =
    options.runtime.kind === "packaged"
      ? path.join(options.runtime.resourcesRoot, "mcp-helper")
      : undefined;
  const packagedCurriculumRoot =
    options.runtime.kind === "packaged"
      ? path.join(options.runtime.resourcesRoot, "curriculum")
      : undefined;
  if (helperRoot) await hashTree(helperRoot, hash);
  if (packagedCurriculumRoot) await hashTree(packagedCurriculumRoot, hash);
  if (options.runtime.kind === "development") {
    for (const relative of [
      "apps/mcp-server/dist",
      "packages/contracts/dist",
      "packages/domain/dist",
      "packages/persistence/dist",
      "packages/platform/dist",
    ]) {
      try {
        await hashTree(path.join(options.runtime.repositoryRoot, relative), hash);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new Error("OD_PLUGIN_RUNTIME_BUILD_REQUIRED");
        throw error;
      }
    }
    hash.update(options.runtime.repositoryRoot);
  }
  await hashTree(options.runtime.executable, hash);
  hash.update(options.bootstrapFile);
  const digest = hash.digest("hex").slice(0, 20);
  const version = `${sourceVersion.split("+")[0] ?? sourceVersion}+od.${digest}`;
  await assertNoLinks(options.runtimeRoot);
  await mkdir(options.runtimeRoot, { recursive: true, mode: 0o700 });
  await assertNoLinks(options.runtimeRoot);
  await assertOwnedPath(options.runtimeRoot, true);
  const parent = await lstat(options.runtimeRoot);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("OD_PLUGIN_RUNTIME_UNSAFE");
  const target = path.join(options.runtimeRoot, digest);
  const marker = path.join(target, "source-version.json");
  try {
    await assertOwnedPath(target, true);
    const metadata = await lstat(target);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("OD_PLUGIN_RUNTIME_UNSAFE");
    const markerMetadata = await lstat(marker);
    if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink())
      throw new Error("OD_PLUGIN_RUNTIME_UNSAFE");
    const existing: unknown = JSON.parse(await readFile(marker, "utf8")) as unknown;
    if (z.object({ version: z.literal(version) }).safeParse(existing).success)
      return { marketplaceRoot: target, version };
    throw new Error("OD_PLUGIN_RUNTIME_CONFLICT");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = await mkdtemp(path.join(options.runtimeRoot, ".install-"));
  try {
    const plugin = path.join(temporary, "plugins", callNinaPluginName);
    await mkdir(plugin, { recursive: true, mode: 0o700 });
    for (const name of ownedFiles)
      await cp(path.join(options.pluginRoot, name), path.join(plugin, name), { recursive: true });
    const raw: unknown = JSON.parse(
      await readFile(path.join(plugin, ".codex-plugin/plugin.json"), "utf8"),
    ) as unknown;
    const manifest = z.record(z.string(), z.unknown()).parse(raw);
    await writeFile(
      path.join(plugin, ".codex-plugin/plugin.json"),
      JSON.stringify({ ...manifest, version }, null, 2),
      { mode: 0o600 },
    );
    let command: string;
    let script: string;
    const env: Record<string, string> = { CALL_NINA_BOOTSTRAP_FILE: options.bootstrapFile };
    if (options.runtime.kind === "packaged" && helperRoot && packagedCurriculumRoot) {
      await cp(helperRoot, path.join(temporary, "mcp-helper"), { recursive: true });
      await cp(packagedCurriculumRoot, path.join(temporary, "curriculum"), { recursive: true });
      const electronRoot = path.dirname(options.runtime.resourcesRoot);
      await cp(electronRoot, path.join(temporary, "electron"), {
        recursive: true,
        dereference: true,
        filter: (source) =>
          path.relative(electronRoot, source).split(path.sep)[0] !==
          (process.platform === "darwin" ? "Resources" : "resources"),
      });
      command = path.join(
        target,
        "electron",
        path.relative(electronRoot, options.runtime.executable),
      );
      script = path.join(target, "mcp-helper", "call-nina-mcp.cjs");
      env["ELECTRON_RUN_AS_NODE"] = "1";
      env["CALL_NINA_MCP_ENTRY"] = path.join(target, "mcp-helper", "server/index.js");
      env["CALL_NINA_CURRICULUM_ROOT"] = path.join(target, "curriculum");
    } else if (options.runtime.kind === "development") {
      command = options.runtime.executable;
      if (options.runtime.electron) env["ELECTRON_RUN_AS_NODE"] = "1";
      script = path.join(options.runtime.repositoryRoot, "plugins/call-nina/bin/call-nina-mcp.cjs");
      env["CALL_NINA_MCP_ENTRY"] = path.join(
        options.runtime.repositoryRoot,
        "apps/mcp-server/dist/index.js",
      );
      env["CALL_NINA_CURRICULUM_ROOT"] = path.join(
        options.runtime.repositoryRoot,
        "content/curriculum",
      );
    } else throw new Error("OD_PLUGIN_RUNTIME_INVALID");
    await writeFile(
      path.join(plugin, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            [callNinaPluginName]: { type: "stdio", command, args: [script], env },
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await mkdir(path.join(temporary, ".agents/plugins"), { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(temporary, ".agents/plugins/marketplace.json"),
      JSON.stringify(
        {
          name: callNinaMarketplaceName,
          interface: { displayName: "Call Nina Local" },
          plugins: [
            {
              name: callNinaPluginName,
              source: { source: "local", path: "./plugins/call-nina" },
              policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
              category: "Education",
            },
          ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(path.join(temporary, "source-version.json"), JSON.stringify({ version }), {
      mode: 0o600,
    });
    await writeOwnedTreeInventory(temporary);
    await rename(temporary, target);
    return { marketplaceRoot: target, version };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
