#!/usr/bin/env node
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  readBootstrapPointer,
  resolveDataRootLayout,
  consolidatePreparedSpeech,
} from "../../packages/persistence/dist/index.js";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { speechPacks, loadSpeechCandidates } from "../../packages/speech-runtime/dist/index.js";
import { atomic, directory, diskUsage } from "../../packages/speech-runtime/dist/files.js";
import { prepareDownload, download } from "../../packages/offline-runtime/dist/download.js";

const root = path.resolve(import.meta.dirname, "../..");
const legacyDestination = path.join(root, "build/speech-candidates");
let destination;
let migrationPending = false;
const [operation, selection = "all", ...extra] = process.argv.slice(2);
const engines = selection === "all" ? ["piper", "pocket"] : [selection];
const sha = (data) => createHash("sha256").update(data).digest("hex");
async function sourceDigest(engine) {
  return sha(
    Buffer.concat(
      await Promise.all(
        ["build-runtime.py", "validate-runtime.py", "worker.py", `${engine}.lock`].map((name) =>
          readFile(path.join(root, "scripts/speech", name)),
        ),
      ),
    ),
  );
}
async function run(engine, output, signal) {
  await new Promise((resolve, reject) => {
    const child = spawn("python3", ["scripts/speech/build-runtime.py", engine, output], {
      cwd: root,
      stdio: "inherit",
    });
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      code === 0 ? resolve() : reject(new Error("OD_SPEECH_RUNTIME_BUILD_FAILED"));
    });
    if (signal.aborted) abort();
  });
}
async function inspect() {
  const manifestFile = path.join(destination, "manifest.json");
  try {
    await lstat(manifestFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.log(JSON.stringify({ status: "not-prepared", command: "make speech prepare all" }));
    return;
  }
  const candidates = await loadSpeechCandidates(destination, true);
  const manifest = await readFile(manifestFile);
  const metadata = JSON.parse(manifest);
  const currentSources = (
    await Promise.all(
      metadata.runtimes.map(
        async (runtime) => runtime.sourceDigest === (await sourceDigest(runtime.engine)),
      ),
    )
  ).every(Boolean);
  const runtimes = [...new Map(candidates.packs.map((p) => [p.engine, p.runtime])).entries()];
  console.log(
    JSON.stringify(
      {
        status: currentSources ? "prepared" : "stale-runtime-sources",
        directory: destination,
        migrationPending,
        manifestSha256: sha(manifest),
        stagedDiskBytes: await diskUsage(destination),
        installEstimateBytes:
          runtimes.reduce(
            (sum, [, runtime]) =>
              sum + runtime.bytes + runtime.files.reduce((n, f) => n + f.bytes, 0),
            0,
          ) +
          candidates.packs.reduce(
            (sum, pack) => sum + pack.artifacts.reduce((n, a) => n + a.bytes, 0),
            0,
          ),
        runtimes: runtimes.map(([engine, runtime]) => ({
          engine,
          sha256: runtime.sha256,
          archiveBytes: runtime.bytes,
          extractedBytes: runtime.files.reduce((sum, f) => sum + f.bytes, 0),
        })),
        packs: candidates.packs.map((pack) => ({
          id: pack.id,
          voice: pack.voice,
          modelBytes: pack.artifacts.reduce((sum, a) => sum + a.bytes, 0),
          qualification: "candidate",
          review: speechPacks.find((p) => p.id === pack.id).licenseReview ?? "pending",
          manualTest: "awaiting your manual test",
        })),
      },
      null,
      2,
    ),
  );
}
try {
  if (
    extra.length ||
    !["prepare", "status"].includes(operation) ||
    engines.some((e) => !["piper", "pocket"].includes(e)) ||
    (operation === "status" && process.argv.length !== 3)
  )
    throw new Error("Usage: make speech prepare all|piper|pocket; make speech status");
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("OD_SPEECH_PLATFORM_UNSUPPORTED");
  const bootstrapFile = path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "Electron",
    "bootstrap.json",
  );
  const pointer = await readBootstrapPointer(bootstrapFile);
  if (pointer.status !== "ready") throw new Error("OD_SPEECH_DATA_ROOT_REQUIRED");
  destination = resolveDataRootLayout(pointer.dataRoot).preparedSpeech;
  if (operation === "prepare") await consolidatePreparedSpeech(pointer.dataRoot, legacyDestination);
  else if (
    !(await lstat(path.join(destination, "manifest.json")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    })) &&
    (await lstat(path.join(legacyDestination, "manifest.json")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    }))
  ) {
    destination = legacyDestination;
    migrationPending = true;
  }
  if (operation === "status") await inspect();
  else {
    await directory(destination);
    // A development checkout can have group-writable ancestors. Keep this
    // preparation mutex separate from installed-model ownership permissions.
    const mutex = createServer((socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      mutex.once("error", () => reject(new Error("OD_SPEECH_PREPARATION_BUSY")));
      mutex.listen(`\0nina-speech-prepare-${sha(destination)}`, resolve);
    });
    try {
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.once("SIGINT", abort);
      process.once("SIGTERM", abort);
      let previous = { runtimes: [], packs: [] };
      try {
        previous = JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const runtimes = previous.runtimes.filter((r) => !engines.includes(r.engine));
      const packs = previous.packs.filter(
        (p) => !engines.includes(speechPacks.find((s) => s.id === p.id)?.engine),
      );
      for (const engine of engines) {
        controller.signal.throwIfAborted();
        const source = await sourceDigest(engine);
        const runtimeRoot = path.join(destination, "runtimes", engine, source);
        console.log(`Preparing ${engine} CPU runtime (no synthesis).`);
        await run(engine, runtimeRoot, controller.signal);
        const runtime = JSON.parse(await readFile(path.join(runtimeRoot, "runtime.json"), "utf8"));
        if (runtime.sourceDigest !== source)
          throw new Error("OD_SPEECH_RUNTIME_CANDIDATE_CONFLICT");
        runtimes.push({
          engine,
          sourceDigest: source,
          archive: {
            file: path.relative(destination, path.join(runtimeRoot, "runtime.tar.gz")),
            bytes: runtime.bytes,
            sha256: runtime.sha256,
          },
          files: runtime.files,
        });
        for (const pack of speechPacks.filter((p) => p.engine === engine)) {
          const voiceRoot = path.join(destination, "voices", pack.id);
          await directory(voiceRoot);
          const artifacts = [];
          for (const artifact of pack.artifacts) {
            controller.signal.throwIfAborted();
            console.log(`Staging ${pack.id} ${artifact.file} (${artifact.bytes} bytes).`);
            const prepared = await prepareDownload(voiceRoot, artifact, controller.signal);
            await download(voiceRoot, artifact, controller.signal, () => undefined, prepared);
            artifacts.push({
              file: artifact.file,
              source: path.relative(destination, path.join(voiceRoot, artifact.file)),
              bytes: artifact.bytes,
              sha256: artifact.sha256,
            });
          }
          packs.push({ id: pack.id, artifacts });
        }
      }
      await atomic(
        path.join(destination, "manifest.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            platform: "linux-x64",
            runtimes,
            packs,
          },
          null,
          2,
        ) + "\n",
      );
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
      await inspect();
    } finally {
      await new Promise((resolve) => mutex.close(resolve));
    }
  }
} catch (error) {
  console.error(
    /^OD_(?:SPEECH|OFFLINE)_[A-Z_]+$/.test(error.message)
      ? error.message
      : "OD_SPEECH_CANDIDATE_PREPARATION_FAILED",
  );
  process.exitCode = 1;
}
