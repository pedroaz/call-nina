#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { assertNoLinks, assertOwnedPath, removeOwnedTree } from "../packages/platform/src/index.ts";
import { pnpmCommand } from "../scripts/lib/package-command.mjs";
import { parseVersion, compareVersions } from "../scripts/lib/toolchain-diagnostics.mjs";
import {
  appRoot,
  bootstrapFile,
  configRoot,
  executable,
  exists,
  inside,
  installerRoot,
  platform,
  registerLaunchers,
  registrationStatus,
  running,
  unregisterLaunchers,
} from "./platform.mjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = path.join(installerRoot, "installation.json");
const markerName = ".call-nina-install.json";
const command = process.argv[2] || "install";
const supported = { linux: ["x64"], darwin: ["x64", "arm64"], win32: ["x64"] };
if (!supported[platform]?.includes(process.arch)) throw new Error("OD_PLATFORM_UNSUPPORTED");
if (!["install", "update", "status", "uninstall"].includes(command) || process.argv.length > 3)
  throw new Error("Usage: install/install.sh install|update|status|uninstall");
for (const filename of [installerRoot, appRoot, configRoot]) {
  if (
    !path.isAbsolute(filename) ||
    filename.includes("\n") ||
    filename.includes("\r") ||
    filename.includes("\0") ||
    filename === path.parse(filename).root
  )
    throw new Error("INSTALL_PATH_INVALID");
  await assertNoLinks(filename);
}

