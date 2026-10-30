import {
  acquire,
  hashFile,
  regular,
  onlyNames,
  removeFile,
  atomic as atomicRecord,
} from "@call-nina/offline-runtime/files";
import { prepareDownload, download } from "@call-nina/offline-runtime/download";
import { z } from "@call-nina/contracts";
import { constants } from "node:fs";
import { open, statfs, rename, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { speechPacks, type SpeechArtifact, type SpeechPack } from "./catalog.js";
import { directory, exists, read } from "./files.js";
import { copyLocalArtifact } from "./local-artifact.js";

export class SpeechPacks {
  controller: AbortController | null = null;
  private task: Promise<void> | null = null;
  active: string | null = null;
  progress = 0;
  error: string | null = null;
  errorPackId: string | null = null;
  #closed = false;
  #runtimeChecks = new Map<string, { until: number; result: Promise<boolean> }>();
  constructor(
    readonly root: string,
    readonly catalog: readonly SpeechPack[] = speechPacks,
    readonly localFiles: ReadonlyMap<string, string> = new Map(),
    readonly onChange: () => void = () => undefined,
  ) {}
  usable(pack: SpeechPack) {
    return Boolean(
      pack.qualified && pack.runtime && process.platform === "linux" && process.arch === "x64",
    );
  }
  async canInstall(pack: SpeechPack) {
    if (!this.usable(pack) || !pack.runtime) return false;
    return Boolean(
      pack.runtime.url ||
      this.localFiles.has(pack.runtime.sha256) ||
      (await exists(path.join(this.runtimeLocation(pack), "runtime.tar.gz"))) ||
      (await this.runtimeInstalled(pack)),
    );
  }
  get(id: string) {
    const pack = this.catalog.find((p) => p.id === id);
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
  async rememberInstalled() {
    for (const pack of this.catalog)
      if (
        pack.runtime &&
        !(await exists(path.join(this.root, "catalog", `${pack.id}.json`))) &&
        (await this.installed(pack))
      )
        await this.remember(pack);
  }
  private async remember(pack: SpeechPack) {
    const catalogRoot = path.join(this.root, "catalog");
    await directory(catalogRoot);
    // Retain artifact identity after removal so exact cached recordings remain usable.
    await atomicRecord(path.join(catalogRoot, `${pack.id}.json`), {
      id: pack.id,
      runtime: pack.runtime,
    });
  }
  async needsUpdate(pack: SpeechPack) {
    return (
      (await exists(path.join(this.location(pack), "receipt.json"))) &&
      !(await this.installed(pack))
    );
  }
  async installed(pack: SpeechPack) {
    if (!this.usable(pack) || !pack.runtime) return false;
    try {
      if (await exists(path.join(this.location(pack), "removal.json"))) return false;
      const file = path.join(this.location(pack), "receipt.json");
      if ((await read(file, 4096)).toString() !== JSON.stringify(this.receipt(pack))) return false;
      for (const artifact of pack.artifacts) {
        const info = await lstat(path.join(this.location(pack), artifact.file));
        if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.bytes) return false;
      }
      return await this.runtimeInstalled(pack);
    } catch {
      return false;
    }
  }
  private runtimeInstalled(pack: SpeechPack): Promise<boolean> {
    const runtime = pack.runtime;
    if (!runtime) return Promise.resolve(false);
    const prior = this.#runtimeChecks.get(runtime.sha256);
    if (prior && prior.until > Date.now()) return prior.result;
    const result = (async () => {
      try {
        for (const artifact of runtime.files) {
          const info = await lstat(path.join(this.runtimeLocation(pack), "runtime", artifact.file));
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            info.size !== artifact.bytes ||
            (artifact.executable && !(info.mode & 0o100))
          )
            return false;
        }
        return true;
      } catch {
        return false;
      }
    })();
    // UI availability probes share one inventory walk per runtime. Starting a
    // worker still verifies every byte, independently of this short-lived cache.
    this.#runtimeChecks.set(runtime.sha256, { until: Date.now() + 10_000, result });
    return result;
  }
  install(id: string) {
    if (this.#closed || this.task) throw new Error("OD_SPEECH_DOWNLOAD_BUSY");
    const pack = this.get(id);
    if (!this.usable(pack)) throw new Error("OD_SPEECH_PACK_UNAVAILABLE");
    const controller = new AbortController();
    this.#runtimeChecks.clear();
    this.controller = controller;
    this.active = id;
    this.progress = 0;
    this.error = null;
    this.errorPackId = null;
    this.task = this.download(pack, controller.signal)
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
        this.#runtimeChecks.clear();
        this.controller = null;
        this.active = null;
        this.task = null;
        this.onChange();
      });
  }
  async close() {
    this.#closed = true;
    this.controller?.abort();
    await this.task?.catch(() => undefined);
  }
  async download(pack: SpeechPack, signal: AbortSignal) {
    const root = this.location(pack);
    await directory(root);
    const lock = await acquire(this.root);
    try {
      if (
        (await exists(path.join(root, "removal.json"))) ||
        (await exists(path.join(root, "removal.json.new")))
      )
        throw new Error("OD_SPEECH_REMOVAL_PENDING");
      const runtime = pack.runtime;
      if (!runtime) throw new Error("OD_SPEECH_RUNTIME_UNAVAILABLE");
      const runtimeRoot = this.runtimeLocation(pack);
      await directory(runtimeRoot);
      const inventoryFile = path.join(runtimeRoot, "inventory.json");
      let runtimeReady = false;
      if (
        (await exists(inventoryFile)) &&
        (await read(inventoryFile, 8_000_000)).toString() === JSON.stringify(runtime.files)
      ) {
        try {
          for (const file of runtime.files) {
            const info = await lstat(path.join(runtimeRoot, "runtime", file.file));
            if (file.executable && !(info.mode & 0o100)) throw new Error("OD_SPEECH_INTEGRITY");
            const checked = await hashFile(
              path.join(runtimeRoot, "runtime", file.file),
              file.bytes,
              signal,
            );
            if (checked.bytes !== file.bytes || checked.hash.digest("hex") !== file.sha256)
              throw new Error("OD_SPEECH_INTEGRITY");
          }
          runtimeReady = true;
        } catch {
          signal.throwIfAborted();
        }
      }
      const specs = [
        ...pack.artifacts.map((a) => ({ root, a })),
        ...(runtimeReady ? [] : [{ root: runtimeRoot, a: { ...runtime, file: "runtime.tar.gz" } }]),
      ];
      if (runtimeReady) this.progress = runtime.bytes;
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
        const local = this.localFiles.get(item.a.sha256);
        const transfer = local ? copyLocalArtifact.bind(null, local) : download;
        await transfer(
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
      await atomicRecord(path.join(runtimeRoot, "inventory.json"), runtime.files);
      signal.throwIfAborted();
      await this.remember(pack);
      await atomicRecord(path.join(root, "receipt.json"), this.receipt(pack));
    } finally {
      await lock.release();
    }
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
  remove(id: string): Promise<void> {
    if (this.#closed || this.task) throw new Error("OD_SPEECH_DOWNLOAD_BUSY");
    this.#runtimeChecks.clear();
    this.task = this.removeOwned(id).finally(() => {
      this.#runtimeChecks.clear();
      this.task = null;
    });
    return this.task;
  }
  private async removeOwned(id: string) {
    const pack = this.get(id);
    const root = this.location(pack);
    const lock = await acquire(this.root);
    try {
      const present = await exists(root);
      const names = [
        "pack.json",
        "pack.json.new",
        "receipt.json",
        "receipt.json.new",
        "removal.json",
        "removal.json.new",
        "local-config.yaml",
        "local-config.yaml.new",
        ...pack.artifacts.flatMap((artifact) => [
          artifact.file,
          `${artifact.file}.part`,
          `${artifact.file}.resume`,
          `${artifact.file}.resume.new`,
        ]),
      ];
      let runtimeHash = pack.runtime?.sha256;
      if (present) {
        await onlyNames(root, names);
        // Validate every member before removing anything, including the receipt.
        for (const name of names)
          if (await exists(path.join(root, name))) {
            const checked = await regular(path.join(root, name));
            await checked.close();
          }
        const receiptFile = path.join(root, "receipt.json");
        if (await exists(receiptFile)) {
          const receipt = z
            .strictObject({
              engine: z.literal(pack.engine),
              files: z.array(z.string()).max(10),
              artifacts: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(10),
              runtime: z.string().regex(/^[a-f0-9]{64}$/u),
            })
            .safeParse(await readJson(receiptFile, 16384));
          // Directory ownership comes from catalog file names, never receipt paths.
          // A corrupt receipt must not make known, damaged voice files undeletable.
          if (
            receipt.success &&
            receipt.data.artifacts.length === pack.artifacts.length &&
            JSON.stringify([...receipt.data.files].sort()) ===
              JSON.stringify(pack.artifacts.map((artifact) => artifact.file).sort())
          )
            runtimeHash = receipt.data.runtime;
        }
        const marker = path.join(root, "removal.json");
        if (await exists(marker)) {
          const removal = z
            .strictObject({
              version: z.literal(1),
              engine: z.literal(pack.engine),
              runtime: z
                .string()
                .regex(/^[a-f0-9]{64}$/u)
                .nullable(),
            })
            .safeParse(await readJson(marker, 4096));
          if (removal.success) runtimeHash = removal.data.runtime ?? undefined;
        }
      }
      let referenced = false;
      if (runtimeHash)
        for (const other of this.catalog.filter(
          (candidate) => candidate.id !== id && candidate.engine === pack.engine,
        )) {
          const otherRoot = this.location(other);
          if (!(await exists(otherRoot))) continue;
          if (other.runtime?.sha256 === runtimeHash) {
            referenced = true;
            break;
          }
          for (const file of ["receipt.json", "removal.json"])
            if (await exists(path.join(otherRoot, file))) {
              const record: unknown = JSON.parse(
                (await read(path.join(otherRoot, file), 16384)).toString(),
              );
              if (
                !record ||
                typeof record !== "object" ||
                !("runtime" in record) ||
                !("engine" in record) ||
                record.engine !== pack.engine
              )
                throw new Error("OD_SPEECH_INTEGRITY");
              if (record.runtime === runtimeHash) {
                referenced = true;
                break;
              }
            }
          if (referenced) break;
        }
      // Preflight runtime ownership before changing the voice. A retained removal
      // receipt makes a failed/interrupted removal retryable, including old hashes.
      const removeRuntime =
        runtimeHash && !referenced
          ? await this.runtimeRemoval(pack.engine, runtimeHash)
          : undefined;
      if (present) {
        await atomicRecord(path.join(root, "removal.json"), {
          version: 1,
          engine: pack.engine,
          runtime: runtimeHash ?? null,
        });
        for (const name of names.filter((name) => !name.startsWith("removal.json")))
          await removeFile(path.join(root, name));
      }
      await removeRuntime?.();
      if (present) {
        await removeFile(path.join(root, "removal.json.new"));
        await removeFile(path.join(root, "removal.json"));
        const { rmdir } = await import("node:fs/promises");
        await rmdir(root);
      }
      this.error = null;
      this.errorPackId = null;
    } finally {
      await lock.release();
    }
  }
  private async runtimeRemoval(engine: SpeechPack["engine"], runtimeHash: string) {
    const root = path.join(this.root, `${engine}-${runtimeHash}`);
    if (!(await exists(root))) return undefined;
    await directory(root, false);
    const inventoryFile = path.join(root, "inventory.json");
    const current = this.catalog.find(
      (pack) => pack.engine === engine && pack.runtime?.sha256 === runtimeHash,
    )?.runtime?.files;
    const inventory = z
      .array(
        z.strictObject({
          file: z
            .string()
            .min(1)
            .max(500)
            .refine(
              (file) =>
                !path.isAbsolute(file) &&
                !file.includes("\\") &&
                !file.includes("\0") &&
                !file.split("/").some((part) => !part || part === "." || part === ".."),
            ),
          url: z.string().max(4096),
          bytes: z.int().nonnegative().max(4_000_000_000),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          executable: z.boolean().optional(),
        }),
      )
      .max(50000);
    const stored = (await exists(inventoryFile))
      ? inventory.safeParse(await readJson(inventoryFile, 24_000_000))
      : undefined;
    if (stored && !stored.success && !current) throw new Error("OD_SPEECH_INTEGRITY");
    const files = stored?.success ? stored.data : (current ?? []);
    const pinned = new Map(current?.map((file) => [file.file, file]));
    const matchesPinned =
      !current ||
      (files.length === current.length &&
        files.every((file) => {
          const expected = pinned.get(file.file);
          return (
            expected &&
            expected.bytes === file.bytes &&
            expected.sha256 === file.sha256 &&
            expected.url === file.url &&
            Boolean(expected.executable) === Boolean(file.executable)
          );
        }));
    const owned = current && !matchesPinned ? current : files;
    if (new Set(owned.map((file) => file.file)).size !== owned.length)
      throw new Error("OD_SPEECH_INTEGRITY");
    const allowed = new Set([
      "runtime.tar.gz",
      "runtime.tar.gz.part",
      "runtime.tar.gz.resume",
      "runtime.tar.gz.resume.new",
      "inventory.json",
      "inventory.json.new",
      ...owned.flatMap((file) => [`runtime/${file.file}`, `runtime/${file.file}.extracting`]),
    ]);
    const allowedDirectories = new Set(["runtime"]);
    for (const file of owned) {
      let parent = path.posix.dirname(`runtime/${file.file}`);
      while (parent !== ".") {
        allowedDirectories.add(parent);
        parent = path.posix.dirname(parent);
      }
    }
    const { readdir, rmdir } = await import("node:fs/promises");
    const ownedFiles: string[] = [],
      directories: string[] = [];
    const walk = async (location: string) => {
      await directory(location, false);
      for (const name of await readdir(location)) {
        const file = path.join(location, name),
          info = await lstat(file);
        if (info.isSymbolicLink()) throw new Error("OD_SPEECH_UNSAFE_FILE");
        if (info.isDirectory() && allowedDirectories.has(path.relative(root, file))) {
          await walk(file);
          directories.push(file);
        } else if (info.isFile() && allowed.has(path.relative(root, file))) {
          const checked = await regular(file);
          await checked.close();
          ownedFiles.push(file);
        } else throw new Error("OD_SPEECH_UNSAFE_FILE");
      }
    };
    await walk(root);
    return async () => {
      // Retain the inventory until payload files and directories are gone.
      for (const file of ownedFiles.filter(
        (file) => file !== inventoryFile && file !== `${inventoryFile}.new`,
      ))
        await removeFile(file);
      for (const location of directories) await rmdir(location);
      await removeFile(path.join(root, "inventory.json.new"));
      await removeFile(inventoryFile);
      await rmdir(root);
    };
  }
}
async function readJson(file: string, limit: number): Promise<unknown> {
  const data = await read(file, limit);
  try {
    return JSON.parse(data.toString()) as unknown;
  } catch {
    return null;
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
  const inventory = new Map(files.map((file) => [file.file, file]));
  try {
    for (;;) {
      const header = await take(512);
      if (header.every((b) => b === 0)) break;
      const leaf = header.subarray(0, 100).toString().split("\0")[0] ?? "";
      const prefix = header.subarray(345, 500).toString().split("\0")[0] ?? "";
      const name = prefix ? `${prefix}/${leaf}` : leaf;
      const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, "").trim(), 8);
      const spec = inventory.get(name);
      if (
        !spec ||
        seen.has(name) ||
        ![0, 48].includes(header.readUInt8(156)) ||
        name.startsWith("/") ||
        name.split("/").some((p) => !p || p === "." || p === "..") ||
        size !== spec.bytes
      )
        throw new Error("OD_SPEECH_ARCHIVE");
      const target = path.join(root, name);
      await directory(path.dirname(target));
      const temporary = `${target}.extracting`;
      await removeFile(temporary);
      const output = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const digest = createHash("sha256");
        let remaining = size;
        while (remaining > 0) {
          const chunk = await take(Math.min(remaining, 1024 ** 2));
          digest.update(chunk);
          let written = 0;
          while (written < chunk.length) {
            signal.throwIfAborted();
            const result = await output.write(chunk, written, chunk.length - written);
            if (!result.bytesWritten) throw new Error("OD_SPEECH_ARCHIVE");
            written += result.bytesWritten;
          }
          remaining -= chunk.length;
        }
        if (digest.digest("hex") !== spec.sha256) throw new Error("OD_SPEECH_INTEGRITY");
        if (spec.executable || (spec.executable === undefined && name.startsWith("bin/")))
          await output.chmod(0o700);
        await output.sync();
        signal.throwIfAborted();
        await rename(temporary, target);
      } finally {
        await output.close();
        await removeFile(temporary);
      }
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
