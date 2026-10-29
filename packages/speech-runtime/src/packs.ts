import { acquire, hashFile, onlyNames, removeFile } from "@call-nina/offline-runtime/files";
import { prepareDownload, download } from "@call-nina/offline-runtime/download";
import { constants } from "node:fs";
import { open, statfs, chmod, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { speechPacks, type SpeechArtifact, type SpeechPack } from "./catalog.js";
import { directory, exists, read, atomic } from "./files.js";

export class SpeechPacks {
  controller: AbortController | null = null;
  active: string | null = null;
  progress = 0;
  error: string | null = null;
  errorPackId: string | null = null;
  constructor(readonly root: string) {}
  get(id: string) {
    const pack = speechPacks.find((p) => p.id === id);
    if (!pack) throw new Error("OD_SPEECH_PACK_UNKNOWN");
    return pack;
  }
  location(pack: SpeechPack) {
    return path.join(this.root, pack.id);
  }
  runtimeLocation(pack: SpeechPack) {
    if (!pack.runtime) throw new Error("OD_SPEECH_PACK_UNAVAILABLE");
    return path.join(this.root, `${pack.engine}-${pack.runtime.sha256}`);
  }
  receipt(pack: SpeechPack) {
    return {
      engine: pack.engine,
      files: pack.artifacts.map((a) => a.file),
      artifacts: pack.artifacts.map((a) => a.sha256),
      runtime: pack.runtime?.sha256,
    };
  }
  async needsUpdate(pack: SpeechPack) {
    return (
      (await exists(path.join(this.location(pack), "receipt.json"))) &&
      !(await this.installed(pack))
    );
  }
  async installed(pack: SpeechPack) {
    if (!pack.qualified || !pack.runtime) return false;
    try {
      const file = path.join(this.location(pack), "receipt.json");
      if ((await read(file, 4096)).toString() !== JSON.stringify(this.receipt(pack))) return false;
      for (const artifact of pack.artifacts) {
        const info = await lstat(path.join(this.location(pack), artifact.file));
        if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.bytes) return false;
      }
      for (const artifact of pack.runtime.files) {
        const info = await lstat(path.join(this.runtimeLocation(pack), artifact.file));
        if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.bytes) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  async install(id: string) {
    if (this.controller) throw new Error("OD_SPEECH_DOWNLOAD_BUSY");
    const pack = this.get(id);
    if (!pack.qualified || !pack.runtime || process.platform !== "linux" || process.arch !== "x64")
      throw new Error("OD_SPEECH_PACK_UNAVAILABLE");
    if (await this.needsUpdate(pack)) await this.remove(id);
    const controller = new AbortController();
    this.controller = controller;
    this.active = id;
    this.progress = 0;
    this.error = null;
    this.errorPackId = null;
    void this.download(pack, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        this.error =
          error instanceof Error &&
          (error.message === "OD_SPEECH_DISK_FULL" ||
            (error as NodeJS.ErrnoException).code === "ENOSPC")
            ? "OD_SPEECH_DISK_FULL"
            : "OD_SPEECH_DOWNLOAD_FAILED";
        this.errorPackId = id;
      })
      .finally(() => {
        this.controller = null;
        this.active = null;
      });
  }
  async download(pack: SpeechPack, signal: AbortSignal) {
    const root = this.location(pack);
    await directory(root);
    const lock = await acquire(this.root);
    try {
      const runtime = pack.runtime;
      if (!runtime) throw new Error("OD_SPEECH_RUNTIME_UNAVAILABLE");
      const runtimeRoot = this.runtimeLocation(pack);
      await directory(runtimeRoot);
      const inventoryFile = path.join(runtimeRoot, "inventory.json");
      const runtimeReady =
        (await exists(inventoryFile)) &&
        (await read(inventoryFile, 8_000_000)).toString() === JSON.stringify(runtime.files);
      const specs = [
        ...pack.artifacts.map((a) => ({ root, a })),
        { root: runtimeRoot, a: { ...runtime, file: "runtime.tar.gz" } },
      ];
      const prepared = await Promise.all(
        specs.map(async (item) => ({
          ...item,
          prepared: await prepareDownload(item.root, item.a, signal),
        })),
      );
      const required =
        prepared.reduce((n, item) => n + item.a.bytes - item.prepared.bytes, 0) +
        (runtimeReady ? 0 : runtime.files.reduce((n, a) => n + a.bytes, 0)) +
        64_000_000;
      const disk = await statfs(root);
      if (disk.bavail * disk.bsize < required) throw new Error("OD_SPEECH_DISK_FULL");
      for (const item of prepared) {
        const prior = this.progress;
        await download(
          item.root,
          item.a,
          signal,
          (bytes) => {
            this.progress = prior + bytes;
          },
          item.prepared,
        );
      }
      if (!runtimeReady)
        await extractTar(
          path.join(runtimeRoot, "runtime.tar.gz"),
          path.join(runtimeRoot, "runtime"),
          runtime.files,
          signal,
        );
      await atomic(path.join(runtimeRoot, "inventory.json"), JSON.stringify(runtime.files));
      await atomic(path.join(root, "receipt.json"), JSON.stringify(this.receipt(pack)));
    } finally {
      await lock.release();
    }
  }
  async fetch(root: string, a: SpeechArtifact, signal: AbortSignal) {
    const prior = this.progress;
    const prepared = await prepareDownload(root, a, signal);
    await download(
      root,
      a,
      signal,
      (bytes) => {
        this.progress = prior + bytes;
      },
      prepared,
    );
  }
  async verify(pack: SpeechPack, signal: AbortSignal) {
    if (!(await this.installed(pack)) || !pack.runtime) throw new Error("OD_SPEECH_NOT_INSTALLED");
    for (const item of [
      ...pack.artifacts.map((a) => ({ a, root: this.location(pack) })),
      ...pack.runtime.files.map((a) => ({
        a,
        root: path.join(this.runtimeLocation(pack), "runtime"),
      })),
    ]) {
      const result = await hashFile(path.join(item.root, item.a.file), item.a.bytes, signal);
      if (result.bytes !== item.a.bytes || result.hash.digest("hex") !== item.a.sha256)
        throw new Error("OD_SPEECH_INTEGRITY");
    }
  }
  async remove(id: string) {
    if (this.controller) throw new Error("OD_SPEECH_DOWNLOAD_BUSY");
    const pack = this.get(id);
    const root = this.location(pack);
    if (!(await exists(root))) return;
    const lock = await acquire(this.root);
    try {
      let owned = pack.artifacts.map((a) => a.file);
      let runtimeHash = pack.runtime?.sha256;
      const receiptFile = path.join(root, "receipt.json");
      if (await exists(receiptFile)) {
        const receipt = JSON.parse((await read(receiptFile, 16384)).toString()) as {
          engine?: unknown;
          files?: unknown;
          runtime?: unknown;
        };
        if (
          receipt.engine !== pack.engine ||
          !Array.isArray(receipt.files) ||
          !receipt.files.every(
            (f) => typeof f === "string" && /^[a-zA-Z0-9_.-]+$/u.test(f) && f !== "." && f !== "..",
          ) ||
          typeof receipt.runtime !== "string" ||
          !/^[a-f0-9]{64}$/u.test(receipt.runtime)
        )
          throw new Error("OD_SPEECH_INTEGRITY");
        owned = [...new Set([...owned, ...(receipt.files as string[])])];
        runtimeHash = receipt.runtime;
      }
      const names = [
        "receipt.json",
        "local-config.yaml",
        ...owned.flatMap((file) => [file, `${file}.part`, `${file}.resume`, `${file}.resume.new`]),
      ];
      await onlyNames(root, names);
      for (const name of names) await removeFile(path.join(root, name));
      const { rmdir } = await import("node:fs/promises");
      await rmdir(root);
      // Runtime versions are shared only within an engine. Retain one while any
      // other language pack references it; never traverse another engine's tree.
      if (runtimeHash) {
        let referenced = false;
        for (const other of speechPacks.filter((p) => p.id !== id && p.engine === pack.engine)) {
          const otherRoot = this.location(other);
          if (!(await exists(otherRoot))) continue;
          if (other.runtime?.sha256 === runtimeHash) {
            referenced = true;
            break;
          }
          const otherReceipt = path.join(otherRoot, "receipt.json");
          if (await exists(otherReceipt)) {
            const value = JSON.parse((await read(otherReceipt, 16384)).toString()) as {
              runtime?: string;
            };
            if (value.runtime === runtimeHash) {
              referenced = true;
              break;
            }
          }
        }
        if (!referenced) await this.removeRuntime(pack.engine, runtimeHash);
      }
    } finally {
      await lock.release();
    }
  }
  async removeRuntime(engine: SpeechPack["engine"], runtimeHash: string) {
    const root = path.join(this.root, `${engine}-${runtimeHash}`);
    if (!(await exists(root))) return;
    const inventoryFile = path.join(root, "inventory.json");
    const current = speechPacks.find(
      (p) => p.engine === engine && p.runtime?.sha256 === runtimeHash,
    )?.runtime?.files;
    const files: SpeechArtifact[] = (await exists(inventoryFile))
      ? (JSON.parse((await read(inventoryFile, 8_000_000)).toString()) as SpeechArtifact[])
      : (current ?? []);
    if (
      !files.length ||
      files.some(
        (f) =>
          typeof f.file !== "string" ||
          path.isAbsolute(f.file) ||
          f.file.split("/").some((p) => !p || p === "." || p === ".."),
      )
    )
      throw new Error("OD_SPEECH_INTEGRITY");
    const allowed = new Set([
      "runtime.tar.gz",
      "runtime.tar.gz.part",
      "runtime.tar.gz.resume",
      "runtime.tar.gz.resume.new",
      "inventory.json",
      ...files.map((f) => `runtime/${f.file}`),
    ]);
    const { readdir, lstat, rmdir, unlink } = await import("node:fs/promises");
    const ownedFiles: string[] = [];
    const dirs: string[] = [];
    const walk = async (dir: string) => {
      for (const name of await readdir(dir)) {
        const file = path.join(dir, name);
        const stat = await lstat(file);
        if (stat.isSymbolicLink()) throw new Error("OD_SPEECH_UNSAFE_FILE");
        if (stat.isDirectory()) {
          await walk(file);
          dirs.push(file);
        } else if (stat.isFile() && allowed.has(path.relative(root, file))) ownedFiles.push(file);
        else throw new Error("OD_SPEECH_UNSAFE_FILE");
      }
    };
    await walk(root);
    for (const file of ownedFiles) await unlink(file);
    for (const dir of dirs) await rmdir(dir);
    await rmdir(root);
  }
}
async function extractTar(
  archive: string,
  root: string,
  files: SpeechArtifact[],
  signal: AbortSignal,
) {
  await directory(root);
  const input = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  const { createGunzip } = await import("node:zlib");
  const source = input.createReadStream();
  const unzip = source.pipe(createGunzip());
  source.on("error", (error) => unzip.destroy(error));
  const iterator = unzip[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  const take = async (size: number): Promise<Buffer> => {
    const result = Buffer.alloc(size);
    let written = 0;
    while (written < size) {
      signal.throwIfAborted();
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) throw new Error("OD_SPEECH_ARCHIVE");
        pending = Buffer.from(next.value as Uint8Array);
      }
      const count = Math.min(size - written, pending.length);
      pending.copy(result, written, 0, count);
      pending = pending.subarray(count);
      written += count;
    }
    return result;
  };
  const seen = new Set<string>();
  try {
    for (;;) {
      const header = await take(512);
      if (header.every((b) => b === 0)) break;
      const leaf = header.subarray(0, 100).toString().split("\0")[0] ?? "";
      const prefix = header.subarray(345, 500).toString().split("\0")[0] ?? "";
      const name = prefix ? `${prefix}/${leaf}` : leaf;
      const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, "").trim(), 8);
      const spec = files.find((f) => f.file === name);
      if (
        !spec ||
        seen.has(name) ||
        ![0, 48].includes(header.readUInt8(156)) ||
        name.startsWith("/") ||
        name.split("/").some((p) => !p || p === "..") ||
        size !== spec.bytes
      )
        throw new Error("OD_SPEECH_ARCHIVE");
      const data = await take(size);
      if (createHash("sha256").update(data).digest("hex") !== spec.sha256)
        throw new Error("OD_SPEECH_INTEGRITY");
      await atomic(path.join(root, name), data);
      if (name.startsWith("bin/")) await chmod(path.join(root, name), 0o700);
      seen.add(name);
      const padding = (512 - (size % 512)) % 512;
      if (padding) await take(padding);
    }
    if (seen.size !== files.length) throw new Error("OD_SPEECH_ARCHIVE");
  } finally {
    unzip.destroy();
    source.destroy();
    await input.close().catch(() => undefined);
  }
}
