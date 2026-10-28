import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { context, github, output, releaseVersion, digest, summary, progress } from "./common.mjs";
import { desktopTargets, verify } from "./artifacts.mjs";

async function identity() {
  const current = context(true);
  const version = await releaseVersion();
  return {
    ...current,
    version,
    tag: `desktop-v${version}`,
    marker: `<!-- nina-release:${current.commit}:${version}:${current.runId} -->`,
  };
}
async function tagCommit(tag) {
  const ref = await github(`git/ref/tags/${tag}`, { missing: true });
  if (!ref) return null;
  let object = ref.object;
  for (let depth = 0; object.type === "tag" && depth < 5; depth++)
    object = (await github(`git/tags/${object.sha}`)).object;
  if (object.type !== "commit") throw new Error("Release tag does not resolve to a commit");
  return object.sha;
}
export async function inspectRelease({ finalizing = false } = {}) {
  const info = await identity();
  const commit = await tagCommit(info.tag);
  if (commit && commit !== info.commit)
    throw new Error("Release tag already points to another commit");
  const release = await github(`releases/tags/${info.tag}`, { missing: true });
  if (
    release &&
    (!release.body?.includes(info.marker) ||
      release.target_commitish !== info.commit ||
      (!release.draft && !finalizing))
  )
    throw new Error(
      "Release already published or draft metadata differs; inspect it before continuing",
    );
  return { info, release, commit };
}
async function assets(release) {
  const found = [];
  for (let page = 1; ; page++) {
    const batch = await github(`releases/${release.id}/assets?per_page=100&page=${page}`);
    found.push(...batch);
    if (batch.length < 100) return found;
  }
}
async function expectedAssets() {
  const files = [];
  for (const id of desktopTargets) {
    const manifest = await verify(id);
    files.push(manifest.filename, `${id}.json`, `${id}.sha256`);
  }
  return Promise.all(
    files.map(async (name) => ({ name, sha256: await digest(path.join(output, name)) })),
  );
}
async function verifyRemote(asset, expected) {
  // GitHub reports digests for new uploads. Older uploads are streamed and hashed.
  if (asset.digest === `sha256:${expected.sha256}`) return;
  const response = await github(`releases/assets/${asset.id}`, {
    raw: true,
    headers: { Accept: "application/octet-stream" },
  });
  const hash = createHash("sha256");
  for await (const chunk of response.body) hash.update(chunk);
  if (hash.digest("hex") !== expected.sha256)
    throw new Error(`Existing release asset differs: ${expected.name}`);
}
export async function prepare() {
  progress("Verifying desktop artifact checksums");
  const expected = await expectedAssets();
  let { info, release, commit } = await inspectRelease();
  progress(
    `Preparing ${info.tag}; commit=${info.commit}; build=${info.runId}; tag=${commit ? "existing" : "new"}; draft=${release ? "existing" : "new"}`,
  );
  if (!commit)
    await github("git/refs", {
      method: "POST",
      body: { ref: `refs/tags/${info.tag}`, sha: info.commit },
    });
  if (!release) {
    const previous = [];
    for (let page = 1; ; page++) {
      const batch = await github(`releases?per_page=100&page=${page}`);
      previous.push(
        ...batch.filter((item) => !item.draft && item.tag_name.startsWith("desktop-v")),
      );
      if (batch.length < 100) break;
    }
    const notes = await github("releases/generate-notes", {
      method: "POST",
      body: {
        tag_name: info.tag,
        target_commitish: info.commit,
        ...(previous[0] ? { previous_tag_name: previous[0].tag_name } : {}),
      },
    });
    release = await github("releases", {
      method: "POST",
      body: {
        tag_name: info.tag,
        target_commitish: info.commit,
        name: `Call Nina desktop ${info.version}`,
        draft: true,
        body: `${info.marker}\nBuilt from ${info.commit}.\n\nUnsigned desktop builds: Linux x64 AppImage, Windows x64 ZIP, macOS Intel and Apple Silicon app archives. Signing and notarization are not included; platform security prompts may apply. Download the matching archive and its checksum. Native-host verification is tracked separately from successful packaging.\n\n${notes.body}`,
      },
    });
  }
  const existing = await assets(release);
  if (existing.some((asset) => !expected.some((item) => item.name === asset.name)))
    throw new Error("Draft contains unexpected assets");
  for (const item of expected) {
    const asset = existing.find((entry) => entry.name === item.name);
    if (asset) {
      progress(`Verifying existing asset ${item.name}`);
      await verifyRemote(asset, item);
      continue;
    }
    const bytes = await readFile(path.join(output, item.name));
    const url = new URL(release.upload_url.replace(/\{.*$/, ""));
    if (url.origin !== "https://uploads.github.com")
      throw new Error("Unexpected GitHub upload endpoint");
    url.searchParams.set("name", item.name);
    progress(`Uploading asset ${item.name}; bytes=${bytes.length}`);
    const uploaded = await github(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    await verifyRemote(uploaded, item);
    progress(`Verified uploaded asset ${item.name}`);
  }
  await summary(`Desktop draft prepared: ${release.html_url}\nCommit: ${info.commit}`);
}
export async function publish() {
  const { release, info, commit } = await inspectRelease({ finalizing: true });
  if (!release || commit !== info.commit) throw new Error("Prepared desktop release is missing");
  progress("Verifying desktop artifact checksums");
  const expected = await expectedAssets();
  const existing = await assets(release);
  if (existing.length !== expected.length) throw new Error("Release asset set is incomplete");
  for (const item of expected) {
    const asset = existing.find((entry) => entry.name === item.name);
    if (!asset) throw new Error(`Missing release asset: ${item.name}`);
    await verifyRemote(asset, item);
  }
  progress(`Publishing ${info.tag}; release=${release.id}; assets=${existing.length}`);
  if (release.draft)
    await github(`releases/${release.id}`, { method: "PATCH", body: { draft: false } });
  await summary(`Desktop published: ${release.html_url}\nCommit: ${info.commit}`);
}
