#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processOutputLevel } from "../../../scripts/dev/lib/log-view.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(desktopRoot, "../..");
const desktopRequire = createRequire(path.join(desktopRoot, "package.json"));
const nodeTools = {
  tsc: desktopRequire.resolve("typescript/bin/tsc"),
  vite: path.join(path.dirname(desktopRequire.resolve("vite/package.json")), "bin/vite.js"),
};
const mode = process.argv[2];
if (mode !== "dev" && mode !== "prd") {
  throw new Error("Desktop service mode must be dev or prd.");
}

const children = new Set();
let stopping = false;
let failService;
const serviceRunId = process.env["CALL_NINA_RUN_ID"] ?? `service_${Date.now().toString(36)}`;
const serviceSessionId = `session_${process.pid.toString(36)}`;
const serviceFailure = new Promise((_, reject) => {
  failService = reject;
});

function start(command, args, environment = process.env, essential = false) {
  // Own the actual tool process: killing a pnpm wrapper leaves its watchers alive.
  const nodeTool = nodeTools[command];
  if (!nodeTool && command !== "node" && command !== "electron") {
    throw new Error("Unsupported desktop service tool.");
  }
  const executable = command === "electron" ? desktopRequire("electron") : process.execPath;
  const child = spawn(executable, nodeTool ? [nodeTool, ...args] : args, {
    cwd: command === "node" ? repositoryRoot : desktopRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  attachOutput(child, command, command === "electron" ? "electron" : "build");
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (essential && !stopping) {
      failService(
        new Error(`${command} service exited with ${String(code)}${signal ? ` (${signal})` : ""}.`),
      );
    }
  });
  return child;
}

function attachOutput(child, command, component) {
  let stdout = "";
  let stderr = "";
  const emit = (stream, line) => {
    const home = process.env["HOME"];
    const safe = line
      .replaceAll("\u001b[2K", "")
      // eslint-disable-next-line no-control-regex -- Strip terminal controls before displaying redacted logs.
      .replaceAll(/\u001b\[[0-9;]*m/gu, "")
      .replaceAll(repositoryRoot, "<workspace>")
      .replaceAll(/\/(?:home|Users)\/[^\s:]+/gu, "<private-path>")
      .replaceAll(/\/tmp\/[^\s:]+/gu, "<temporary-path>")
      .replaceAll(home ?? "<missing-home-never-matches>", "<home>")
      .trim()
      .slice(0, 1_000);
    if (!safe) return;
    const level = processOutputLevel(safe, stream, stopping).toUpperCase();
    process.stdout.write(
      `${new Date().toISOString()} ${level} ${component} PROCESS_${stream.toUpperCase()} run=${serviceRunId} session=${serviceSessionId} correlation=- action=${command.replace(/[^a-z0-9]+/giu, "-").toLowerCase()} phase=running outcome=- duration_ms=- ${safe}\n`,
    );
  };
  const consume = (stream, chunk) => {
    const state = stream === "stderr" ? stderr : stdout;
    const lines = `${state}${chunk.toString("utf8")}`.split("\n");
    const remainder = lines.pop() ?? "";
    for (const line of lines) emit(stream, line);
    if (stream === "stderr") stderr = remainder;
    else stdout = remainder;
  };
  child.stdout.on("data", (chunk) => consume("stdout", chunk));
  child.stderr.on("data", (chunk) => consume("stderr", chunk));
  child.once("close", () => {
    if (stdout) emit("stdout", stdout);
    if (stderr) emit("stderr", stderr);
  });
}

async function run(command, args, stage) {
  const startedAt = Date.now();
  const logStage = (phase) => {
    process.stdout.write(
      `${new Date().toISOString()} INFO build DESKTOP_BUILD_STAGE run=${serviceRunId} session=${serviceSessionId} correlation=- action=${stage} phase=${phase} outcome=- duration_ms=${Date.now() - startedAt} ${stage}\n`,
    );
  };
  logStage("started");
  const child = start(command, args);
  const progress = setInterval(() => logStage("running"), 15_000);
  try {
    const [code, signal] = await once(child, "exit");
    if (code !== 0) {
      throw new Error(
        `${stage} failed: ${command} ${signal ? `received ${signal}` : `exited with ${String(code)}`}.`,
      );
    }
    logStage("completed");
  } finally {
    clearInterval(progress);
  }
}

async function waitForVite(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Desktop Vite server did not become ready.");
}

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopChildren(signal);
  });
}

try {
  let rendererUrl;
  if (mode === "dev") {
    await run("node", ["apps/desktop/scripts/generate-css-types.mjs"], "css-module-types");
    await run("tsc", ["-b", "tsconfig.main.json", "tsconfig.preload.json"], "compile-electron");
    await run("vite", ["build", "--config", "vite.main.config.ts"], "bundle-main");
    await run("vite", ["build", "--config", "vite.preload.config.ts"], "bundle-preload");
    start(
      "tsc",
      ["-b", "--watch", "--preserveWatchOutput", "tsconfig.main.json", "tsconfig.preload.json"],
      process.env,
      true,
    );
    start("vite", ["build", "--watch", "--config", "vite.preload.config.ts"], process.env, true);
    start("vite", ["build", "--watch", "--config", "vite.main.config.ts"], process.env, true);
    rendererUrl = "http://127.0.0.1:5173";
    start(
      "vite",
      ["--config", "vite.config.ts", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
      process.env,
      true,
    );
    await waitForVite(rendererUrl);
  }

  const electron = start("electron", ["dist/main/index.js"], {
    ...process.env,
    ...(rendererUrl === undefined ? {} : { CALL_NINA_RENDERER_URL: rendererUrl }),
  });
  const [code, signal] = await Promise.race([once(electron, "exit"), serviceFailure]);
  const wasStopping = stopping;
  stopChildren();
  if (!wasStopping && code !== 0) {
    throw new Error(`Electron exited with ${String(code)}${signal ? ` (${signal})` : ""}.`);
  }
} finally {
  stopChildren();
}
