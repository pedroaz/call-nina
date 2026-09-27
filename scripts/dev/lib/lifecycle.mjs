import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export const lifecycleModes = ["dev", "prd", "verify"];
const maxLogBytes = 5 * 1024 * 1024;
const retainedLogs = 10;

function assertMode(mode) {
  if (!lifecycleModes.includes(mode)) throw new Error(`Unsupported lifecycle mode: ${mode}`);
}

export function lifecyclePaths(root, mode) {
  assertMode(mode);
  const runtimeRoot = path.resolve(root);
  return {
    root: runtimeRoot,
    state: path.join(runtimeRoot, `${mode}.json`),
    ready: path.join(runtimeRoot, `${mode}.ready.json`),
    logs: path.join(runtimeRoot, "logs"),
    log: path.join(runtimeRoot, "logs", `${mode}.log`),
  };
}

export async function applicationLogFiles() {
  const candidates = [];
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || ".", ".config");
  candidates.push(path.join(configRoot, "Electron", "bootstrap.json"));
  candidates.push(path.join(configRoot, "Call Nina", "bootstrap.json"));
  candidates.push(path.join(configRoot, "call-nina", "bootstrap.json"));
  const files = [];
  for (const bootstrap of candidates) {
    try {
      const pointer = JSON.parse(await readFile(bootstrap, "utf8"));
      if (typeof pointer.dataRoot !== "string" || !path.isAbsolute(pointer.dataRoot)) continue;
      const logs = path.join(pointer.dataRoot, "logs");
      for (const name of [
        "desktop.log",
        "app-server.log",
        "mcp-server.log",
        "desktop-app-server.log",
      ]) {
        for (let index = 0; index < retainedLogs; index += 1) {
          files.push(path.join(logs, `${name}${index === 0 ? "" : `.${index}`}`));
        }
      }
      break;
    } catch {
      // The desktop may not have configured a data root yet.
    }
  }
  for (const bootstrap of candidates) {
    for (let index = 0; index < retainedLogs; index += 1) {
      files.push(
        path.join(path.dirname(bootstrap), `bootstrap.log${index === 0 ? "" : `.${index}`}`),
      );
    }
  }
  return [...new Set(files)];
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  await chmod(target, 0o600);
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function readReadinessJson(target) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await readJson(target);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(10);
    }
  }
  throw lastError;
}

async function processStartTicks(pid) {
  try {
    const contents = await readFile(`/proc/${pid}/stat`, "utf8");
    const afterName = contents
      .slice(contents.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/);
    return afterName[19];
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return undefined;
    throw error;
  }
}

export async function inspectOwnedProcess(state) {
  if (!Number.isSafeInteger(state?.pid) || state.pid <= 1 || typeof state.startTicks !== "string") {
    return { owned: false, reason: "invalid-state" };
  }
  const observedTicks = await processStartTicks(state.pid);
  if (!observedTicks) return { owned: false, reason: "not-running" };
  if (observedTicks !== state.startTicks) return { owned: false, reason: "pid-reused" };
  return { owned: true, reason: "running" };
}

async function rotateLog(log) {
  if (!(await pathExists(log))) return;
  const info = await stat(log);
  if (info.size < maxLogBytes) return;
  await rm(`${log}.${retainedLogs - 1}`, { force: true });
  for (let index = retainedLogs - 2; index >= 1; index -= 1) {
    if (await pathExists(`${log}.${index}`)) await rename(`${log}.${index}`, `${log}.${index + 1}`);
  }
  await rename(log, `${log}.1`);
}

async function lifecycleLog(log, level, code, runId, message) {
  const failed = level === "ERROR";
  const phase = failed ? "failed" : code === "LIFECYCLE_STARTING" ? "started" : "completed";
  const outcome = failed ? "error" : "ok";
  const line = `${new Date().toISOString()} ${level} lifecycle ${code} run=${runId} session=- correlation=- action=lifecycle phase=${phase} outcome=${outcome} duration_ms=- ${message}\n`;
  await appendFile(log, line, { encoding: "utf8", mode: 0o600 });
}

