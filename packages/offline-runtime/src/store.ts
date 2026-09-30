import { type OfflinePreflight } from "@call-nina/contracts";
import { lstat, readdir, rmdir, statfs, unlink } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  artifacts,
  downloadBytes,
  installedBytes,
  offlineCandidate,
  runtimeFiles,
} from "./candidate.js";
import {
  acquire,
  atomic,
  directory,
  exists,
  fail,
  hashFile,
  onlyNames,
  readSmall,
  regular,
  removeFile,
  writeNew,
} from "./files.js";
import { download, prepareDownload } from "./download.js";

const artifactNames = Object.values(artifacts).flatMap(({ file }) => [
  file,
  `${file}.part`,
  `${file}.resume`,
  `${file}.resume.new`,
]);
const rootNames = [
  ...artifactNames,
  "installed.json",
  "installed.json.new",
  "runtime",
  "owner.json",
  "owner.json.new",
  "session",
];
const receipt = JSON.stringify({
  candidate: offlineCandidate.id,
  model: artifacts.model.sha256,
  runtime: artifacts.runtime.sha256,
});
export class ArtifactStore {
  readonly root: string;
  constructor(deviceArtifactRoot: string) {
    this.root = path.join(deviceArtifactRoot, offlineCandidate.id);
  }
  async preflight(): Promise<OfflinePreflight> {
    // Read-only UI estimates do not hash artifacts or mutate recovery state.
    // Installation computes exact remaining space under exclusive ownership.
    return this.installationPreflight(0);
  }
  private async installationPreflight(verifiedOwnedBytes: number): Promise<OfflinePreflight> {
    // Linux x64 is the only inspected payload; libc/library compatibility is still provisional.
    const platformSupported = process.platform === "linux" && process.arch === "x64";
    let availableDiskBytes: number | null = null;
    let probe = this.root;
    while (!(await exists(probe)) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    if (await exists(probe)) {
      await directory(probe, false, false);
      const fs = await statfs(probe);
      availableDiskBytes = fs.bavail * fs.bsize;
    }
    const requiredDiskBytes =
      installedBytes - verifiedOwnedBytes + offlineCandidate.diskReserveBytes;
    const totalMemoryBytes = totalmem();
    const freeMemoryBytes = freemem();
    return {
      platformSupported,
      totalMemoryBytes,
      freeMemoryBytes,
      availableDiskBytes,
      requiredDiskBytes,
      memorySufficient:
        totalMemoryBytes >= offlineCandidate.minimumMemoryBytes &&
        freeMemoryBytes >= offlineCandidate.minimumFreeMemoryBytes,
      diskSufficient: availableDiskBytes !== null && availableDiskBytes >= requiredDiskBytes,
      hardwareVerified: false,
    };
  }
  async state(): Promise<"absent" | "partial" | "installed"> {
    if (!(await exists(this.root))) return "absent";
    await onlyNames(this.root, rootNames);
    if (await exists(path.join(this.root, "installed.json"))) {
      if ((await readSmall(path.join(this.root, "installed.json"))).toString() !== receipt)
        fail("INSTALL_INVALID");
      for (const spec of [artifacts.model, artifacts.runtime]) {
        const handle = await regular(path.join(this.root, spec.file));
        try {
          if ((await handle.stat()).size !== spec.bytes) fail("INSTALL_INVALID");
        } finally {
          await handle.close();
        }
      }
      await onlyNames(
        path.join(this.root, "runtime"),
        runtimeFiles.map(({ file }) => file),
      );
      for (const spec of runtimeFiles) {
        const handle = await regular(path.join(this.root, "runtime", spec.file));
        try {
          if ((await handle.stat()).size !== spec.bytes) fail("INSTALL_INVALID");
        } finally {
          await handle.close();
        }
      }
      return "installed";
    }
    return (await readdir(this.root)).some((name) => artifactNames.includes(name))
      ? "partial"
      : "absent";
  }
  async install(
    signal: AbortSignal,
    progress: (bytes: number, phase: "downloading" | "verifying") => void,
  ) {
    const flight = await this.preflight();
    if (!flight.platformSupported) fail("PLATFORM_UNSUPPORTED");
    if (!flight.memorySufficient) fail("MEMORY_INSUFFICIENT");
    const lock = await acquire(this.root);
    try {
      await onlyNames(this.root, rootNames);
      const runtime = await prepareDownload(this.root, artifacts.runtime, signal);
      const model = await prepareDownload(this.root, artifacts.model, signal);
      let verifiedOwnedBytes = runtime.bytes + model.bytes;
      const target = path.join(this.root, "runtime");
      if (await exists(target)) {
        await onlyNames(
          target,
          runtimeFiles.map(({ file }) => file),
        );
        for (const spec of runtimeFiles) {
          const file = path.join(target, spec.file);
          if (!(await exists(file))) continue;
          const actual = await hashFile(file, spec.bytes, signal);
          if (actual.bytes !== spec.bytes || actual.hash.digest("hex") !== spec.sha256)
            fail("INTEGRITY_INVALID");
          verifiedOwnedBytes += actual.bytes;
        }
      }
      const remaining = await this.installationPreflight(verifiedOwnedBytes);
      if (!remaining.diskSufficient) fail("DISK_INSUFFICIENT");
      await download(
        this.root,
        artifacts.runtime,
        signal,
        (bytes) => {
          progress(bytes, "downloading");
        },
        runtime,
      );
      await download(
        this.root,
        artifacts.model,
        signal,
        (bytes) => {
          progress(artifacts.runtime.bytes + bytes, "downloading");
        },
        model,
      );
      progress(downloadBytes, "verifying");
      await this.extract(signal);
      if (signal.aborted) fail("CANCELLED");
      await atomic(path.join(this.root, "installed.json"), JSON.parse(receipt) as unknown);
    } finally {
      await lock.release();
    }
  }
  private async extract(signal: AbortSignal) {
    const compressed = await readSmall(
      path.join(this.root, artifacts.runtime.file),
      artifacts.runtime.bytes,
    );
    if (createHash("sha256").update(compressed).digest("hex") !== artifacts.runtime.sha256)
      fail("INTEGRITY_INVALID");
    const tar = gunzipSync(compressed, { maxOutputLength: 80 * 1024 ** 2 });
    const found = new Map<string, Buffer>();
    for (let offset = 0; offset + 512 <= tar.length;) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every((value) => value === 0)) break;
      const name = header.subarray(0, 100).toString().replace(/\0.*$/su, "");
      const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/su, "").trim();
      if (!/^[0-7]+$/u.test(sizeText)) fail("ARCHIVE_INVALID");
      const size = parseInt(sizeText, 8);
      const data = tar.subarray(offset + 512, offset + 512 + size);
      if (data.length !== size) fail("ARCHIVE_INVALID");
      const spec = runtimeFiles.find((entry) => name === `llama-b11273/${entry.source}`);
      if (spec) {
        if (
          found.has(spec.file) ||
          ![0, 48].includes(header[156] ?? -1) ||
          size !== spec.bytes ||
          createHash("sha256").update(data).digest("hex") !== spec.sha256
        )
          fail("ARCHIVE_INVALID");
        found.set(spec.file, data);
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (found.size !== runtimeFiles.length) fail("ARCHIVE_INVALID");
    const target = path.join(this.root, "runtime");
    await directory(target);
    await onlyNames(
      target,
      runtimeFiles.map(({ file }) => file),
    );
    for (const spec of runtimeFiles) {
      if (signal.aborted) fail("CANCELLED");
      const file = path.join(target, spec.file);
      if (await exists(file)) {
        const actual = await hashFile(file, spec.bytes, signal);
        if (actual.bytes !== spec.bytes || actual.hash.digest("hex") !== spec.sha256)
          fail("INTEGRITY_INVALID");
      } else {
        const data = found.get(spec.file);
        if (!data) fail("ARCHIVE_INVALID");
        await writeNew(file, data, spec.file !== "LICENSE");
      }
    }
  }
  async verified(signal: AbortSignal) {
    if ((await this.state()) !== "installed") fail("NOT_INSTALLED");
    for (const spec of [
      artifacts.model,
      ...runtimeFiles.map((file) => ({ ...file, file: `runtime/${file.file}` })),
    ]) {
      const actual = await hashFile(path.join(this.root, spec.file), spec.bytes, signal);
      if (actual.bytes !== spec.bytes || actual.hash.digest("hex") !== spec.sha256)
        fail("INTEGRITY_INVALID");
    }
    return {
      executable: path.join(this.root, "runtime", "llama-server"),
      model: path.join(this.root, artifacts.model.file),
    };
  }
  async remove() {
    if (process.platform !== "linux" || process.arch !== "x64") fail("PLATFORM_UNSUPPORTED");
    if (!(await exists(this.root))) return;
    const lock = await acquire(this.root);
    try {
      await onlyNames(this.root, rootNames);
      // Preflight every member before deleting any; unrelated entries/symlinks are never removed.
      const files: string[] = [];
      for (const name of await readdir(this.root)) {
        if (name === "owner.json") continue;
        if (name === "runtime" || name === "session") {
          const dir = path.join(this.root, name);
          await onlyNames(
            dir,
            name === "runtime" ? runtimeFiles.map(({ file }) => file) : ["api-key", "server.sock"],
          );
          for (const child of await readdir(dir)) {
            const file = path.join(dir, child);
            if (child === "server.sock") {
              if (!(await lstat(file)).isSocket() || (await lstat(file)).uid !== process.getuid?.())
                fail("FILE_UNSAFE");
            } else {
              const checked = await regular(file);
              await checked.close();
            }
            files.push(file);
          }
        } else {
          const file = path.join(this.root, name);
          const checked = await regular(file);
          await checked.close();
          files.push(file);
        }
      }
      // The acquired lock proves any recorded old child is dead; never signal it.
      for (const file of files) {
        if (file.endsWith("server.sock")) await unlink(file);
        else await removeFile(file);
      }
      for (const name of ["runtime", "session"])
        if (await exists(path.join(this.root, name))) await rmdir(path.join(this.root, name));
    } finally {
      await lock.release();
    }
    await rmdir(this.root);
  }
}
