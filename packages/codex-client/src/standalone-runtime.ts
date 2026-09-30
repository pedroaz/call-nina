import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { codexRuntimeTargets, codexRuntimeVersion } from "./runtime-release.js";

export type StandaloneRuntimeOptions = Readonly<{ resourceRoot: string; deviceRoot: string }>;

// These overrides apply before startup tasks, not merely after a thread has loaded extensions.
export const standaloneConfig = {
  model_provider: "openai",
  // config/read includes this packaged default in Codex 0.159.2; pin its exact destination.
  chatgpt_base_url: "https://chatgpt.com/backend-api/",
  forced_login_method: "chatgpt",
  cli_auth_credentials_store: "file",
  approval_policy: "never",
  allow_login_shell: false,
  check_for_update_on_startup: false,
  analytics: { enabled: false },
  feedback: { enabled: false },
  web_search: "disabled",
  project_doc_max_bytes: 0,
  skills: { include_instructions: false, bundled: { enabled: false } },
  cloud: { skills: { enabled: false } },
  orchestrator: { mcp: { enabled: false } },
  features: {
    shell_tool: false,
    shell_snapshot: false,
    shell_snapshot_v2: false,
    shell_zsh_fork: false,
    browser_use: false,
    computer_use: false,
    image_generation: false,
    js_repl: false,
    memories: false,
    hooks: false,
    plugin_hooks: false,
    plugins: false,
    recommended_plugins: false,
    apps: false,
    enable_mcp_apps: false,
    code_mode: false,
    code_mode_host: false,
    code_mode_prewarm: false,
    remote_control: false,
    multi_agent: false,
    multi_agent_v2: false,
    skill_search: false,
    skill_mcp_dependency_install: false,
    skill_env_var_dependency_prompt: false,
    skip_host_skill_discovery: true,
  },
} as const;

