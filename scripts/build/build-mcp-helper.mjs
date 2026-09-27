#!/usr/bin/env node

import { execFile } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { pnpmCommand } from "../lib/package-command.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const defaultOutput = path.join(repositoryRoot, "release", "mcp-helper");

function parseOutput() {
  const index = process.argv.indexOf("--output");
  const output = index === -1 ? defaultOutput : process.argv[index + 1];
  if (!output || !path.isAbsolute(output) || output.includes("\0")) {
    throw new Error("OD_MCP_HELPER_OUTPUT_INVALID");
  }
  const normalized = path.normalize(output);
  const relative = path.relative(repositoryRoot, normalized);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("OD_MCP_HELPER_OUTPUT_MUST_BE_RELEASE_CHILD");
  }
  return normalized;
}

async function inspectTree(root, relative = "") {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const nested = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`OD_MCP_HELPER_SYMLINK_UNSAFE:${nested}`);
    if (entry.isDirectory()) {
      const child = await inspectTree(root, nested);
      bytes += child.bytes;
      files += child.files;
      continue;
    }
    if (!entry.isFile()) throw new Error(`OD_MCP_HELPER_ENTRY_UNSAFE:${nested}`);
    bytes += (await stat(path.join(root, nested))).size;
    files += 1;
  }
  return { bytes, files };
}

async function main() {
  const output = parseOutput();
  const temporary = `${output}.${process.pid}.next`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(path.join(temporary, "server"), { recursive: true, mode: 0o700 });
  try {
    await execFileAsync(...pnpmCommand(["--filter", "@call-nina/mcp-server", "run", "build"]), {
      cwd: repositoryRoot,
      env: process.env,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    await cp(
      path.join(repositoryRoot, "apps/mcp-server/dist/index.js"),
      path.join(temporary, "server/index.js"),
    );
    const launcher = path.join(repositoryRoot, "plugins/call-nina/bin/call-nina-mcp.cjs");
    await cp(launcher, path.join(temporary, "call-nina-mcp.cjs"));
    await chmod(path.join(temporary, "call-nina-mcp.cjs"), 0o700);
    await writeFile(
      path.join(temporary, "call-nina-mcp"),
      '#!/bin/sh\nset -eu\nexec "$(dirname "$0")/call-nina-mcp.cjs" "$@"\n',
      { encoding: "utf8", mode: 0o700 },
    );
    await writeFile(
      path.join(temporary, "package.json"),
      `${JSON.stringify({ name: "@call-nina/mcp-helper", private: true, type: "module" }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    const serverSource = await readFile(path.join(temporary, "server/index.js"), "utf8");
    if (
      /^(?:import|export)\s[^;\n]*from\s+["'](?:@call-nina\/|@modelcontextprotocol\/|yaml|zod)["']/mu.test(
        serverSource,
      )
    ) {
      throw new Error("OD_MCP_HELPER_BUNDLE_EXTERNAL_DEPENDENCY");
    }
    const metrics = await inspectTree(temporary);
    if (metrics.bytes > 10 * 1024 * 1024 || metrics.files > 20) {
      throw new Error(`OD_MCP_HELPER_BUDGET_EXCEEDED:${metrics.bytes}:${metrics.files}`);
    }

    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await rm(output, { recursive: true, force: true });
    await rename(temporary, output);
    process.stdout.write(
      `[PASS] MCP_HELPER_BUILT: ${JSON.stringify({
        schemaVersion: 1,
        helper: "call-nina-mcp",
        serverEntry: "server/index.js",
        bundledDependencies: true,
        curriculumBundled: false,
        ...metrics,
      })}\n`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
