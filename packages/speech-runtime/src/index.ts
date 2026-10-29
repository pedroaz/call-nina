import path from "node:path";
import { readFile, statfs } from "node:fs/promises";
import {
  speechManifestSchema,
  waveNetVoices,
  speechPreferencesSchema,
  defaultSpeechPreferences,
  type SpeechPreferences,
  type SpeechRequest,
  type SpeechManifest,
  type SpeechSnapshot,
  type SpeechAction,
  type SpeechResult,
} from "@call-nina/contracts";
import { AudioCache, trimCaches, cacheLimit } from "./cache.js";
import { SpeechPacks } from "./packs.js";
import { SpeechWorker } from "./worker.js";
import { speechPacks } from "./catalog.js";
import { diskUsage, directory, atomic, boundedBody, exists, hash, read } from "./files.js";

export { validateSpeechAudio } from "./audio.js";
export { speechPacks } from "./catalog.js";
export { hash } from "./files.js";
export async function curriculumDigest(root: string) {
  const catalog = await readFile(path.join(root, "catalog.json"));
  const data = JSON.parse(catalog.toString()) as { languages: { files: string[] }[] };
  const files = [...new Set(data.languages.flatMap((l) => l.files))].sort();
  return hash(
    Buffer.concat([
      catalog,
      ...(await Promise.all(files.map((f) => readFile(path.join(root, f))))),
    ]),
  );
}
export class SpeechService {
  readonly packs: SpeechPacks;
  readonly worker = new SpeechWorker();
  readonly publicCache: AudioCache;
  privateCache: AudioCache | null = null;
  preferences: SpeechPreferences = { ...defaultSpeechPreferences };
  manifest: SpeechManifest | null = null;
  #root: string | null = null;
  #controller: AbortController | null = null;
  #download: AbortController | null = null;
  #course: string | null = null;
  #downloadJob: Promise<void> | null = null;
  #error: string | null = null;
  #epoch = 0;
  #load: Promise<void>;
  constructor(
    readonly deviceRoot: string,
    readonly curriculumRoot: string,
  ) {
    this.packs = new SpeechPacks(path.join(deviceRoot, "models"));
    this.publicCache = new AudioCache(path.join(deviceRoot, "curriculum"));
    this.#load = this.loadManifest().catch(() => {
      this.#error = "OD_SPEECH_CURRICULUM_UNAVAILABLE";
    });
  }
  async loadManifest() {
    const file = path.join(this.curriculumRoot, "audio-manifest.json");
    if (!(await exists(file))) return;
    const manifest = speechManifestSchema.parse(
      JSON.parse((await read(file, 32_000_000)).toString()),
    );
    if (manifest.curriculumDigest !== (await curriculumDigest(this.curriculumRoot)))
      throw new Error("OD_SPEECH_CURRICULUM_STALE");
    this.manifest = manifest;
  }
  setRoot(root: string, preferences: SpeechPreferences) {
    if (root !== this.#root) {
      this.stop();
      this.#epoch++;
      this.#root = root;
      this.privateCache = new AudioCache(path.join(root, "speech-cache"));
    }
    this.preferences = speechPreferencesSchema.parse(preferences);
  }
  resetRoot() {
    this.stop();
    this.#epoch++;
    this.#root = null;
    this.privateCache = null;
  }
  stop() {
    this.#controller?.abort();
    this.worker.stop();
  }
  close() {
    this.stop();
    this.#download?.abort();
    this.packs.controller?.abort();
    return Promise.resolve();
  }
  async inspect(): Promise<SpeechSnapshot> {
    await this.#load;
    const caches = [this.publicCache, ...(this.privateCache ? [this.privateCache] : [])];
    const entries = (await Promise.all(caches.map((c) => c.diskEntries()))).flat();
    const publicEntries = await this.publicCache.available();
    const publicMetadata = await this.publicCache.entries();
    await directory(this.deviceRoot);
    const space = await statfs(this.deviceRoot);
    return {
      privateBytes: this.privateCache ? await diskUsage(this.privateCache.root) : 0,
      publicBytes: await diskUsage(this.publicCache.root),
      modelBytes: await diskUsage(this.packs.root),
      freeBytes: Math.max(0, space.bavail * space.bsize),
      supported: process.platform === "linux" && process.arch === "x64",
      preferences: this.preferences,
      cacheLimitBytes: cacheLimit,
      cacheBytes: entries.filter((e) => !e.pins.length).reduce((n, e) => n + e.bytes, 0),
      packs: await Promise.all(
        speechPacks.map(async (p) => ({
          id: p.id,
          engine: p.engine,
          language: p.language,
          voice: p.voice,
          state:
            this.packs.active === p.id
              ? ("downloading" as const)
              : (await this.packs.installed(p))
                ? ("installed" as const)
                : !p.qualified || !p.runtime
                  ? ("unavailable" as const)
                  : (await this.packs.needsUpdate(p))
                    ? ("update" as const)
                    : (await exists(this.packs.location(p)))
                      ? ("partial" as const)
                      : ("absent" as const),
          downloadBytes: p.artifacts.reduce((n, a) => n + a.bytes, 0) + (p.runtime?.bytes ?? 0),
          downloadedBytes: this.packs.active === p.id ? this.packs.progress : 0,
          diskBytes: await diskUsage(this.packs.location(p)),
          installedBytes:
            p.artifacts.reduce((n, a) => n + a.bytes, 0) +
            (p.runtime?.bytes ?? 0) +
            (p.runtime?.files.reduce((n, a) => n + a.bytes, 0) ?? 0),
          error: this.packs.errorPackId === p.id ? this.packs.error : null,
        })),
      ),
      courses: [...new Set(this.manifest?.clips.flatMap((c) => c.courses) ?? [])].map((id) => {
        const clips = (this.manifest?.clips ?? []).filter((c) => c.courses.includes(id));
        return {
          id,
          hasDownload: publicMetadata.some((e) => e.pins.includes(id)),
          diskBytes: publicEntries
            .filter((e) => e.pins.includes(id))
            .reduce((n, e) => n + e.bytes, 0),
          bytes: clips.reduce((n, c) => n + c.bytes, 0),
          downloadedBytes: clips
            .filter((c) => publicEntries.some((e) => e.id === c.id))
            .reduce((n, c) => n + c.bytes, 0),
          pinned: clips.every((c) =>
            publicEntries.some((e) => e.id === c.id && e.pins.includes(id)),
          ),
        };
      }),
      downloadingCourse: this.#course,
      error: this.#error,
    };
  }
  async manage(action: SpeechAction) {
    if (action.action === "preferences") {
      this.stop();
      this.preferences = action.preferences;
    } else if (action.action === "cancel") {
      this.#controller?.abort();
    } else if (action.action === "cancel-course") {
      this.#download?.abort();
    } else if (action.action === "cancel-download" && this.packs.active === action.packId)
      this.packs.controller?.abort();
    else if (action.action === "install") {
      this.worker.stop();
      await this.packs.install(action.packId);
    } else if (action.action === "remove") {
      this.worker.stop();
      await this.packs.remove(action.packId);
    } else if (action.action === "clear-private-cache") {
      this.stop();
      if (this.privateCache) await this.privateCache.clearPrivate();
    } else if (action.action === "clear-cache") {
      this.stop();
      await trimCaches([this.publicCache, ...(this.privateCache ? [this.privateCache] : [])], true);
    } else if (action.action === "remove-course") {
      if (this.#course === action.courseId) {
        this.#download?.abort();
        await this.#downloadJob;
      }
      await this.publicCache.removeCourse(action.courseId);
    } else if (action.action === "download-course") {
      await this.#load;
      if (this.#download) throw new Error("OD_SPEECH_DOWNLOAD_BUSY");
      const clips = this.manifest?.clips.filter((c) => c.courses.includes(action.courseId));
      if (!clips?.length) throw new Error("OD_SPEECH_CURRICULUM_UNAVAILABLE");
      const controller = new AbortController();
      this.#download = controller;
      this.#course = action.courseId;
      this.#error = null;
      this.#downloadJob = (async () => {
        for (const clip of clips) {
          controller.signal.throwIfAborted();
          await this.curriculumClip(clip, controller.signal);
          controller.signal.throwIfAborted();
          await this.publicCache.pin(clip.id, action.courseId);
        }
        await this.publicCache.reconcileCourse(
          action.courseId,
          clips.map((c) => c.id),
        );
      })()
        .catch(() => {
          this.#error = "OD_SPEECH_DOWNLOAD_FAILED";
        })
        .finally(() => {
          this.#download = null;
          this.#course = null;
          this.#downloadJob = null;
        });
    }
  }
  async curriculumClip(clip: SpeechManifest["clips"][number], signal: AbortSignal) {
    const cached = await this.publicCache.get(clip.id);
    if (cached && hash(cached) === clip.sha256 && cached.length === clip.bytes) return cached;
    const response = await fetch(clip.url, { signal, redirect: "error", credentials: "omit" });
    const audio = await boundedBody(response, clip.bytes, signal);
    if (audio.length !== clip.bytes || hash(audio) !== clip.sha256)
      throw new Error("OD_SPEECH_INTEGRITY");
    signal.throwIfAborted();
    await this.publicCache.put(clip.id, audio);
    return audio;
  }
  identity(request: SpeechRequest) {
    const source = this.preferences[request.language];
    const pack = speechPacks.find((p) => p.engine === source && p.language === request.language);
    const version =
      source === "managed"
        ? `google-wavenet-v1:${waveNetVoices[request.language]}`
        : JSON.stringify([
            pack?.voice,
            pack?.runtime?.sha256,
            pack?.artifacts.map((a) => a.sha256),
          ]);
    const key = hash(JSON.stringify([request.language, request.text, source, version]));
    return { source, pack, key };
  }
  async availability(
    request: SpeechRequest,
    online: boolean,
    account: { enabled: boolean; serviceEnabled: boolean; remainingCharacters: number } | null,
  ) {
    await this.#load;
    const result = (
      reason: "ready" | "offline" | "model" | "account" | "allowance" | "unavailable",
    ) => ({ available: reason === "ready", reason });
    const prepared = this.manifest?.clips.find(
      (c) => c.language === request.language && c.textDigest === hash(request.text),
    );
    if (prepared) {
      const cached = await this.publicCache.peek(prepared.id);
      if (cached && hash(cached) === prepared.sha256) return result("ready");
      return result(online ? "ready" : "offline");
    }
    const { source, pack, key } = this.identity(request);
    const cache = this.privateCache;
    if (cache) {
      const file = path.join(cache.root, `${key}.complete`);
      if (await exists(file)) {
        const count = Number((await read(file, 16)).toString());
        if (Number.isInteger(count) && count > 0 && count <= 12) {
          let complete = true;
          for (let i = 0; i < count; i++)
            if (!(await cache.peek(hash(`${key}:${String(i)}`)))) {
              complete = false;
              break;
            }
          if (complete) return result("ready");
        }
      }
    }
    if (source === "managed") {
      if (!online) return result("offline");
      if (!account?.enabled || !account.serviceEnabled) return result("account");
      return result(
        account.remainingCharacters >= Array.from(request.text).length ? "ready" : "allowance",
      );
    }
    if (
      process.platform !== "linux" ||
      process.arch !== "x64" ||
      !pack?.qualified ||
      !pack.runtime ||
      !(await this.packs.installed(pack))
    )
      return result("model");
    return result("ready");
  }
  async synthesize(
    request: SpeechRequest,
    managed: (
      request: SpeechRequest,
      signal: AbortSignal,
      save: (clips: Buffer[]) => Promise<void>,
    ) => Promise<Buffer[]>,
    onChunk: (audio: Buffer) => void = () => undefined,
  ): Promise<SpeechResult> {
    if (!this.privateCache) throw new Error("OD_SPEECH_ROOT_UNAVAILABLE");
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const signal = controller.signal;
    const epoch = this.#epoch;
    const privateCache = this.privateCache;
    const valid = () => {
      signal.throwIfAborted();
      if (epoch !== this.#epoch) throw new Error("OD_SPEECH_ROOT_STALE");
    };
    try {
      await this.#load;
      valid();
      const prepared = this.manifest?.clips.find(
        (c) => c.language === request.language && c.textDigest === hash(request.text),
      );
      if (prepared) {
        const audio = await this.curriculumClip(prepared, signal);
        valid();
        await trimCaches([this.publicCache, privateCache]);
        return { clips: [audio.toString("base64")], mime: "audio/ogg", source: "curriculum" };
      }
      const { source, pack, key } = this.identity(request);
      // Chunk indexes permit long cloud actions without concatenating separate Ogg streams.
      const cached: Buffer[] = [];
      for (let i = 0; i < 12; i++) {
        const audio = await privateCache.get(hash(`${key}:${String(i)}`));
        if (!audio) break;
        cached.push(audio);
      }
      const completeFile = path.join(privateCache.root, `${key}.complete`);
      const complete = (await exists(completeFile))
        ? Number((await read(completeFile, 16)).toString())
        : 0;
      if (complete > 0 && complete <= 12 && cached.length === complete) {
        valid();
        return {
          clips: cached.map((a) => a.toString("base64")),
          mime: "audio/ogg",
          source: "cache",
        };
      }
      const save = async (clips: Buffer[]) => {
        valid();
        for (const [i, audio] of clips.entries()) {
          valid();
          await privateCache.put(hash(`${key}:${String(i)}`), audio);
        }
        valid();
        await atomic(path.join(privateCache.root, `${key}.complete`), String(clips.length));
      };
      let clips: Buffer[];
      if (source === "managed") clips = await managed(request, signal, save);
      else {
        if (!pack) throw new Error("OD_SPEECH_PACK_UNAVAILABLE");
        clips = [
          await this.worker.synthesize(this.packs, pack, request.text, signal, (audio) => {
            valid();
            onChunk(audio);
          }),
        ];
        await save(clips);
      }
      valid();
      await trimCaches([this.publicCache, privateCache]);
      return { clips: clips.map((a) => a.toString("base64")), mime: "audio/ogg", source };
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
  }
}
