import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { z } from "zod";

export function fail(code: string): never {
  throw new Error(`OD_OFFLINE_${code}`);
}
export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) fail("CANCELLED");
}
export function safeCode(error: unknown): string {
  return error instanceof Error && /^OD_OFFLINE_[A-Z_]+$/u.test(error.message)
    ? error.message
    : "OD_OFFLINE_UNAVAILABLE";
}
export function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export async function directory(root: string, create = true, privateLeaf = true): Promise<void> {
  if (!path.isAbsolute(root) || path.resolve(root) !== root) fail("PATH_INVALID");
  let current = path.parse(root).root;
  for (const component of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (create)
      await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0)
      fail("PATH_UNSAFE");
    if (
      privateLeaf &&
      current === root &&
      (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
    )
      fail("PATH_UNSAFE");
  }
}
export async function regular(file: string, flags: number = constants.O_RDONLY) {
  const handle = await open(file, flags | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o022) !== 0
    )
      fail("FILE_UNSAFE");
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export async function readSmall(file: string, limit = 8192): Promise<Buffer> {
  const handle = await regular(file);
  try {
    if ((await handle.stat()).size > limit) fail("FILE_INVALID");
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
    })) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      if (bytes > limit) fail("FILE_INVALID");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}
export async function hashFile(file: string, maximum: number, signal?: AbortSignal) {
  const handle = await regular(file);
  try {
    const info = await handle.stat();
    if (info.size > maximum) fail("FILE_INVALID");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      highWaterMark: 1024 ** 2,
    })) {
      if (signal?.aborted) fail("CANCELLED");
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      if (bytes > maximum) fail("FILE_INVALID");
      hash.update(buffer);
    }
    if (bytes !== info.size) fail("FILE_CHANGED");
    return { bytes, hash };
  } finally {
    await handle.close();
  }
}
export async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}
export async function removeFile(file: string): Promise<void> {
  if (!(await exists(file))) return;
  const handle = await regular(file);
  await handle.close();
  await unlink(file);
}
export async function writeNew(file: string, value: Uint8Array | string, executable = false) {
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    executable ? 0o700 : 0o600,
  );
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function atomic(file: string, value: unknown): Promise<void> {
  // A crash can leave this exact temporary file. It is not an installation marker.
  await removeFile(`${file}.new`);
  await writeNew(`${file}.new`, JSON.stringify(value));
  if (await exists(file)) {
    const handle = await regular(file);
    await handle.close();
  }
  await rename(`${file}.new`, file);
}
export async function onlyNames(root: string, allowed: readonly string[]) {
  await directory(root, false);
  if ((await readdir(root)).some((name) => !allowed.includes(name))) fail("UNOWNED_FILES");
}
const identitySchema = z.strictObject({
  pid: z.int().positive(),
  start: z.string().min(1),
  boot: z.string().min(1),
});
const lockSchema = z.strictObject({
  owner: identitySchema,
  child: z.union([identitySchema, z.literal("spawning"), z.null()]),
});
type Identity = z.infer<typeof identitySchema>;
async function identity(pid: number): Promise<Identity | null> {
  try {
    const stat = await readFile(`/proc/${String(pid)}/stat`, "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    if (!start) fail("LOCK_INVALID");
    return { pid, start, boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
async function alive(expected: Identity): Promise<boolean> {
  const actual = await identity(expected.pid);
  return actual !== null && actual.start === expected.start && actual.boot === expected.boot;
}
export async function acquire(root: string) {
  await directory(root);
  if (process.platform !== "linux") fail("PLATFORM_UNSUPPORTED");
  // Linux abstract socket is a kernel-released, cross-process mutex. It serializes
  // stale receipt recovery as well as mutations, without signalling foreign PIDs.
  const mutex = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    mutex.once("error", () => {
      reject(new Error("OD_OFFLINE_BUSY"));
    });
    mutex.listen(`\0nina-offline-${createHash("sha256").update(root).digest("hex")}`, resolve);
  });
  const closeMutex = () =>
    new Promise<void>((resolve) =>
      mutex.close(() => {
        resolve();
      }),
    );
  try {
    const file = path.join(root, "owner.json");
    if (await exists(file)) {
      const previous = lockSchema.parse(JSON.parse((await readSmall(file)).toString()));
      // A crash after spawn but before the identity commit can leave a live
      // child with no recoverable identity. Keep that uncertainty fail-closed.
      if (
        previous.child === "spawning" ||
        (await alive(previous.owner)) ||
        (previous.child && (await alive(previous.child)))
      )
        fail("BUSY");
      await removeFile(file);
    }
    const owner = await identity(process.pid);
    if (!owner) fail("LOCK_INVALID");
    const record: z.infer<typeof lockSchema> = { owner, child: null };
    await writeNew(file, JSON.stringify(record));
    return {
      async spawning() {
        record.child = "spawning";
        await atomic(file, record);
      },
      async child(pid: number) {
        const child = await identity(pid);
        if (!child) fail("RUNTIME_EXITED");
        record.child = child;
        await atomic(file, record);
      },
      async release({ childSettled = false } = {}) {
        try {
          // Only the owner awaiting its exact ChildProcess close may clear a
          // spawning/live-child receipt. Always release the kernel mutex.
          if (record.child === null || childSettled) await removeFile(file);
        } finally {
          await closeMutex();
        }
      },
    };
  } catch (error) {
    await closeMutex();
    throw error;
  }
}
