#!/usr/bin/env node

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const mebibyte = 1024 * 1024;
const profile = process.argv[2] ?? "local";
if (!["local", "appimage"].includes(profile) || process.argv.length > 3) {
  throw new Error("Usage: node scripts/build/inspect-package.mjs [local|appimage]");
}
const outputRoot = path.join(repositoryRoot, "release", profile);

async function exists(target) {
  return stat(target)
    .then(() => true)
    .catch((error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
}

async function measure(root, relative = "", rejectLinks = false) {
  const metadata = await stat(path.join(root, relative));
  if (metadata.isFile()) return { bytes: metadata.size, files: 1 };
  if (!metadata.isDirectory()) throw new Error(`OD_PACKAGE_ENTRY_UNSAFE:${relative}`);
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      if (rejectLinks) throw new Error(`OD_PACKAGE_LINK_UNSAFE:${path.join(relative, entry.name)}`);
      files += 1;
      continue;
    }
    const child = await measure(root, path.join(relative, entry.name), rejectLinks);
    bytes += child.bytes;
    files += child.files;
  }
  return { bytes, files };
}

function unpackedDirectory() {
  if (process.platform === "linux")
    return path.join(
      outputRoot,
      process.arch === "arm64" ? "linux-arm64-unpacked" : "linux-unpacked",
    );
  if (process.platform === "win32") return path.join(outputRoot, "win-unpacked");
  return path.join(
    outputRoot,
    process.arch === "arm64" ? "mac-arm64/Call Nina.app" : "mac/Call Nina.app",
  );
}

function asarPath(unpacked) {
  return process.platform === "darwin"
    ? path.join(unpacked, "Contents/Resources/app.asar")
    : path.join(unpacked, "resources/app.asar");
}

const unpacked = unpackedDirectory();
if (!(await exists(unpacked))) throw new Error("OD_PACKAGE_UNPACKED_MISSING");
const helper = path.join(path.dirname(asarPath(unpacked)), "mcp-helper");
if (!(await exists(helper))) throw new Error("OD_PACKAGE_HELPER_MISSING");
const helperMetrics = await measure(helper, "", true);
if (helperMetrics.bytes > 10 * mebibyte || helperMetrics.files > 20) {
  throw new Error(
    `OD_PACKAGE_HELPER_BUDGET_EXCEEDED:${helperMetrics.bytes}:${helperMetrics.files}`,
  );
}

const evidence = {
  schemaVersion: 1,
  helper: helperMetrics,
};
const unpackedMetrics = await measure(unpacked);
const appAsar = asarPath(unpacked);
if (!(await exists(appAsar))) throw new Error("OD_PACKAGE_ASAR_MISSING");
const asarMetrics = await measure(appAsar);
if (asarMetrics.bytes > 10 * mebibyte) {
  throw new Error(`OD_PACKAGE_ASAR_BUDGET_EXCEEDED:${asarMetrics.bytes}`);
}
if (process.platform === "linux" && unpackedMetrics.bytes > 300 * mebibyte) {
  throw new Error(`OD_PACKAGE_UNPACKED_BUDGET_EXCEEDED:${unpackedMetrics.bytes}`);
}
evidence.unpacked = unpackedMetrics;
evidence.appAsar = asarMetrics;

process.stdout.write(`[PASS] PACKAGE_FOOTPRINT: ${JSON.stringify(evidence)}\n`);
