#!/usr/bin/env node

import { unlink } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import {
  applicationLogFiles,
  clearLifecycleLogs,
  killMode,
  lifecycleModes,
  lifecyclePaths,
  startMode,
  statusMode,
} from "./lib/lifecycle.mjs";

import {
  formatLog,
  logViewOptions,
  matchesLog,
  parseLogLine,
  readLogBatch,
} from "./lib/log-view.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const runtimeRoot = path.join(root, ".runtime");
const [action, mode, ...flags] = process.argv.slice(2);

function assertNoUnknownFlags(allowed) {
  const unknown = flags.filter((flag) => !allowed.includes(flag));
  if (unknown.length > 0) throw new Error(`Unknown lifecycle flag: ${unknown.join(", ")}`);
}

async function status() {
  for (const lifecycleMode of lifecycleModes) {
    const result = await statusMode({ mode: lifecycleMode, runtimeRoot });
    process.stdout.write(
      `${result.mode}: ${result.status}${result.pid ? ` pid=${result.pid}` : ""}${result.reason ? ` reason=${result.reason}` : ""}\n`,
    );
  }
}

async function kill() {
  let incomplete = false;
  for (const lifecycleMode of lifecycleModes) {
    if (lifecycleMode === "verify") {
      const state = await statusMode({ mode: lifecycleMode, runtimeRoot });
      if (["ready", "starting"].includes(state.status)) {
        try {
          const { requestVerification } = await import("./lib/verification-client.mjs");
          const result = await requestVerification({ action: "stop" });
          process.stdout.write(
            `verify: ${result.status} cleanup=${result.failures?.length || result.notes?.length ? "incomplete" : "complete"}\n`,
          );
          if (result.failures?.length || result.notes?.length) incomplete = true;
        } catch {
          process.stderr.write(
            "verify: retained; use make verify-stop after the active operation finishes.\n",
          );
          incomplete = true;
        }
        continue;
      }
    }
    const result = await killMode({ mode: lifecycleMode, runtimeRoot });
    process.stdout.write(
      `${result.mode}: ${result.status}${result.reason ? ` reason=${result.reason}` : ""}\n`,
    );
    if (result.status === "unsafe-state-retained") incomplete = true;
  }
  if (incomplete) process.exitCode = 1;
}