async function readState(paths) {
  try {
    return await readJson(paths.state);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`Invalid lifecycle state at ${paths.state}: ${error.message}`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function signalTarget(target, signal) {
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function processGroupAlive(processGroupId) {
  return signalTarget(-processGroupId, 0);
}

function hasRecordedProcessGroup(state) {
  return Number.isSafeInteger(state?.processGroupId) && state.processGroupId === state.pid;
}

function retainedStaleReason(state, identity) {
  if (identity.reason === "pid-reused") return "pid-reused";
  if (
    identity.reason === "not-running" &&
    hasRecordedProcessGroup(state) &&
    processGroupAlive(state.processGroupId)
  ) {
    return "orphaned-process-group";
  }
  return undefined;
}

async function terminateStartedProcess(
  state,
  { graceMs = 1_000, requireLeaderIdentity = true } = {},
) {
  const identity = await inspectOwnedProcess(state);
  if (requireLeaderIdentity && !identity.owned) return false;

  const processGroupId = state.processGroupId === state.pid ? state.processGroupId : undefined;
  const target = Number.isSafeInteger(processGroupId) ? -processGroupId : state.pid;
  signalTarget(target, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const alive = Number.isSafeInteger(processGroupId)
      ? processGroupAlive(processGroupId)
      : (await inspectOwnedProcess(state)).owned;
    if (!alive) return true;
    await delay(50);
  }

  const stillAlive = Number.isSafeInteger(processGroupId)
    ? processGroupAlive(processGroupId)
    : (await inspectOwnedProcess(state)).owned;
  if (stillAlive) {
    signalTarget(target, "SIGKILL");
    const killDeadline = Date.now() + graceMs;
    while (Date.now() < killDeadline) {
      const alive = Number.isSafeInteger(processGroupId)
        ? processGroupAlive(processGroupId)
        : (await inspectOwnedProcess(state)).owned;
      if (!alive) break;
      await delay(50);
    }
  }
  return true;
}

async function acquireStartLock(lock) {
  try {
    await mkdir(lock, { mode: 0o700 });
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  const locked = () =>
    new Error("LIFECYCLE_START_LOCKED: another start is in progress or its ownership is unknown.");
  const ownerFile = path.join(lock, "owner.json");
  let owner;
  try {
    owner = await readJson(ownerFile);
  } catch {
    // A live starter may still be writing its owner record.
    throw locked();
  }
  if ((await inspectOwnedProcess(owner)).reason !== "not-running") throw locked();

  // Only one caller may reclaim a lock whose recorded owner has exited.
  const reclaim = path.join(lock, "reclaim");
  try {
    await mkdir(reclaim, { mode: 0o700 });
  } catch (error) {
    if (["EEXIST", "ENOENT"].includes(error.code)) throw locked();
    throw error;
  }
  try {
    const current = await readJson(ownerFile);
    if (
      current.pid !== owner.pid ||
      current.startTicks !== owner.startTicks ||
      (await inspectOwnedProcess(current)).reason !== "not-running"
    )
      throw locked();
    await unlink(ownerFile);
    await rmdir(reclaim);
    // Do not recursively delete unknown files or another caller's lock.
    await rmdir(lock);
  } catch (error) {
    await rmdir(reclaim).catch(() => {});
    throw error;
  }
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") throw locked();
    throw error;
  }
}

// Serialize starts across modes, including verification, without signalling another app.
export async function startMode(options) {
  const root = path.resolve(options.runtimeRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, "start.lock");
  await acquireStartLock(lock);
  try {
    await writeJsonAtomic(path.join(lock, "owner.json"), {
      pid: process.pid,
      startTicks: await processStartTicks(process.pid),
    });
    for (const mode of lifecycleModes) {
      const current = await statusMode({ mode, runtimeRoot: root });
      if (
        !["stopped", "stale"].includes(current.status) ||
        (current.status === "stale" && current.reason !== "not-running")
      ) {
        throw new Error(`LIFECYCLE_APP_ALREADY_RUNNING_OR_RETAINED:${mode}`);
      }
    }
    return await startModeUnlocked(options);
  } finally {
    await rm(path.join(lock, "owner.json"), { force: true });
    await rm(lock, { recursive: true });
  }
}

async function startModeUnlocked({
  mode,
  runtimeRoot,
  command,
  cwd,
  timeoutMs = 60_000,
  environment = process.env,
  detached = true,
}) {
  assertMode(mode);
  if (!Array.isArray(command) || command.length === 0)
    throw new Error("A service command is required.");
  const paths = lifecyclePaths(runtimeRoot, mode);
  const runtimeExisted = await pathExists(paths.root);
  await mkdir(paths.logs, { recursive: true, mode: 0o700 });
  if (!runtimeExisted) await chmod(paths.root, 0o700);
  await chmod(paths.logs, 0o700);

  const previous = await readState(paths);
  if (previous) {
    const identity = await inspectOwnedProcess(previous);
    if (identity.owned) throw new Error(`${mode} is already running with PID ${previous.pid}.`);
    const retainedReason = retainedStaleReason(previous, identity);
    if (retainedReason) {
      throw new Error(
        `${mode} has retained lifecycle state (${retainedReason}); refusing to overwrite an ownership record that cannot be signalled safely.`,
      );
    }
    await unlink(paths.state);
  }
  await rm(paths.ready, { force: true });
  await rotateLog(paths.log);

  const logHandle = await open(
    paths.log,
    fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY,
    0o600,
  );
  await chmod(paths.log, 0o600);
  const runId = randomUUID();
  await lifecycleLog(paths.log, "INFO", "LIFECYCLE_STARTING", runId, `Starting ${mode} service.`);
  const [executable, ...args] = command;
  const child = spawn(executable, args, {
    cwd,
    env: { ...environment, CALL_NINA_READY_FILE: paths.ready, CALL_NINA_RUN_ID: runId },
    detached,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  });
  let childError;
  child.on("error", (error) => {
    childError = error;
  });
  await logHandle.close();
  if (detached) child.unref();

  let startTicks;
  for (let attempt = 0; attempt < 20 && !startTicks; attempt += 1) {
    if (childError) throw new Error(`Could not start ${mode}: ${childError.message}`);
    startTicks = await processStartTicks(child.pid);
    if (!startTicks) await delay(10);
  }
  if (!startTicks) throw new Error(`Could not record process identity for ${mode}.`);

  let state = {
    schemaVersion: 1,
    mode,
    status: "starting",
    pid: child.pid,
    startTicks,
    runId,
    startedAt: new Date().toISOString(),
    command,
    processGroupId: detached ? child.pid : undefined,
  };
  await writeJsonAtomic(paths.state, state);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const identity = await inspectOwnedProcess(state);
    if (!identity.owned) {
      await terminateStartedProcess(state, { requireLeaderIdentity: false });
      await rm(paths.state, { force: true });
      await lifecycleLog(
        paths.log,
        "ERROR",
        "LIFECYCLE_EXITED_EARLY",
        runId,
        `${mode} exited before readiness.`,
      );
      throw new Error(`${mode} exited before reporting readiness. See ${paths.log}.`);
    }
    if (await pathExists(paths.ready)) {
      let ready;
      try {
        ready = await readReadinessJson(paths.ready);
      } catch (error) {
        await terminateStartedProcess(state, { requireLeaderIdentity: false });
        await rm(paths.state, { force: true });
        await rm(paths.ready, { force: true });
        throw new Error(`${mode} emitted malformed readiness: ${error.message}`);
      }
      if (ready.status !== "ready" || ready.runId !== runId) {
        await terminateStartedProcess(state, { requireLeaderIdentity: false });
        await rm(paths.state, { force: true });
        await rm(paths.ready, { force: true });
        throw new Error(`${mode} emitted an invalid or stale readiness signal.`);
      }
      state = { ...state, status: "ready", readyAt: new Date().toISOString() };
      await writeJsonAtomic(paths.state, state);
      await lifecycleLog(paths.log, "INFO", "LIFECYCLE_READY", runId, `${mode} is ready.`);
      return state;
    }
    await delay(50);
  }

  await terminateStartedProcess(state, { requireLeaderIdentity: false });
  await rm(paths.state, { force: true });
  await rm(paths.ready, { force: true });
  await lifecycleLog(
    paths.log,
    "ERROR",
    "LIFECYCLE_START_TIMEOUT",
    runId,
    `${mode} did not become ready within ${timeoutMs} ms.`,
  );
  throw new Error(`${mode} did not become ready within ${timeoutMs} ms. See ${paths.log}.`);
}

export async function statusMode({ mode, runtimeRoot }) {
  const paths = lifecyclePaths(runtimeRoot, mode);
  const state = await readState(paths);
  if (!state) return { mode, status: "stopped" };
  const identity = await inspectOwnedProcess(state);
  if (!identity.owned) {
    const retainedReason = retainedStaleReason(state, identity);
    return {
      mode,
      status: retainedReason === "orphaned-process-group" ? "orphaned" : "stale",
      reason: retainedReason ?? identity.reason,
      pid: state.pid,
    };
  }
  return {
    mode,
    status: state.status,
    pid: state.pid,
    runId: state.runId,
    startedAt: state.startedAt,
  };
}

export async function killMode({ mode, runtimeRoot, graceMs = 5_000 }) {
  const paths = lifecyclePaths(runtimeRoot, mode);
  const state = await readState(paths);
  if (!state) return { mode, status: "already-stopped" };
  const identity = await inspectOwnedProcess(state);
  if (!identity.owned) {
    const retainedReason = retainedStaleReason(state, identity);
    if (retainedReason) {
      return { mode, status: "unsafe-state-retained", reason: retainedReason, pid: state.pid };
    }
    await rm(paths.state, { force: true });
    await rm(paths.ready, { force: true });
    return { mode, status: "stale-removed", reason: identity.reason };
  }

  await terminateStartedProcess(state, { graceMs });
  await rm(paths.state, { force: true });
  await rm(paths.ready, { force: true });
  await lifecycleLog(paths.log, "INFO", "LIFECYCLE_STOPPED", state.runId, `${mode} stopped.`);
  return { mode, status: "stopped", pid: state.pid };
}

export async function clearLifecycleLogs(runtimeRoot) {
  const logs = path.join(path.resolve(runtimeRoot), "logs");
  if (!(await pathExists(logs))) return [];
  const removed = [];
  for (const mode of lifecycleModes) {
    for (let index = 0; index < retainedLogs; index += 1) {
      const target = path.join(logs, `${mode}.log${index === 0 ? "" : `.${index}`}`);
      if (await pathExists(target)) {
        await unlink(target);
        removed.push(target);
      }
    }
  }
  return removed;
}
