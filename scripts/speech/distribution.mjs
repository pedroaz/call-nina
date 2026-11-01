import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
export const speechDistributionRoot = path.join(root, "build/speech-distribution");
export const speechTargets = ["speech-piper-linux-x64", "speech-pocket-linux-x64"];

// Build inputs only: no learner folder, voice downloads, synthesis or publication.
export async function prepareSpeechDistribution(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || process.platform !== "linux" || process.arch !== "x64")
    throw new Error("OD_SPEECH_PLATFORM_UNSUPPORTED");
  await mkdir(speechDistributionRoot, { recursive: true, mode: 0o700 });
  const catalog = [];
  const runtimes = [];
  for (const engine of ["piper", "pocket"]) {
    const sources = await Promise.all(
      ["build-runtime.py", "validate-runtime.py", "worker.py", `${engine}.lock`].map((name) =>
        readFile(path.join(root, "scripts/speech", name)),
      ),
    );
    const sourceDigest = createHash("sha256").update(Buffer.concat(sources)).digest("hex");
    const directory = path.join(speechDistributionRoot, "runtimes", engine, sourceDigest);
    const result = spawnSync("python3", ["scripts/speech/build-runtime.py", engine, directory], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) throw new Error("OD_SPEECH_RUNTIME_BUILD_FAILED");
    const metadata = JSON.parse(await readFile(path.join(directory, "runtime.json"), "utf8"));
    if (metadata.sourceDigest !== sourceDigest) throw new Error("OD_SPEECH_INTEGRITY");
    const filename = `Call-Nina-speech-${engine}-linux-x64-${metadata.sha256}.tar.gz`;
    await cp(path.join(directory, "runtime.tar.gz"), path.join(speechDistributionRoot, filename));
    catalog.push({
      engine,
      runtime: {
        url: `https://github.com/pedroaz/call-nina/releases/download/desktop-v${version}/${filename}`,
        bytes: metadata.bytes,
        sha256: metadata.sha256,
        files: metadata.files,
      },
    });
    runtimes.push({
      engine,
      sourceDigest,
      archive: { file: filename, bytes: metadata.bytes, sha256: metadata.sha256 },
      files: metadata.files,
    });
  }
  // Local development may install these exact archives through the existing
  // --speech-bundles-dir option. Voice files still download from upstream.
  const packs = JSON.parse(
    await readFile(path.join(root, "packages/speech-runtime/src/catalog.json"), "utf8"),
  );
  await writeFile(
    path.join(speechDistributionRoot, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      platform: "linux-x64",
      runtimes,
      packs: packs.map((pack) => ({
        id: pack.id,
        artifacts: pack.artifacts.map(({ file, bytes, sha256 }) => ({
          file,
          bytes,
          sha256,
          source: `voices/${pack.id}/${file}`,
        })),
      })),
    }),
  );
  await writeFile(path.join(speechDistributionRoot, "catalog.json"), JSON.stringify(catalog));
  return catalog;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: make speech runtimes");
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  await prepareSpeechDistribution(version);
}
