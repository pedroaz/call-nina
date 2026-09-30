import { constants } from "node:fs";
import { mkdir, lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import {
  aiSecretInputSchema,
  aiSecretReferenceSchema,
  secureStorageStateSchema,
} from "@call-nina/contracts";

// Electron's documented synchronous providers: Keychain, DPAPI and Linux secret
// stores. basic_text/unknown are explicitly forbidden, even if encryption reports
// available. https://www.electronjs.org/docs/latest/api/safe-storage
// Ciphertexts belong to this app's device config, never the portable learner root.
export class ConnectionSecretStorage {
  constructor(private readonly configDirectory: string) {}
  state() {
    if (!safeStorage.isEncryptionAvailable())
      return secureStorageStateSchema.parse({ status: "unavailable" });
    const backend =
      process.platform === "darwin"
        ? "keychain"
        : process.platform === "win32"
          ? "dpapi"
          : process.platform === "linux"
            ? safeStorage.getSelectedStorageBackend()
            : "unknown";
    const parsed = secureStorageStateSchema.safeParse({ status: "available", backend });
    return parsed.success ? parsed.data : secureStorageStateSchema.parse({ status: "unavailable" });
  }
  async #directory() {
    const directory = path.join(this.configDirectory, "connection-secrets");
    let cursor = path.parse(directory).root;
    for (const segment of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error("OD_SECRET_STORAGE_UNSAFE");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    )
      throw new Error("OD_SECRET_STORAGE_UNSAFE");
    return directory;
  }
  async #syncDirectory(directory: string): Promise<void> {
    // Node cannot open directories for fsync on Windows; retain its existing
    // platform-supported filesystem behavior without weakening other platforms.
    if (process.platform === "win32") return;
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  // The caller reserves the opaque reference in SQLite before writing bytes, so
  // interrupted replacements remain owned and can be cleaned on restart.
  async save(reference: string, value: string): Promise<void> {
    const ref = aiSecretReferenceSchema.parse(reference);
    if (this.state().status !== "available") throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    const secret = aiSecretInputSchema.parse(value);
    let encrypted: Buffer;
    try {
      encrypted = safeStorage.encryptString(secret);
    } catch {
      throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    }
    const filename = path.join(await this.#directory(), ref);
    try {
      const file = await open(filename, "wx", 0o600);
      try {
        await file.writeFile(encrypted);
        await file.sync();
      } finally {
        await file.close();
      }
      // Persist the directory entry before SQLite can publish its reference.
      await this.#syncDirectory(path.dirname(filename));
    } finally {
      encrypted.fill(0);
    }
  }
  // Privileged adapter use only. No IPC or renderer method returns this value.
  async read(reference: string): Promise<string> {
    if (this.state().status !== "available") throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    const ref = aiSecretReferenceSchema.parse(reference);
    try {
      const file = await open(
        path.join(await this.#directory(), ref),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size > 32768 ||
          (process.platform !== "win32" &&
            ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
        )
          throw new Error("OD_SECRET_STORAGE_UNSAFE");
        const bytes = await file.readFile();
        try {
          return aiSecretInputSchema.parse(safeStorage.decryptString(bytes));
        } finally {
          bytes.fill(0);
        }
      } finally {
        await file.close();
      }
    } catch {
      throw new Error("OD_CONNECTION_CREDENTIAL_UNAVAILABLE");
    }
  }
  async remove(reference: string): Promise<void> {
    const ref = aiSecretReferenceSchema.parse(reference);
    try {
      const directory = await this.#directory();
      try {
        await unlink(path.join(directory, ref));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // ENOENT may retry an earlier unlink whose directory sync failed. Only
      // resolve after syncing so the caller can safely forget cleanup ownership.
      await this.#syncDirectory(directory);
    } catch {
      throw new Error("OD_SECRET_DELETE_FAILED");
    }
  }
}
