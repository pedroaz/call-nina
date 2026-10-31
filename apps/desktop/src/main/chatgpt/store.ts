import { chatgptRegistrationIdSchema, z } from "@call-nina/contracts";
import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { ConnectionSecretStorage } from "../secret-storage.js";

export const tokenSchema = z.object({
  access_token: z.string().min(1).max(32000),
  refresh_token: z.string().min(1).max(32000),
  id_token: z.string().min(1).max(32000),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  expires_in: z.number().positive().max(86400),
  scope: z.string().max(2000),
  earliest_refresh_at: z.number().nonnegative().optional(),
});
export const registrationSchema = z.strictObject({
  id: chatgptRegistrationIdSchema,
  subject: z.string().min(1).max(512),
  label: z.string().min(1).max(320),
  tokens: tokenSchema.nullable(),
  savedAt: z.number().nonnegative(),
  invalid: z.boolean(),
});
export const storeSchema = z
  .strictObject({
    version: z.literal(1),
    hostId: z.uuid(),
    selectedId: chatgptRegistrationIdSchema.nullable(),
    registrations: z.array(registrationSchema).max(20),
    remoteRevocationPending: z.boolean(),
  })
  .superRefine((value, context) => {
    const ids = value.registrations.map((entry) => entry.id);
    if (
      new Set(ids).size !== ids.length ||
      (value.selectedId !== null && !ids.includes(value.selectedId))
    )
      context.addIssue({ code: "custom", message: "OD_CHATGPT_STORE_INVALID" });
  });
export type Store = z.infer<typeof storeSchema>;
export type Registration = Store["registrations"][number];
export class ChatgptStore {
  state() {
    return this.#secrets.state();
  }
  readonly #configDirectory: string;
  readonly #secrets: ConnectionSecretStorage;
  constructor(configDirectory: string, secrets: ConnectionSecretStorage) {
    this.#configDirectory = configDirectory;
    this.#secrets = secrets;
  }
  async directory() {
    const directory = path.join(this.#configDirectory, "chatgpt-plan");
    let cursor = path.parse(directory).root;
    for (const part of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error("OD_CHATGPT_STORAGE_UNSAFE");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new Error("OD_CHATGPT_STORAGE_UNSAFE");
    return directory;
  }
  async read(): Promise<Store> {
    if (this.#secrets.state().status !== "available")
      throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    const filename = path.join(await this.directory(), "accounts.enc");
    let file;
    try {
      file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      const created: Store = {
        version: 1,
        hostId: randomUUID(),
        selectedId: null,
        registrations: [],
        remoteRevocationPending: false,
      };
      await this.write(created);
      return created;
    }
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size > 2 * 1024 * 1024 ||
        (process.platform !== "win32" &&
          ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
      )
        throw new Error("OD_CHATGPT_STORAGE_UNSAFE");
      const bytes = await file.readFile();
      try {
        return storeSchema.parse(JSON.parse(safeStorage.decryptString(bytes)));
      } finally {
        bytes.fill(0);
      }
    } finally {
      await file.close();
    }
  }
  async write(value: Store) {
    if (this.#secrets.state().status !== "available")
      throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    const directory = await this.directory();
    const bytes = safeStorage.encryptString(JSON.stringify(storeSchema.parse(value)));
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path.join(directory, "accounts.enc"));
      if (process.platform !== "win32") {
        const handle = await open(directory, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    } finally {
      bytes.fill(0);
      await unlink(temporary).catch(() => undefined);
    }
  }
}