export const standaloneArguments = [
  "--listen",
  "stdio://",
  "--strict-config",
  ...Object.entries(standaloneConfig).flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`]),
];

function toml(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${key}=${toml(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function assertDirectory(directory: string): Promise<void> {
  // Reject links in every existing component, including the caller's device root.
  let cursor = path.parse(directory).root;
  if (!path.isAbsolute(directory) || directory === cursor)
    throw new Error("CODEX_OWNERSHIP_INVALID");
  for (const segment of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("CODEX_OWNERSHIP_INVALID");
  }
}

async function ownedDirectory(parent: string, name: string): Promise<string> {
  const directory = path.join(parent, name);
  await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  await assertDirectory(directory);
  return directory;
}

export async function prepareStandaloneRuntime(options: StandaloneRuntimeOptions) {
  const target = (
    codexRuntimeTargets as Record<string, { target: string; sha256: string } | undefined>
  )[`${process.platform}-${process.arch}`];
  if (!target) throw new Error("CODEX_PLATFORM_UNSUPPORTED");
  await assertDirectory(options.resourceRoot);
  const root = await realpath(options.resourceRoot);
  const receiptPath = path.join(root, "nina-runtime.json");
  if (!(await lstat(receiptPath)).isFile()) throw new Error("CODEX_RUNTIME_INVALID");
  const receipt: unknown = JSON.parse(await readFile(receiptPath, "utf8"));
  if (
    !receipt ||
    typeof receipt !== "object" ||
    !("version" in receipt) ||
    receipt.version !== codexRuntimeVersion ||
    !("target" in receipt) ||
    receipt.target !== target.target ||
    !("archiveSha256" in receipt) ||
    receipt.archiveSha256 !== target.sha256 ||
    !("files" in receipt) ||
    !receipt.files ||
    typeof receipt.files !== "object" ||
    Array.isArray(receipt.files)
  ) {
    throw new Error("CODEX_RUNTIME_INVALID");
  }
  const files = new Map(Object.entries(receipt.files));
  const executableRelative = `bin/codex-app-server${process.platform === "win32" ? ".exe" : ""}`;
  if (!files.has(executableRelative) || !files.has("codex-package.json"))
    throw new Error("CODEX_RUNTIME_INVALID");
  let count = 0;
  async function verify(directory: string, relative = ""): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++count > 100) throw new Error("CODEX_RUNTIME_INVALID");
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await verify(path.join(directory, entry.name), name);
      else if (entry.isFile() && name === "nina-runtime.json") continue;
      else if (
        !entry.isFile() ||
        typeof files.get(name) !== "string" ||
        (await digest(path.join(directory, entry.name))) !== files.get(name)
      ) {
        throw new Error("CODEX_RUNTIME_INTEGRITY_FAILED");
      } else files.delete(name);
    }
  }
  await verify(root);
  if (files.size) throw new Error("CODEX_RUNTIME_INTEGRITY_FAILED");
  const executable = path.join(root, executableRelative);
  await access(executable, constants.X_OK);

  await assertDirectory(options.deviceRoot);
  const home = await ownedDirectory(options.deviceRoot, "codex-runtime");
  const marker = path.join(home, ".nina-owned");
  try {
    const entries = await readdir(home);
    if (entries.length && !entries.includes(".nina-owned"))
      throw new Error("CODEX_OWNERSHIP_INVALID");
    await writeFile(marker, "call-nina-codex-home-v1\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      !(await lstat(marker)).isFile() ||
      (await readFile(marker, "utf8")) !== "call-nina-codex-home-v1\n"
    ) {
      throw new Error("CODEX_OWNERSHIP_INVALID");
    }
  }
  await chmod(home, 0o700);
  try {
    const auth = await lstat(path.join(home, "auth.json"));
    if (!auth.isFile() || auth.isSymbolicLink()) throw new Error("CODEX_OWNERSHIP_INVALID");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // No imports, config rewrites or auth-file reads. Codex alone owns authentication.
  for (const name of ["config.toml", "AGENTS.md", "skills", "plugins", "hooks.json"]) {
    try {
      await lstat(path.join(home, name));
      throw new Error("CODEX_RUNTIME_CONFIGURATION_UNSAFE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const environmentHome = await ownedDirectory(home, "environment");
  const cwd = await ownedDirectory(home, "workspace");
  const environment: NodeJS.ProcessEnv = {};
  // Never inherit developer credentials, CODEX_*/OPENAI_* configuration, loaders or shell hooks.
  for (const name of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  Object.assign(environment, {
    CODEX_HOME: home,
    HOME: environmentHome,
    USERPROFILE: environmentHome,
    CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1",
    XDG_CONFIG_HOME: environmentHome,
    XDG_DATA_HOME: environmentHome,
    XDG_CACHE_HOME: environmentHome,
    APPDATA: environmentHome,
    LOCALAPPDATA: environmentHome,
  });
  return { executable, environment, cwd };
}

export function assertStandaloneConfiguration(value: unknown): void {
  const object = (entry: unknown): Record<string, unknown> | undefined =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : undefined;
  const config = object(object(value)?.["config"]);
  if (
    !config ||
    config["model_provider"] !== "openai" ||
    config["chatgpt_base_url"] !== standaloneConfig.chatgpt_base_url
  )
    throw new Error("CODEX_RUNTIME_CONFIGURATION_UNSAFE");
  const features = object(config["features"]);
  if (
    !features ||
    Object.entries(standaloneConfig.features).some(
      ([key, expected]) => features[key] !== expected,
    ) ||
    config["cli_auth_credentials_store"] !== "file" ||
    config["forced_login_method"] !== "chatgpt" ||
    config["allow_login_shell"] !== false
  )
    throw new Error("CODEX_RUNTIME_CONFIGURATION_UNSAFE");
  // Managed/system configuration must not introduce tools or redirect subscription traffic.
  for (const key of ["mcp_servers", "model_providers", "plugins"]) {
    const configured = config[key];
    if (
      configured !== undefined &&
      configured !== null &&
      (!object(configured) || Object.keys(configured).length)
    )
      throw new Error("CODEX_RUNTIME_CONFIGURATION_UNSAFE");
  }
  if (
    config["openai_base_url"] ||
    config["notify"] ||
    config["model_instructions_file"] ||
    config["experimental_instructions_file"]
  ) {
    throw new Error("CODEX_RUNTIME_CONFIGURATION_UNSAFE");
  }
}
