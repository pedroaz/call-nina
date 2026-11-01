import { cp, mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  context,
  root,
  output,
  readJson,
  digest,
  node,
  run,
  cleanSource,
  releaseVersion,
} from "./common.mjs";

import { hostingEnvironment } from "../lib/hosting-environment.mjs";
import { desktopTargets } from "./targets.mjs";
import {
  prepareSpeechDistribution,
  speechDistributionRoot,
  speechTargets,
} from "../speech/distribution.mjs";
export { desktopTargets } from "./targets.mjs";
export async function record(kind, id, filename, extra = {}) {
  const version = (await readJson("package.json")).version;
  const sha256 = await digest(path.join(output, filename));
  const manifest = {
    schemaVersion: 1,
    kind,
    id,
    ...context(),
    version,
    filename,
    sha256,
    ...extra,
  };
  await writeFile(path.join(output, `${id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(output, `${id}.sha256`), `${sha256}  ${filename}\n`);
}
export async function desktop() {
  context();
  if (hostingEnvironment() !== "prd")
    throw new Error("Distributed desktop builds require production configuration");
  const id = `${process.platform}-${process.arch}`;
  if (!desktopTargets.includes(id) || process.env.RELEASE_PLATFORM !== id)
    throw new Error("Desktop runner architecture mismatch");
  await mkdir(output, { recursive: true });
  if (id === "linux-x64") {
    const { version } = await readJson("package.json");
    for (const { engine, runtime } of await prepareSpeechDistribution(version)) {
      const filename = path.basename(new URL(runtime.url).pathname);
      await cp(path.join(speechDistributionRoot, filename), path.join(output, filename));
      await record("speech", `speech-${engine}-linux-x64`, filename, { engine, runtime });
    }
  }
  node("scripts/commands.mjs", "package", process.platform === "linux" ? "appimage" : "local");
  cleanSource();
  const { version } = await readJson("package.json");
  const base = `Call-Nina-${version}-${id}`;
  let filename;
  if (process.platform === "linux") {
    const images = (await readdir(path.join(root, "release/appimage"))).filter((name) =>
      name.endsWith(".AppImage"),
    );
    if (images.length !== 1) throw new Error("Expected exactly one AppImage");
    filename = `${base}.AppImage`;
    await cp(path.join(root, "release/appimage", images[0]), path.join(output, filename));
  } else if (process.platform === "darwin") {
    filename = `${base}.dmg`;
    await cp(path.join(root, "release/local", filename), path.join(output, filename));
  } else {
    filename = `${base}.zip`;
    // Native PowerShell preserves paths as data, without interpolating them into script source.
    run(
      "pwsh",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Compress-Archive -Path (Join-Path $env:NINA_ARCHIVE_SOURCE '*') -DestinationPath $env:NINA_ARCHIVE_DESTINATION",
      ],
      {
        env: {
          ...process.env,
          NINA_ARCHIVE_SOURCE: path.join(root, "release/local/win-unpacked"),
          NINA_ARCHIVE_DESTINATION: path.join(output, filename),
        },
      },
    );
  }
  await record("desktop", id, filename, { platform: process.platform, arch: process.arch });
}
export async function hosting() {
  context();
  await mkdir(output, { recursive: true });
  node("scripts/build/package-hosting.mjs");
  cleanSource();
  const filename = `Call-Nina-hosting-${context().commit}.tar.gz`;
  run("tar", ["-czf", path.join(output, filename), "-C", "build/hosting", "."]);
  const environment = hostingEnvironment();
  const { projectId, teamId, origin } = (await readJson("scripts/admin/infrastructure.json"))[
    environment
  ];
  await record("hosting", "hosting", filename, { projectId, teamId, environment, origin });
}
export async function verify(id) {
  const manifest = await readJson(path.join(output, `${id}.json`));
  const current = context();
  const version = await releaseVersion();
  if (
    manifest.schemaVersion !== 1 ||
    manifest.id !== id ||
    manifest.commit !== current.commit ||
    manifest.runId !== current.runId ||
    manifest.repository !== current.repository ||
    manifest.version !== version ||
    typeof manifest.filename !== "string" ||
    path.basename(manifest.filename) !== manifest.filename ||
    !/^[a-zA-Z0-9.-]+$/.test(manifest.filename)
  )
    throw new Error(`Artifact identity mismatch: ${id}`);
  const expectedKind =
    id === "hosting" ? "hosting" : speechTargets.includes(id) ? "speech" : "desktop";
  if (
    manifest.kind !== expectedKind ||
    (expectedKind === "hosting" && manifest.environment !== hostingEnvironment()) ||
    (expectedKind === "desktop" &&
      (!desktopTargets.includes(id) || `${manifest.platform}-${manifest.arch}` !== id))
  )
    throw new Error("Artifact target mismatch");
  if (expectedKind === "desktop") {
    const extensions =
      manifest.platform === "linux"
        ? ["AppImage"]
        : manifest.platform === "win32"
          ? ["zip"]
          : ["dmg", "tar.gz"];
    if (
      !extensions.some(
        (extension) => manifest.filename === `Call-Nina-${version}-${id}.${extension}`,
      )
    )
      throw new Error("Desktop artifact filename mismatch");
  }
  if (expectedKind === "speech") {
    // Publication intentionally runs without workspace dependencies or rebuilding.
    const runtime = manifest.runtime;
    if (
      !runtime ||
      !["piper", "pocket"].includes(manifest.engine) ||
      !Number.isSafeInteger(runtime.bytes) ||
      runtime.bytes <= 0 ||
      !Array.isArray(runtime.files) ||
      !runtime.files.length ||
      id !== `speech-${manifest.engine}-linux-x64` ||
      runtime.sha256 !== manifest.sha256 ||
      runtime.url !==
        `https://github.com/${current.repository}/releases/download/desktop-v${version}/${manifest.filename}` ||
      manifest.filename !==
        `Call-Nina-speech-${manifest.engine}-linux-x64-${manifest.sha256}.tar.gz`
    )
      throw new Error("Speech artifact identity mismatch");
    if ((await stat(path.join(output, manifest.filename))).size !== runtime.bytes)
      throw new Error("Speech artifact size mismatch");
  }
  if ((await digest(path.join(output, manifest.filename))) !== manifest.sha256)
    throw new Error(`Artifact checksum mismatch: ${id}`);
  if (
    (await readFile(path.join(output, `${id}.sha256`), "utf8")) !==
    `${manifest.sha256}  ${manifest.filename}\n`
  )
    throw new Error("Checksum sidecar mismatch");
  return manifest;
}