async function logs(args = [mode, ...flags].filter(Boolean), selectedMode, signal) {
  const options = logViewOptions(args);
  const followedAt = new Date().toISOString();
  const active = (
    await Promise.all(
      (selectedMode ? [selectedMode] : lifecycleModes).map((mode) =>
        statusMode({ mode, runtimeRoot }),
      ),
    )
  ).filter((state) => state.runId && state.startedAt);
  const since = active.map((state) => state.startedAt).sort()[0] ?? followedAt;
  const runIds = new Set(active.map((state) => state.runId));
  const positions = new Map();
  const unreadable = new Set();
  let initial = true;
  let displayedDate;
  let observedRun = active.length > 0;
  process.stdout.write(
    `Call Nina logs · ${options.level.toUpperCase()}+ · ${options.scope === "history" ? "history" : active.length ? "current run" : "new records only (no running app)"} · UTC\n`,
  );
  process.stdout.write("LEVEL=debug for details · SCOPE=history for earlier runs\n");
  while (!signal?.aborted) {
    // Resolve again so onboarding, folder switches and newly created logs are discovered.
    const files = [
      ...new Set([
        ...lifecycleModes.map((lifecycleMode) => lifecyclePaths(runtimeRoot, lifecycleMode).log),
        ...(await applicationLogFiles()).filter((file) => file.endsWith(".log")),
      ]),
    ];
    for (const file of positions.keys()) {
      if (!files.includes(file)) positions.delete(file);
    }
    const records = [];
    for (const file of files) {
      try {
        const previous = positions.get(file);
        const batch = await readLogBatch(file, previous);
        unreadable.delete(file);
        if (batch.cursor) positions.set(file, batch.cursor);
        for (const line of batch.lines) {
          const record = parseLogLine(line);
          const inScope =
            options.scope === "history" ||
            runIds.has(record.fields.run) ||
            (record.timestamp
              ? record.timestamp >= since
              : !initial && previous?.identity === batch.cursor?.identity);
          if (inScope && matchesLog(record, options)) records.push(record);
        }
      } catch {
        if (!unreadable.has(file)) {
          process.stderr.write(
            `WARN lifecycle LOG_READ_FAILED · Cannot read ${path.basename(file)}; continuing with other logs.\n`,
          );
          unreadable.add(file);
        }
      }
    }
    records.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const visible = initial ? (options.lines === 0 ? [] : records.slice(-options.lines)) : records;
    for (const record of visible) {
      const date = record.timestamp.slice(0, 10);
      if (options.format === "pretty" && date && date !== displayedDate) {
        process.stdout.write(`── ${date} UTC ──\n`);
        displayedDate = date;
      }
      process.stdout.write(`${formatLog(record, options)}\n`);
    }
    if (!options.follow) return;
    if (selectedMode) {
      const state = await statusMode({ mode: selectedMode, runtimeRoot });
      if (["ready", "starting"].includes(state.status)) observedRun = true;
      else if (
        observedRun &&
        (state.status === "stopped" || (state.status === "stale" && state.reason === "not-running"))
      ) {
        process.stdout.write("The app has stopped. Run make debug to open it again.\n");
        return;
      }
    }
    if (initial)
      process.stdout.write(
        "Following new records. Ctrl-C stops log following; make kill stops the app.\n",
      );
    initial = false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function logsClear() {
  const logsDirectory = path.join(runtimeRoot, "logs");
  process.stdout.write(`Resolved Call Nina log directory: ${logsDirectory}\n`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Log clearing requires an interactive terminal confirmation.");
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question('Type "clear" to remove only these Call Nina logs: ');
  readline.close();
  if (answer !== "clear") throw new Error("Log clearing cancelled.");
  const removed = await clearLifecycleLogs(runtimeRoot);
  for (const file of await applicationLogFiles()) {
    try {
      await unlink(file);
      removed.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  process.stdout.write(`Removed ${removed.length} Call Nina log file(s).\n`);
}

try {
  if (action === "debug") {
    if (mode) throw new Error("debug does not accept arguments; use logs with explicit flags.");
    logViewOptions(["--follow"]);
    const current = await statusMode({ mode: "dev", runtimeRoot });
    const controller = new AbortController();
    const stopFollowing = () => controller.abort();
    process.on("SIGINT", stopFollowing);
    let startup;
    try {
      if (!["ready", "starting"].includes(current.status)) {
        process.stdout.write("Starting development; build progress follows below…\n");
        startup = startMode({
          mode: "dev",
          runtimeRoot,
          cwd: root,
          command: ["pnpm", "run", "service:dev"],
          timeoutMs: 180_000,
        }).catch((error) => {
          controller.abort();
          throw error;
        });
      }
      await Promise.all([startup, logs(["--follow"], "dev", controller.signal)]);
    } finally {
      controller.abort();
      // Finish recording startup ownership even when log following is interrupted.
      await startup?.catch(() => {});
      process.removeListener("SIGINT", stopFollowing);
    }
  } else if (action === "start") {
    if (!["dev", "prd"].includes(mode))
      throw new Error("Start requires mode dev or prd; use make verify-start for verification.");
    assertNoUnknownFlags([]);
    const state = await startMode({
      mode,
      runtimeRoot,
      cwd: root,
      command: ["pnpm", "run", `service:${mode}`],
      timeoutMs: mode === "dev" ? 180_000 : 60_000,
    });
    process.stdout.write(`${mode}: ready pid=${state.pid}\n`);
  } else if (action === "status") {
    if (mode) throw new Error("Status does not accept arguments.");
    await status();
  } else if (action === "kill") {
    if (mode) throw new Error("Kill does not accept arguments.");
    await kill();
  } else if (action === "logs") {
    await logs();
  } else if (action === "logs-clear") {
    if (mode) throw new Error("logs-clear does not accept arguments.");
    await logsClear();
  } else {
    throw new Error(
      "Usage: lifecycle.mjs debug | start <dev|prd> | status | kill | logs [--follow] [--errors] | logs-clear",
    );
  }
} catch (error) {
  process.stderr.write(`[LIFECYCLE_ERROR] ${error.message}\n`);
  process.exitCode = 1;
}
