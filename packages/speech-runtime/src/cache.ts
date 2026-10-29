import { validateSpeechAudio } from "./audio.js";
import { readdir, unlink, statfs, lstat } from "node:fs/promises";
import path from "node:path";
import { atomic, directory, exists, hash, read } from "./files.js";

export const cacheLimit = 1_000_000_000;
type Entry = { id: string; bytes: number; sha256: string; used: number; pins: string[] };
export class AudioCache {
  #queue: Promise<unknown> = Promise.resolve();
  #run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work, work);
    this.#queue = result.catch(() => undefined);
    return result;
  }
  entries() {
    return this.#run(() => this.list());
  }
  diskEntries() {
    return this.#run(async () => {
      const entries: Entry[] = [];
      for (const entry of await this.list()) {
        try {
          const info = await lstat(path.join(this.root, `${entry.id}.ogg`));
          if (info.isFile() && !info.isSymbolicLink()) entries.push({ ...entry, bytes: info.size });
        } catch {
          /* Missing files consume no space. */
        }
      }
      return entries;
    });
  }
  available() {
    return this.#run(async () => {
      const available: Entry[] = [];
      for (const entry of await this.list()) {
        try {
          const audio = await read(path.join(this.root, `${entry.id}.ogg`));
          if (audio.length === entry.bytes && hash(audio) === entry.sha256) available.push(entry);
        } catch {
          /* Missing/corrupt files remain retryable. */
        }
      }
      return available;
    });
  }
  peek(id: string) {
    return this.#run(() => this.readClip(id, false));
  }
  clearPrivate() {
    return this.#run(async () => {
      await directory(this.root);
      for (const name of await readdir(this.root)) {
        if (!/^[a-f0-9]{64}\.(ogg|json|complete)$/u.test(name)) continue;
        const file = path.join(this.root, name);
        const info = await lstat(file);
        if (info.isFile() && !info.isSymbolicLink()) await unlink(file);
      }
    });
  }
  get(id: string) {
    return this.#run(() => this.readClip(id));
  }
  put(id: string, data: Buffer, pins: string[] = []) {
    return this.#run(() => this.writeClip(id, data, pins));
  }
  pin(id: string, course: string) {
    return this.#run(() => this.pinClip(id, course));
  }
  reconcileCourse(course: string, ids: string[]) {
    return this.#run(async () => {
      for (const e of await this.list()) {
        if (e.pins.includes(course) && !ids.includes(e.id)) {
          e.pins = e.pins.filter((p) => p !== course);
          if (e.pins.length) await atomic(path.join(this.root, `${e.id}.json`), JSON.stringify(e));
          else await this.removeEntry(e);
        }
      }
    });
  }
  removeCourse(course: string) {
    return this.#run(() => this.unpinCourse(course));
  }
  delete(entry: Entry) {
    return this.#run(async () => {
      const latest = (await this.list()).find((e) => e.id === entry.id);
      if (latest && !latest.pins.length) await this.removeEntry(latest);
    });
  }

  constructor(readonly root: string) {}
  async list(): Promise<Entry[]> {
    await directory(this.root);
    const entries: Entry[] = [];
    for (const name of await readdir(this.root)) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
      let value: unknown;
      try {
        value = JSON.parse((await read(path.join(this.root, name), 65536)).toString());
      } catch {
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const e = value as Entry;
      if (
        e.id !== name.slice(0, 64) ||
        !Number.isSafeInteger(e.bytes) ||
        e.bytes < 0 ||
        !/^[a-f0-9]{64}$/u.test(e.sha256) ||
        !Number.isFinite(e.used) ||
        !Array.isArray(e.pins) ||
        !e.pins.every((p) => typeof p === "string")
      )
        continue;
      entries.push(e);
    }
    return entries;
  }
  async readClip(id: string, touch = true): Promise<Buffer | null> {
    const entry = (await this.list()).find((e) => e.id === id);
    if (!entry) return null;
    const file = path.join(this.root, `${id}.ogg`);
    if (!(await exists(file))) return null;
    let data: Buffer;
    try {
      data = await read(file);
    } catch {
      return null;
    }
    if (data.length !== entry.bytes || hash(data) !== entry.sha256) {
      return null;
    }
    if (touch)
      await atomic(
        path.join(this.root, `${id}.json`),
        JSON.stringify({ ...entry, used: Date.now() }),
      );
    return data;
  }
  async writeClip(id: string, data: Buffer, pins: string[] = []) {
    if (!/^[a-f0-9]{64}$/u.test(id) || data.subarray(0, 4).toString() !== "OggS")
      throw new Error("OD_SPEECH_AUDIO_INVALID");
    validateSpeechAudio(data);
    await directory(this.root);
    const disk = await statfs(this.root);
    if (disk.bavail * disk.bsize < data.length + 32_000_000) throw new Error("OD_SPEECH_DISK_FULL");
    const old = (await this.list()).find((e) => e.id === id);
    await atomic(path.join(this.root, `${id}.ogg`), data);
    await atomic(
      path.join(this.root, `${id}.json`),
      JSON.stringify({
        id,
        bytes: data.length,
        sha256: hash(data),
        used: Date.now(),
        pins: [...new Set([...(old?.pins ?? []), ...pins])],
      }),
    );
  }
  async pinClip(id: string, course: string) {
    const e = (await this.list()).find((e) => e.id === id);
    if (!e) return;
    await atomic(
      path.join(this.root, `${id}.json`),
      JSON.stringify({ ...e, pins: [...new Set([...e.pins, course])] }),
    );
  }
  async unpinCourse(course: string) {
    for (const e of await this.list())
      if (e.pins.includes(course)) {
        e.pins = e.pins.filter((p) => p !== course);
        if (!e.pins.length) await this.removeEntry(e);
        else await atomic(path.join(this.root, `${e.id}.json`), JSON.stringify(e));
      }
  }
  async removeEntry(e: Entry) {
    for (const ext of ["ogg", "json"]) {
      const file = path.join(this.root, `${e.id}.${ext}`);
      if (await exists(file)) await unlink(file);
    }
  }
}
export async function trimCaches(caches: AudioCache[], clear = false) {
  const entries = (
    await Promise.all(
      caches.map(async (cache) =>
        (await cache.entries()).filter((e) => !e.pins.length).map((entry) => ({ cache, entry })),
      ),
    )
  )
    .flat()
    .sort((a, b) => a.entry.used - b.entry.used);
  let bytes = entries.reduce((n, e) => n + e.entry.bytes, 0);
  for (const { cache, entry } of entries) {
    if (!clear && bytes <= cacheLimit) break;
    await cache.delete(entry);
    bytes -= entry.bytes;
  }
}
