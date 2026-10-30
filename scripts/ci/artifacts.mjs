import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
  if (hostingEnvironment() !== "production")
    throw new Error("Distributed desktop builds require production configuration");
  const id = `${process.platform}-${process.arch}`;
  if (!desktopTargets.includes(id) || process.env.RELEASE_PLATFORM !== id)
    throw new Error("Desktop runner architecture mismatch");
  await mkdir(output, { recursive: true });
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
    filename = `${base}.tar.gz`;
    run("tar", [
      "-czf",
      path.join(output, filename),
      "-C",
      `release/local/${process.arch === "arm64" ? "mac-arm64" : "mac"}`,
      "Call Nina.app",
    ]);
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
  const expectedKind = id === "hosting" ? "hosting" : "desktop";
  if (
    manifest.kind !== expectedKind ||
    (expectedKind === "hosting" && manifest.environment !== hostingEnvironment()) ||
    (expectedKind === "desktop" &&
      (!desktopTargets.includes(id) || `${manifest.platform}-${manifest.arch}` !== id))
  )
    throw new Error("Artifact target mismatch");
  if ((await digest(path.join(output, manifest.filename))) !== manifest.sha256)
    throw new Error(`Artifact checksum mismatch: ${id}`);
  if (
    (await readFile(path.join(output, `${id}.sha256`), "utf8")) !==
    `${manifest.sha256}  ${manifest.filename}\n`
  )
    throw new Error("Checksum sidecar mismatch");
  return manifest;
}
