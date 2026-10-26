import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import { ninaLoginCredentialsSchema, type NinaLoginCredentials } from "@call-nina/contracts";
import { ConnectionSecretStorage } from "./secret-storage.js";

/** Device-only, encrypted login draft; never part of learner exports or diagnostics. */
export class NinaLoginStorage {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}
  async #checkDirectory() {
    const stat = await lstat(this.directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
    )
      throw new Error("OD_NINA_LOGIN_STORAGE");
  }
  async read(): Promise<NinaLoginCredentials | null> {
    await this.#queue;
    if (new ConnectionSecretStorage(this.directory).state().status !== "available")
      throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    await this.#checkDirectory();
    let file;
    try {
      file = await open(
        path.join(this.directory, "nina-login.enc"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("OD_NINA_LOGIN_STORAGE");
    }
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > 16384 ||
        (process.platform !== "win32" &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
      )
        throw new Error("OD_NINA_LOGIN_STORAGE");
      const bytes = await file.readFile();
      try {
        return ninaLoginCredentialsSchema.parse(JSON.parse(safeStorage.decryptString(bytes)));
      } finally {
        bytes.fill(0);
      }
    } finally {
      await file.close();
    }
  }
  save(credentials: NinaLoginCredentials): Promise<void> {
    const work = this.#queue.then(async () => {
      if (new ConnectionSecretStorage(this.directory).state().status !== "available")
        throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
      const value = ninaLoginCredentialsSchema.parse(credentials);
      const encrypted = safeStorage.encryptString(JSON.stringify(value));
      const temporary = path.join(this.directory, "nina-login.enc.pending");
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await this.#checkDirectory();
        // Discard only this store's interrupted temporary file, never the saved draft.
        await unlink(temporary).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code !== "ENOENT") throw cause;
        });
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(encrypted);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path.join(this.directory, "nina-login.enc"));
      } finally {
        encrypted.fill(0);
      }
    });
    this.#queue = work.catch(() => undefined);
    return work;
  }
}