function run(program, args, options = {}) {
  return execFileSync(program, args, {
    cwd: source,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
}
function git(args) {
  return run("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function supportedVersion(raw, policy) {
  const value = parseVersion(raw, "tool");
  return (
    !value.text.includes("-") &&
    compareVersions(value, parseVersion(policy.minimumVersion, "minimum")) >= 0 &&
    compareVersions(value, parseVersion(policy.maximumExclusiveVersion, "maximum")) < 0
  );
}
async function json(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}
async function atomicJson(filename, value) {
  const temp = `${filename}.${randomUUID()}.next`;
  const file = await open(temp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temp, filename);
  } finally {
    await rm(temp, { force: true });
  }
}
async function readState() {
  if (!(await exists(stateFile))) return undefined;
  await assertOwnedPath(stateFile);
  const state = await json(stateFile);
  if (
    state.schemaVersion !== 1 ||
    state.kind !== "call-nina-installation" ||
    state.appRoot !== appRoot ||
    state.platform !== platform ||
    typeof state.id !== "string" ||
    !Array.isArray(state.files) ||
    !path.isAbsolute(state.source)
  )
    throw new Error("INSTALL_STATE_INVALID");
  return state;
}
async function inventory(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    const filename = path.join(root, name);
    if (entry.isSymbolicLink()) {
      const target = await readlink(filename);
      if (!inside(root, path.resolve(path.dirname(filename), target)))
        throw new Error("PACKAGE_LINK_ESCAPES_ROOT");
      files.push({ name, kind: "link", target });
    } else if (entry.isDirectory()) {
      files.push({ name, kind: "directory" });
      files.push(...(await inventory(root, name)));
    } else if (entry.isFile())
      files.push({
        name,
        kind: "file",
        sha256: createHash("sha256")
          .update(await readFile(filename))
          .digest("hex"),
      });
    else throw new Error("PACKAGE_FILE_INVALID");
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
async function assertInstallation(state, root = appRoot) {
  await assertOwnedPath(root);
  await assertNoLinks(path.join(root, markerName));
  const marker = await json(path.join(root, markerName));
  if (marker.id !== state.id || marker.kind !== state.kind)
    throw new Error("INSTALLATION_NOT_OWNED");
}
async function removeInventory(state, root = appRoot) {
  await assertInstallation(state, root);
  const leftovers = [];
  // Match content before removal; modified or unknown files stay in place.
  for (const file of state.files.filter(
    (file) => file.name !== markerName && file.kind !== "directory",
  )) {
    const target = path.resolve(root, file.name);
    if (!inside(root, target) || target === root) throw new Error("INSTALL_INVENTORY_INVALID");
    await assertNoLinks(path.dirname(target));
    if (!(await exists(target))) continue;
    const metadata = await lstat(target);
    const matches =
      file.kind === "link"
        ? metadata.isSymbolicLink() && (await readlink(target)) === file.target
        : metadata.isFile() &&
          !metadata.isSymbolicLink() &&
          createHash("sha256")
            .update(await readFile(target))
            .digest("hex") === file.sha256;
    if (matches) await unlink(target);
    else leftovers.push(file.name);
  }
  const directories = state.files
    .filter((file) => file.kind === "directory")
    .map((file) => file.name)
    .sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const name of directories) {
    const directory = path.resolve(root, name);
    if (!inside(root, directory) || directory === root)
      throw new Error("INSTALL_INVENTORY_INVALID");
    await assertNoLinks(directory);
    await rmdir(directory).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
    });
  }
  const remaining = (await readdir(root)).filter((name) => name !== markerName);
  if (remaining.length) {
    console.log(`Preserved unrelated or changed files in ${root}: ${remaining.join(", ")}`);
    return false;
  }
  await unlink(path.join(root, markerName));
  await rmdir(root);
  return leftovers.length === 0;
}
async function ensurePnpm() {
  const policy = await json(path.join(source, "toolchain.json"));
  if (!supportedVersion(process.versions.node, policy.node))
    throw new Error("NODE_UNSUPPORTED: rerun the platform installer entry point.");
  try {
    const version = run(...pnpmCommand(["--version"]), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (supportedVersion(version, policy.pnpm)) return version;
  } catch {
    /* Provision below. */
  }
  const tools = path.join(installerRoot, "tools");
  await assertNoLinks(tools);
  await mkdir(tools, { recursive: true, mode: 0o700 });
  await assertOwnedPath(tools, true);
  const destination = path.join(tools, `pnpm-${policy.pnpm.pinnedVersion}`);
  const cli = path.join(destination, "package/bin/pnpm.cjs");
  if (!(await exists(cli))) {
    const temporary = await mkdtemp(path.join(tools, ".pnpm-"));
    try {
      const response = await fetch(`https://registry.npmjs.org/pnpm/${policy.pnpm.pinnedVersion}`);
      if (!response.ok) throw new Error("PNPM_METADATA_UNAVAILABLE");
      const metadata = await response.json();
      if (
        metadata.version !== policy.pnpm.pinnedVersion ||
        !metadata.dist?.tarball?.startsWith("https://registry.npmjs.org/pnpm/-/") ||
        !metadata.dist?.integrity?.startsWith("sha512-")
      )
        throw new Error("PNPM_METADATA_INVALID");
      const archiveResponse = await fetch(metadata.dist.tarball);
      if (!archiveResponse.ok) throw new Error("PNPM_DOWNLOAD_FAILED");
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      if (
        "sha512-" + createHash("sha512").update(archive).digest("base64") !==
        metadata.dist.integrity
      )
        throw new Error("PNPM_CHECKSUM_MISMATCH");
      const tarball = path.join(temporary, "pnpm.tgz");
      await writeFile(tarball, archive);
      run("tar", ["-xzf", tarball, "-C", temporary]);
      await unlink(tarball);
      if (await exists(destination)) throw new Error("PNPM_DESTINATION_NOT_OWNED");
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  await assertNoLinks(cli);
  process.env.NINA_INTERNAL_PNPM_CLI = cli;
  const version = run(process.execPath, [cli, "--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!supportedVersion(version, policy.pnpm)) throw new Error("PNPM_UNSUPPORTED");
  // pnpm child scripts also need a shim on PATH. pnpm itself uses the absolute
  // node entry above; shell-launched package scripts use its generated shim.
  const bin = path.join(destination, "bin");
  await mkdir(bin, { recursive: true });
  if (platform === "win32")
    await writeFile(path.join(bin, "pnpm.cmd"), `@"${process.execPath}" "${cli}" %*\r\n`);
  else
    await writeFile(
      path.join(bin, "pnpm"),
      `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${cli.replaceAll("'", "'\\''")}' "$@"\n`,
      { mode: 0o700 },
    );
  process.env.PATH = bin + path.delimiter + process.env.PATH;
  return version;
}
async function closed(state, includeIntegration = false) {
  const roots = [
    appRoot,
    ...(includeIntegration
      ? [
          path.join(configRoot, "integration"),
          path.join(source, "apps/desktop"),
          path.join(source, "apps/mcp-server"),
          path.join(source, "plugins/call-nina/bin"),
        ]
      : []),
  ];
  if (await running(roots))
    throw new Error("INSTALLATION_RUNNING: close Call Nina and its active helpers, then retry.");
  if (state) await assertInstallation(state);
}
async function install(state) {
  if (state && state.source !== source)
    throw new Error("SOURCE_CHECKOUT_MISMATCH: run the installer from its recorded checkout.");
  if (!state && (await exists(appRoot))) throw new Error("INSTALL_DESTINATION_NOT_OWNED");
  if (state) await closed(state);
  const pnpm = await ensurePnpm();
  run(process.execPath, [path.join(source, "scripts/build/setup.mjs"), "--profile", "build"]);
  run(process.execPath, [path.join(source, "scripts/build/package-local.mjs")]);
  const built = path.join(
    source,
    "release/local",
    platform === "linux"
      ? "linux-unpacked"
      : platform === "win32"
        ? "win-unpacked"
        : process.arch === "arm64"
          ? "mac-arm64/Call Nina.app"
          : "mac/Call Nina.app",
  );
  await mkdir(path.dirname(appRoot), { recursive: true, mode: 0o700 });
  await assertNoLinks(appRoot);
  const backup = `${appRoot}.previous`;
  if (await exists(backup))
    throw new Error("PREVIOUS_INSTALLATION_PRESENT: preserve/recover it before retrying.");
  const stage = await mkdtemp(path.join(path.dirname(appRoot), ".call-nina-stage-"));
  let replaced = false;
  let previousMoved = false;
  let committed = false;
  let next;
  try {
    await cp(built, stage, { recursive: true, verbatimSymlinks: true });
    const id = state?.id || randomUUID();
    await atomicJson(path.join(stage, markerName), { id, kind: "call-nina-installation" });
    next = {
      schemaVersion: 1,
      kind: "call-nina-installation",
      id,
      source,
      platform,
      architecture: process.arch,
      appRoot,
      executable,
      revision: git(["rev-parse", "HEAD"]),
      dirtySource: !!git(["status", "--porcelain"]),
      installedAt: new Date().toISOString(),
      node: process.versions.node,
      pnpm,
      files: await inventory(stage),
    };
    if (state) {
      await closed(state);
      if (JSON.stringify(await inventory(appRoot)) !== JSON.stringify(state.files))
        throw new Error(
          "INSTALLATION_CHANGED: preserve extra or modified app files before updating.",
        );
      await rename(appRoot, backup);
      previousMoved = true;
    }
    await rename(stage, appRoot);
    replaced = true;
    next.registration = await registerLaunchers(state?.registration);
    await atomicJson(stateFile, next);
    committed = true;
    if (previousMoved) await removeInventory(state, backup);
    console.log(
      `Installed ${next.revision}${next.dirtySource ? " (with local changes)" : ""}\nLaunch: ${executable}`,
    );
  } catch (error) {
    if (!committed) {
      if (error.registration) await unregisterLaunchers(error.registration);
      if (replaced && next) await removeInventory(next);
      if (previousMoved) {
        await rename(backup, appRoot);
        await registerLaunchers(state?.registration);
      }
    }
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
async function question(message) {
  if (!process.stdin.isTTY) throw new Error("INTERACTIVE_CONFIRMATION_REQUIRED");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}
async function uninstall(state) {
  if (!state) {
    console.log("No owned installation found.");
    return;
  }
  await closed(state, true);
  const choice = await question(
    "Remove: [1] app and launchers (default), [2] also Call Nina plugin, [3] also learner data: ",
  );
  if (!["", "1", "2", "3"].includes(choice)) throw new Error("REMOVAL_CANCELLED");
  if (choice === "3") {
    const { inspectCleanup, removeLearnerData } = await import("./learner-cleanup.mjs");
    const cleanup = await inspectCleanup(bootstrapFile);
    console.log(`Selected learner data root: ${cleanup.root}`);
    if (
      (await question("Permanently delete verified Call Nina learner files? Type DELETE: ")) !==
      "DELETE"
    )
      throw new Error("REMOVAL_CANCELLED");
    // Keep the app available if data ownership cannot be established.
    await closed(state, true);
    await removePlugin();
    await removeLearnerData(cleanup, bootstrapFile);
  } else if (choice === "2") await removePlugin();
  await closed(state, true);
  await unregisterLaunchers(state.registration);
  const removed = await removeInventory(state);
  if (removed) await unlink(stateFile);
  else process.exitCode = 1;
  console.log(
    removed ? "Application removed." : "Partial removal: changed/unrelated files were preserved.",
  );
  console.log("Source checkout, credentials, installer tools, and unrelated files were retained.");
}
async function removePlugin() {
  const { ScopedPluginClient, resolveCodexExecutable } =
    await import("../packages/codex-client/dist/index.js");
  const codex = await resolveCodexExecutable(undefined, process.env);
  if (!codex) throw new Error("CODEX_RUNTIME_REQUIRED_FOR_PLUGIN_REMOVAL");
  await new ScopedPluginClient({
    executable: codex,
    cwd: source,
    sourceVersion: "0.0.0",
  }).uninstall();
  const integration = path.join(configRoot, "integration");
  if (await exists(integration)) {
    await assertNoLinks(integration);
    for (const entry of await readdir(integration, { withFileTypes: true })) {
      const directory = path.join(integration, entry.name);
      if (
        !entry.isDirectory() ||
        !/^[a-f0-9]{20}$/.test(entry.name) ||
        !(await exists(path.join(directory, "owned-files.json")))
      ) {
        console.log(`Retained unverified integration entry: ${entry.name}`);
        continue;
      }
      if (!(await removeOwnedTree(directory)))
        console.log(`Retained changed integration files: ${entry.name}`);
    }
    await rmdir(integration).catch((error) => {
      if (error.code !== "ENOTEMPTY") throw error;
    });
  }
  console.log("Scoped Call Nina plugin removed.");
}
async function main() {
  const state = await readState();
  if (command === "status") {
    if (!state) {
      console.log("Not installed.");
      return;
    }
    await assertInstallation(state);
    console.log(
      JSON.stringify(
        {
          ...state,
          files: undefined,
          registration: undefined,
          running: await running([appRoot]),
          launcher: await registrationStatus(state.registration),
          intact: JSON.stringify(await inventory(appRoot)) === JSON.stringify(state.files),
        },
        null,
        2,
      ),
    );
    return;
  }
  await mkdir(installerRoot, { recursive: true, mode: 0o700 });
  await assertOwnedPath(installerRoot);
  const lock = path.join(installerRoot, "operation.lock");
  // A stale lock is deliberately not broken based on a recycled PID.
  const handle = await open(lock, "wx", 0o600).catch(() => {
    throw new Error("INSTALLER_BUSY: another operation or an interrupted operation owns the lock.");
  });
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, command }));
    // update's child must take the same lock after the fast-forward.
    if (command === "update") {
      if (!state || state.source !== source) throw new Error("INSTALLATION_SOURCE_MISMATCH");
      await closed(state);
      if (git(["status", "--porcelain"])) throw new Error("UPDATE_REQUIRES_CLEAN_CHECKOUT");
      git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
      run("git", ["pull", "--ff-only"]);
    } else if (command === "uninstall") await uninstall(state);
    else await install(state);
  } finally {
    await handle.close();
    await unlink(lock);
  }
  if (command === "update")
    run(process.execPath, [path.join(source, "install/install.mjs"), "install"]);
}
main().catch((error) => {
  console.error(error.message || "INSTALLATION_FAILED");
  process.exitCode = 1;
});
