#!/usr/bin/env node

const { existsSync, lstatSync, readFileSync, realpathSync } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(78);
}

function absolutePath(value, code) {
  if (!value || !path.isAbsolute(value) || value.includes("\0")) fail(code);
  return path.normalize(value);
}

function regularFile(candidate) {
  try {
    const metadata = lstatSync(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function resolveBootstrapFile() {
  const configured = process.env.CALL_NINA_BOOTSTRAP_FILE;
  if (configured) return absolutePath(configured, "OD_MCP_BOOTSTRAP_INVALID");

  const configRoots = [
    process.env.CALL_NINA_CONFIG_DIR,
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support/Call Nina")
      : undefined,
    process.platform === "win32" && process.env.APPDATA
      ? path.join(process.env.APPDATA, "Call Nina")
      : undefined,
    process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "Call Nina") : undefined,
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "dev.callnina.app")
      : undefined,
    path.join(os.homedir(), ".config", "Call Nina"),
    path.join(os.homedir(), ".config", "dev.callnina.app"),
  ].filter(Boolean);
  const candidates = [...new Set(configRoots.map((root) => path.join(root, "bootstrap.json")))];
  const matches = candidates.filter(regularFile);
  if (matches.length !== 1)
    fail(matches.length === 0 ? "OD_MCP_BOOTSTRAP_UNAVAILABLE" : "OD_MCP_BOOTSTRAP_AMBIGUOUS");
  return matches[0];
}

function resolveEntry() {
  const configured = process.env.CALL_NINA_MCP_ENTRY;
  if (configured) {
    const entry = absolutePath(configured, "OD_MCP_ENTRY_INVALID");
    if (!regularFile(entry)) fail("OD_MCP_ENTRY_UNAVAILABLE");
    return entry;
  }
  const roots = [path.resolve(__dirname, ".."), path.resolve(__dirname)];
  const packageCandidates = roots.flatMap((root) => [
    path.resolve(root, "server/index.js"),
    path.resolve(root, "mcp-server/index.js"),
  ]);
  const candidates = packageCandidates.some(regularFile)
    ? packageCandidates
    : roots.map((root) => path.resolve(root, "../../apps/mcp-server/dist/index.js"));
  const matches = candidates.filter(regularFile);
  if (matches.length !== 1)
    fail(matches.length === 0 ? "OD_MCP_ENTRY_UNAVAILABLE" : "OD_MCP_ENTRY_AMBIGUOUS");
  return matches[0];
}

function resolveCurriculumRoot() {
  if (process.env.CALL_NINA_CURRICULUM_ROOT) {
    return absolutePath(process.env.CALL_NINA_CURRICULUM_ROOT, "OD_MCP_CURRICULUM_INVALID");
  }
  const roots = [path.resolve(__dirname, ".."), path.resolve(__dirname)];
  const packageCandidates = roots.map((root) => path.resolve(root, "curriculum"));
  const candidates = packageCandidates.some((candidate) =>
    existsSync(path.join(candidate, "manifest.yaml")),
  )
    ? packageCandidates
    : roots.map((root) => path.resolve(root, "../../content/curriculum"));
  const matches = candidates.filter((candidate) =>
    existsSync(path.join(candidate, "manifest.yaml")),
  );
  if (matches.length !== 1)
    fail(matches.length === 0 ? "OD_MCP_CURRICULUM_UNAVAILABLE" : "OD_MCP_CURRICULUM_AMBIGUOUS");
  return matches[0];
}

function runProbe() {
  const bootstrapFile = process.env.CALL_NINA_BOOTSTRAP_FILE;
  const dataRoot = process.env.CALL_NINA_DATA_ROOT;
  if (
    !bootstrapFile ||
    !dataRoot ||
    !path.isAbsolute(bootstrapFile) ||
    !path.isAbsolute(dataRoot)
  ) {
    fail("OD_MCP_PROBE_BOOTSTRAP_INVALID");
  }
  const bootstrap = JSON.parse(readFileSync(bootstrapFile, "utf8"));
  const database = new DatabaseSync(":memory:");
  const row = database.prepare("select sqlite_version() as version").get();
  database.close();
  if (!row || typeof row.version !== "string") fail("OD_MCP_PROBE_SQLITE_UNAVAILABLE");
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      dataRootResolved: realpathSync(bootstrap.dataRoot) === realpathSync(dataRoot),
      sqliteVersion: row.version,
    })}\n`,
  );
}

if (process.argv[2] === "--probe") {
  runProbe();
  process.exit(0);
}

const environment = {
  ...process.env,
  CALL_NINA_BOOTSTRAP_FILE: resolveBootstrapFile(),
  CALL_NINA_CURRICULUM_ROOT: resolveCurriculumRoot(),
};
const child = spawn(process.execPath, [resolveEntry(), ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, "../.."),
  env: environment,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", () => fail("OD_MCP_ENTRY_START_FAILED"));
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
