#!/usr/bin/env node

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
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  codexRuntimeTargets,
  codexRuntimeVersion,
} from "../../packages/codex-client/src/runtime-release.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const releaseRoot = path.join(repositoryRoot, "release");
const output = path.join(releaseRoot, "codex-runtime");
const target = codexRuntimeTargets[`${process.platform}-${process.arch}`];
if (!target) throw new Error("CODEX_PLATFORM_UNSUPPORTED");
if (process.argv.length !== 2) throw new Error("CODEX_STAGE_ARGUMENT_INVALID");
const execFileAsync = promisify(execFile);
const sourceSha256 = "e556f4d21b2cff2108d1f3e426d2397e8659b99fd35d8eb4fddac8647264dd4b";

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(root, relative = "", files = {}) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await inventory(root, name, files);
    else if (!entry.isFile()) throw new Error("CODEX_PACKAGE_ENTRY_UNSAFE");
    else if (name !== "nina-runtime.json") files[name] = await digest(path.join(root, name));
  }
  return files;
}

async function current() {
  try {
    if (!(await lstat(output)).isDirectory()) throw new Error("CODEX_STAGE_TARGET_UNSAFE");
    const receipt = JSON.parse(await readFile(path.join(output, "nina-runtime.json"), "utf8"));
    const actual = await inventory(output);
    const notices = await inventory(path.join(repositoryRoot, "docs/codex-runtime-notices"));
    if (!Object.entries(notices).every(([name, hash]) => actual[`notices/${name}`] === hash))
      return false;
    return (
      receipt.version === codexRuntimeVersion &&
      receipt.target === target.target &&
      receipt.archiveSha256 === target.sha256 &&
      receipt.sourceSha256 === sourceSha256 &&
      Object.keys(actual).length === Object.keys(receipt.files).length &&
      Object.entries(actual).every(([name, hash]) => receipt.files[name] === hash)
    );
  } catch (error) {
    if (error.message === "CODEX_STAGE_TARGET_UNSAFE") throw error;
    return false;
  }
}

async function download(url, expected, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error("CODEX_DOWNLOAD_FAILED");
  const chunks = [];
  let bytes = 0;
  const hash = createHash("sha256");
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 180 * 1024 * 1024) throw new Error("CODEX_DOWNLOAD_TOO_LARGE");
    chunks.push(chunk);
    hash.update(chunk);
  }
  if (hash.digest("hex") !== expected) throw new Error("CODEX_DOWNLOAD_DIGEST_MISMATCH");
  await writeFile(destination, Buffer.concat(chunks), { mode: 0o600, flag: "wx" });
}

async function stage() {
  await mkdir(releaseRoot, { recursive: true });
  if (await current()) {
    process.stdout.write(`[PASS] CODEX_RUNTIME_CURRENT: ${codexRuntimeVersion} ${target.target}\n`);
    return;
  }
  const lock = path.join(releaseRoot, ".codex-stage-lock");
  // An interrupted owner leaves a visible lock; never assume timeout means it died.
  await mkdir(lock);
  const scratch = await mkdtemp(path.join(releaseRoot, ".codex-stage-"));
  const next = path.join(scratch, "next");
  const previous = path.join(scratch, "previous");
  let retained = false;
  try {
    await mkdir(next);
    const archive = path.join(scratch, "runtime.tar.gz");
    await download(
      `https://github.com/openai/codex/releases/download/rust-v${codexRuntimeVersion}/codex-app-server-package-${target.target}.tar.gz`,
      target.sha256,
      archive,
    );
    const { stdout } = await execFileAsync("tar", ["-tzf", archive], { maxBuffer: 1024 * 1024 });
    const entries = stdout.trim().split(/\r?\n/u);
    if (
      entries.length > 100 ||
      entries.some(
        (name) =>
          !/^[A-Za-z0-9._/-]+$/u.test(name) ||
          name.startsWith("/") ||
          name.split("/").includes(".."),
      )
    )
      throw new Error("CODEX_ARCHIVE_UNSAFE");
    await execFileAsync("tar", ["-xzf", archive, "-C", next], { timeout: 120_000 });
    await inventory(next); // Reject links and special files in the pinned official archive.
    const metadata = JSON.parse(await readFile(path.join(next, "codex-package.json"), "utf8"));
    const suffix = process.platform === "win32" ? ".exe" : "";
    if (
      metadata.layoutVersion !== 1 ||
      metadata.version !== codexRuntimeVersion ||
      metadata.target !== target.target ||
      metadata.variant !== "codex-app-server" ||
      metadata.entrypoint !== `bin/codex-app-server${suffix}` ||
      metadata.resourcesDir !== "codex-resources" ||
      metadata.pathDir !== "codex-path"
    ) {
      throw new Error("CODEX_PACKAGE_LAYOUT_INVALID");
    }
    const required = [
      `bin/codex-app-server${suffix}`,
      `bin/codex-code-mode-host${suffix}`,
      `codex-path/rg${suffix}`,
    ];
    if (process.platform === "linux") required.push("codex-resources/bwrap");
    if (process.platform === "win32")
      required.push(
        "codex-resources/codex-command-runner.exe",
        "codex-resources/codex-windows-sandbox-setup.exe",
      );
    for (const name of required)
      if (!(await lstat(path.join(next, name))).isFile())
        throw new Error("CODEX_PACKAGE_RESOURCE_MISSING");
    await cp(path.join(repositoryRoot, "docs/codex-runtime-notices"), path.join(next, "notices"), {
      recursive: true,
    });
    // Includes the exact vendored bubblewrap source, modifications and build scripts.
    await download(
      `https://api.github.com/repos/openai/codex/tarball/rust-v${codexRuntimeVersion}`,
      sourceSha256,
      path.join(next, "notices/codex-source.tar.gz"),
    );
    await writeFile(
      path.join(next, "nina-runtime.json"),
      `${JSON.stringify(
        {
          version: codexRuntimeVersion,
          target: target.target,
          archiveSha256: target.sha256,
          sourceSha256,
          files: await inventory(next),
        },
        null,
        2,
      )}\n`,
    );
    try {
      await rename(output, previous);
      retained = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(next, output);
    } catch (error) {
      if (retained) await rename(previous, output);
      retained = false;
      throw error;
    }
    retained = false;
    process.stdout.write(`[PASS] CODEX_RUNTIME_STAGED: ${codexRuntimeVersion} ${target.target}\n`);
  } finally {
    if (!retained) await rm(scratch, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}

await stage();
