import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export async function directory(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (!(await lstat(dir)).isDirectory() || (await lstat(dir)).isSymbolicLink())
    throw new Error("OD_SPEECH_UNSAFE_FILE");
}
export async function read(file: string, maximum = 20_000_000): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new Error("OD_SPEECH_UNSAFE_FILE");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
export async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export async function atomic(file: string, data: string | Uint8Array) {
  await directory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } finally {
    if (await exists(temporary)) await unlink(temporary);
  }
}
export async function boundedBody(response: Response, maximum: number, signal: AbortSignal) {
  if (!response.ok || !response.body) throw new Error("OD_SPEECH_DOWNLOAD_FAILED");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array)) throw new Error("OD_SPEECH_DOWNLOAD_FAILED");
      size += chunk.byteLength;
      if (size > maximum) throw new Error("OD_SPEECH_TOO_LARGE");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

export async function diskUsage(root: string): Promise<number> {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink()) return 0;
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    let bytes = 0;
    for (const name of await readdir(root)) bytes += await diskUsage(path.join(root, name));
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
