import { constants } from "node:fs";
import { rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { type Artifact } from "./candidate.js";
import {
  assertNotAborted,
  atomic,
  exists,
  fail,
  hashFile,
  readSmall,
  regular,
  removeFile,
  writeNew,
} from "./files.js";

const checkpointSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.int().nonnegative(),
  prefix: z.string().regex(/^[a-f0-9]{64}$/u),
});
const chunkBytes = 8 * 1024 ** 2;
function allowed(url: URL) {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === "443") &&
    [
      "github.com",
      "release-assets.githubusercontent.com",
      "huggingface.co",
      "cas-bridge.xethub.hf.co",
      "cdn-lfs.hf.co",
      "cdn-lfs-us-1.hf.co",
      "us.aws.cdn.hf.co",
    ].includes(url.hostname)
  );
}
async function getRange(
  artifact: Artifact,
  offset: number,
  end: number,
  signal: AbortSignal,
): Promise<Buffer> {
  let url = new URL(artifact.url);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!allowed(url)) fail("DOWNLOAD_ORIGIN_INVALID");
    const response = await fetch(url, {
      redirect: "manual",
      signal: bounded,
      headers: { Range: `bytes=${String(offset)}-${String(end)}`, "Accept-Encoding": "identity" },
      credentials: "omit",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) fail("DOWNLOAD_RESPONSE_INVALID");
      url = new URL(location, url);
      continue;
    }
    if (
      response.status !== 206 ||
      response.headers.get("content-range") !==
        `bytes ${String(offset)}-${String(end)}/${String(artifact.bytes)}` ||
      (response.headers.get("content-encoding") &&
        response.headers.get("content-encoding") !== "identity")
    ) {
      await response.body?.cancel();
      fail("DOWNLOAD_RANGE_INVALID");
    }
    if (!response.body) fail("DOWNLOAD_RESPONSE_INVALID");
    const downloaded = Buffer.alloc(end - offset + 1);
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const value: unknown = next.value;
        if (!(value instanceof Uint8Array)) fail("DOWNLOAD_RESPONSE_INVALID");
        bytes += value.byteLength;
        if (bytes > end - offset + 1) fail("DOWNLOAD_SIZE_INVALID");
        downloaded.set(value, bytes - value.byteLength);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (bytes !== end - offset + 1) fail("DOWNLOAD_SIZE_INVALID");
    return downloaded;
  }
  fail("DOWNLOAD_REDIRECT_LIMIT");
}
// Caller holds the installation lock throughout preparation and download. Only
// verified final files or committed, rehashed prefixes count toward disk credit.
export async function prepareDownload(root: string, artifact: Artifact, signal: AbortSignal) {
  const final = path.join(root, artifact.file);
  if (await exists(final)) {
    const verified = await hashFile(final, artifact.bytes, signal);
    if (verified.bytes !== artifact.bytes || verified.hash.copy().digest("hex") !== artifact.sha256)
      fail("INTEGRITY_INVALID");
    return { ...verified, complete: true };
  }
  const part = `${final}.part`;
  const state = `${final}.resume`;
  const hash = createHash("sha256");
  if (!(await exists(part))) {
    if (await exists(state)) fail("RESUME_INVALID");
    return { bytes: 0, hash, complete: false };
  }
  const file = await regular(part, constants.O_RDWR);
  try {
    const size = (await file.stat()).size;
    if (!(await exists(state))) {
      // The only recoverable part-before-checkpoint window is an empty file.
      if (size !== 0) fail("RESUME_INVALID");
      await atomic(state, { sha256: artifact.sha256, bytes: 0, prefix: hash.copy().digest("hex") });
      return { bytes: 0, hash, complete: false };
    }
    const record = checkpointSchema.parse(JSON.parse((await readSmall(state)).toString()));
    if (
      record.sha256 !== artifact.sha256 ||
      record.bytes > artifact.bytes ||
      size < record.bytes ||
      size > artifact.bytes
    )
      fail("RESUME_INVALID");
    const buffer = Buffer.alloc(1024 ** 2);
    let bytes = 0;
    while (bytes < record.bytes) {
      assertNotAborted(signal);
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, record.bytes - bytes),
        bytes,
      );
      if (!bytesRead) fail("RESUME_INVALID");
      hash.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
    if (
      record.prefix !== hash.copy().digest("hex") ||
      (record.bytes === artifact.bytes && record.prefix !== artifact.sha256) ||
      (await file.stat()).size !== size
    )
      fail("RESUME_INVALID");
    // An append may have reached disk before its checkpoint rename. Validate
    // the committed prefix first; never repair or credit a corrupt prefix.
    assertNotAborted(signal);
    if (size > bytes) {
      await file.truncate(bytes);
      await file.sync();
    }
    return { bytes, hash, complete: false };
  } finally {
    await file.close();
  }
}
export async function download(
  root: string,
  artifact: Artifact,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  prepared: Awaited<ReturnType<typeof prepareDownload>>,
) {
  const final = path.join(root, artifact.file);
  const part = `${final}.part`;
  const state = `${final}.resume`;
  let { bytes } = prepared;
  const { hash } = prepared;
  progress(bytes);
  if (prepared.complete) return;
  if (!(await exists(part))) {
    await writeNew(part, "");
    await atomic(state, { sha256: artifact.sha256, bytes, prefix: hash.copy().digest("hex") });
  }
  const file = await regular(part, constants.O_WRONLY);
  try {
    if ((await file.stat()).size !== bytes) fail("RESUME_INVALID");
    while (bytes < artifact.bytes) {
      assertNotAborted(signal);
      const chunk = await getRange(
        artifact,
        bytes,
        Math.min(bytes + chunkBytes, artifact.bytes) - 1,
        signal,
      );
      assertNotAborted(signal);
      let written = 0;
      while (written < chunk.length) {
        const result = await file.write(chunk, written, chunk.length - written, bytes + written);
        if (!result.bytesWritten) fail("DOWNLOAD_WRITE_FAILED");
        written += result.bytesWritten;
      }
      bytes += chunk.length;
      hash.update(chunk);
      await file.sync();
      await atomic(state, { sha256: artifact.sha256, bytes, prefix: hash.copy().digest("hex") });
      progress(bytes);
    }
    if (hash.digest("hex") !== artifact.sha256) fail("INTEGRITY_INVALID");
  } finally {
    await file.close();
  }
  assertNotAborted(signal);
  await rename(part, final);
  await removeFile(state);
}
