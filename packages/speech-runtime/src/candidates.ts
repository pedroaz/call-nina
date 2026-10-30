import path from "node:path";
import { lstat } from "node:fs/promises";
import { z } from "@call-nina/contracts";
import { hashFile } from "@call-nina/offline-runtime/files";
import { speechPacks, type SpeechPack } from "./catalog.js";
import { read } from "./files.js";

const relative = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (file) =>
      !path.isAbsolute(file) &&
      !file.includes("\\") &&
      !file.includes("\0") &&
      file.split("/").every((part) => part && part !== "." && part !== ".."),
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const file = z.strictObject({
  file: relative,
  bytes: z.int().nonnegative().max(4_000_000_000),
  sha256: digest,
});
const runtimeFile = file.extend({ url: z.literal(""), executable: z.boolean() });
export const speechCandidatesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  platform: z.literal("linux-x64"),
  runtimes: z
    .array(
      z.strictObject({
        engine: z.enum(["piper", "pocket"]),
        sourceDigest: digest,
        archive: file,
        files: z.array(runtimeFile).min(1).max(50000),
      }),
    )
    .min(1)
    .max(2),
  packs: z
    .array(
      z.strictObject({
        id: z.string(),
        artifacts: z
          .array(file.extend({ source: relative }))
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(8),
});
export type SpeechCandidates = {
  packs: SpeechPack[];
  localFiles: ReadonlyMap<string, string>;
};

// Only Electron main / the local preparer use this manifest. It never crosses IPC.
export async function loadSpeechCandidates(
  root: string,
  verifyFiles = false,
): Promise<SpeechCandidates> {
  if (
    !path.isAbsolute(root) ||
    path.resolve(root) !== root ||
    process.platform !== "linux" ||
    process.arch !== "x64"
  )
    throw new Error("OD_SPEECH_CANDIDATES_INVALID");
  const manifest = speechCandidatesSchema.parse(
    JSON.parse((await read(path.join(root, "manifest.json"), 24_000_000)).toString()),
  );
  const localFiles = new Map<string, string>();
  const register = async (spec: z.infer<typeof file>) => {
    let current = root;
    for (const part of spec.file.split("/")) {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("OD_SPEECH_UNSAFE_FILE");
      current = path.join(current, part);
    }
    const info = await lstat(current);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== spec.bytes)
      throw new Error("OD_SPEECH_CANDIDATES_INCOMPLETE");
    if (verifyFiles) {
      const result = await hashFile(current, spec.bytes);
      if (result.bytes !== spec.bytes || result.hash.digest("hex") !== spec.sha256)
        throw new Error("OD_SPEECH_INTEGRITY");
    }
    localFiles.set(spec.sha256, current);
  };
  if (
    new Set(manifest.runtimes.map((r) => r.engine)).size !== manifest.runtimes.length ||
    new Set(manifest.packs.map((p) => p.id)).size !== manifest.packs.length
  )
    throw new Error("OD_SPEECH_CANDIDATES_INVALID");
  for (const runtime of manifest.runtimes) {
    if (
      new Set(runtime.files.map((f) => f.file)).size !== runtime.files.length ||
      !runtime.files.some((f) => f.file === "bin/python3" && f.executable) ||
      !runtime.files.some((f) => f.file === "worker.py") ||
      !runtime.files.some((f) => f.file === "dependency-inventory.json")
    )
      throw new Error("OD_SPEECH_CANDIDATES_INVALID");
    await register(runtime.archive);
  }
  const packs: SpeechPack[] = [];
  for (const entry of manifest.packs) {
    const pinned = speechPacks.find((p) => p.id === entry.id);
    const runtime = manifest.runtimes.find((r) => r.engine === pinned?.engine);
    if (!pinned || !runtime || entry.artifacts.length !== pinned.artifacts.length)
      throw new Error("OD_SPEECH_CANDIDATES_INVALID");
    for (const artifact of pinned.artifacts) {
      const staged = entry.artifacts.find((a) => a.file === artifact.file);
      if (!staged || staged.bytes !== artifact.bytes || staged.sha256 !== artifact.sha256)
        throw new Error("OD_SPEECH_CANDIDATES_INVALID");
      await register({ ...staged, file: staged.source });
    }
    packs.push({
      ...pinned,
      candidate: true,
      runtime: {
        url: "",
        bytes: runtime.archive.bytes,
        sha256: runtime.archive.sha256,
        files: runtime.files,
      },
    });
  }
  return { packs, localFiles };
}
