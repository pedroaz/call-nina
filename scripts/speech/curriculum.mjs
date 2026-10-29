import { put, head } from "@vercel/blob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { speechManifestSchema } from "../../packages/contracts/dist/index.js";
import {
  waveNet,
  waveNetVoices,
  speechSegments,
} from "../../packages/managed-generation/dist/speech.js";
const sha = (data) => createHash("sha256").update(data).digest("hex");
const root = path.resolve("content/curriculum");
const [operation = "extract", destination = "build/speech"] = process.argv.slice(2);
if (!["extract", "generate", "publish"].includes(operation))
  throw Error("Use extract, generate, or publish");
const out = path.resolve(destination);
await mkdir(out, { recursive: true });
const raw = await readFile(path.join(root, "catalog.json"));
const catalog = JSON.parse(raw);
const files = [...new Set(catalog.languages.flatMap((l) => l.files))].sort();
const contents = await Promise.all(files.map((f) => readFile(path.join(root, f))));
const curriculumDigest = sha(Buffer.concat([raw, ...contents]));
const clips = new Map();
function add(language, text, course, reference) {
  if (!text?.trim()) return;
  if (/^(?:A|B|Speaker \d+|Gast|Kellner|Waiter|Customer):/mu.test(text))
    throw Error(`Explicit speech segments required: ${reference}`);
  const textDigest = sha(text);
  const voice = waveNetVoices[language];
  const id = sha(JSON.stringify([language, textDigest, voice, "wavenet-opus48-v1"]));
  const clip = clips.get(id) ?? {
    id,
    language,
    text,
    textDigest,
    voice,
    synthesisVersion: "wavenet-opus48-v1",
    courses: [],
    references: [],
  };
  if (!clip.courses.includes(course)) clip.courses.push(course);
  if (!clip.references.includes(reference)) clip.references.push(reference);
  clips.set(id, clip);
}
for (let i = 0; i < files.length; i++) {
  const data = JSON.parse(contents[i]);
  for (const unit of data.units) {
    const course = `${data.targetLanguage}:${unit.stage}`;
    for (const id of unit.targetIds ?? []) {
      const target = data.targets.find((t) => t.id === id);
      if (!target) throw Error("Missing target");
      add(data.targetLanguage, target.text, course, `${files[i]}#target/${id}/text`);
      add(data.targetLanguage, target.example, course, `${files[i]}#target/${id}/example`);
    }
    for (const [j, example] of (unit.examples ?? []).entries())
      add(data.targetLanguage, example.text, course, `${files[i]}#unit/${unit.id}/example/${j}`);
    for (const activity of unit.activities ?? [])
      add(
        data.targetLanguage,
        activity.speechSegments?.map((s) => s.text).join("\n") ?? activity.input,
        course,
        `${files[i]}#unit/${unit.id}/activity/${activity.id}`,
      );
  }
}
const extracted = {
  schemaVersion: 1,
  curriculumDigest,
  clips: [...clips.values()].sort((a, b) => a.id.localeCompare(b.id)),
};
let previous = { clips: [] };
try {
  previous = speechManifestSchema.parse(
    JSON.parse(await readFile(path.join(root, "audio-manifest.json"), "utf8")),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const changed = extracted.clips.filter((c) => !previous.clips.some((p) => p.id === c.id));
const characters = changed.reduce((n, c) => n + [...c.text].length, 0);
await writeFile(path.join(out, "extraction.json"), JSON.stringify(extracted, null, 2) + "\n");
await writeFile(
  path.join(out, "review.json"),
  JSON.stringify(
    {
      curriculumDigest,
      clips: clips.size,
      unchanged: clips.size - changed.length,
      newClips: changed.length,
      characters,
      estimatedSynthesisUsd: (characters * 4) / 1e6,
      removed: previous.clips.filter((c) => !clips.has(c.id)).map((c) => c.id),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    clips: clips.size,
    newClips: changed.length,
    characters,
    estimatedSynthesisUsd: (characters * 4) / 1e6,
  }),
);
if (operation === "extract") process.exit(0);
if (process.env.NINA_SPEECH_APPROVED_DIGEST !== curriculumDigest)
  throw Error("Review extraction and supply NINA_SPEECH_APPROVED_DIGEST");
if (operation === "generate") {
  const key = process.env.NINA_SPEECH_GOOGLE_CREDENTIALS;
  if (!key) throw Error("Google credential missing");
  const generated = [];
  let prior = { clips: [] };
  try {
    prior = JSON.parse(await readFile(path.join(out, "generated.json"), "utf8"));
    if (prior.curriculumDigest !== curriculumDigest) throw Error("Stale generated assets");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const clip of changed) {
    const existing = prior.clips.find((c) => c.id === clip.id);
    if (existing) {
      const audio = await readFile(path.join(out, `${clip.id}.ogg`));
      if (sha(audio) !== existing.sha256 || audio.length !== existing.bytes)
        throw Error("Generated asset integrity mismatch");
      generated.push(existing);
      continue;
    }
    // No provider retries. Each paid call is explicitly initiated by this command.
    const inputs = [];
    for (const [i, text] of speechSegments(clip.text).entries()) {
      const file = path.join(out, `${clip.id}.${i}.source.ogg`);
      await writeFile(file, await waveNet(text, clip.language, key, AbortSignal.timeout(120000)));
      inputs.push(file);
    }
    const file = path.join(out, `${clip.id}.ogg`);
    const args = inputs.flatMap((f) => ["-i", f]);
    if (inputs.length > 1)
      args.push(
        "-filter_complex",
        `${inputs.map((_, i) => `[${i}:a]`).join("")}concat=n=${inputs.length}:v=0:a=1[out]`,
        "-map",
        "[out]",
      );
    const result = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        ...args,
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        file,
      ],
      { stdio: "pipe" },
    );
    if (result.status !== 0) throw Error("Audio normalization failed");
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
      { encoding: "utf8" },
    );
    const durationMs = Math.ceil(Number(JSON.parse(probe.stdout).format.duration) * 1000);
    const audio = await readFile(file);
    generated.push({ ...clip, sha256: sha(audio), bytes: audio.length, durationMs });
    await writeFile(
      path.join(out, "generated.json"),
      JSON.stringify({ curriculumDigest, clips: generated }, null, 2) + "\n",
    );
  }
  process.exit(0);
}
const generated = JSON.parse(await readFile(path.join(out, "generated.json"), "utf8"));
if (generated.curriculumDigest !== curriculumDigest) throw Error("Generated audio is stale");
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw Error("Blob credential missing");
async function publish(name, data, type) {
  try {
    return (
      await put(name, data, {
        access: "public",
        token,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: type,
        cacheControlMaxAge: 31536000,
      })
    ).url;
  } catch (error) {
    // Retry after a lost upload response only reuses identical public bytes.
    const existing = await head(name, { token });
    if (!/^https:\/\/[a-zA-Z0-9-]+\.public\.blob\.vercel-storage\.com\//u.test(existing.url))
      throw error;
    const response = await fetch(existing.url, { redirect: "error", credentials: "omit" });
    if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== sha(data)) throw error;
    return existing.url;
  }
}
const published = [];
for (const clip of extracted.clips) {
  const old = previous.clips.find((c) => c.id === clip.id);
  if (old) {
    published.push({ ...old, courses: clip.courses, references: clip.references });
    continue;
  }
  const asset = generated.clips.find((c) => c.id === clip.id);
  if (!asset) throw Error("Missing generated clip");
  const audio = await readFile(path.join(out, `${clip.id}.ogg`));
  if (sha(audio) !== asset.sha256 || audio.length !== asset.bytes)
    throw Error("Audio checksum mismatch");
  const url = await publish(`curriculum/${asset.sha256}.ogg`, audio, "audio/ogg");
  const entry = Object.fromEntries(Object.entries(asset).filter(([key]) => key !== "text"));
  published.push({ ...entry, url });
}
const manifest = speechManifestSchema.parse({
  schemaVersion: 1,
  curriculumDigest,
  clips: published,
});
const data = JSON.stringify(manifest, null, 2) + "\n";
const url = await publish(`curriculum/manifests/${sha(data)}.json`, data, "application/json");
await writeFile(path.join(out, "audio-manifest.json"), data);
console.log(
  JSON.stringify({ manifest: url, bytes: manifest.clips.reduce((n, c) => n + c.bytes, 0) }),
);
