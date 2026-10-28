import { fromByteArray, toByteArray } from "base64-js";
import {
  mobileChunkBytes,
  mobileSnapshotBytes,
  mobileSnapshotSchema,
  mobilePublishedSchema,
  mobileManifestSchema,
  type MobileSnapshot,
  type MobilePublished,
} from "@call-nina/contracts";
export type Hash = (bytes: Uint8Array) => Promise<string>;
export class SyncError extends Error {
  constructor(
    readonly reason: "sign-in" | "unavailable" | "too-large" | "changed" | "update-required",
  ) {
    super(reason);
  }
}
export type SyncConnection = {
  origin: string;
  token: () => Promise<string>;
  assertCurrent: () => void | Promise<void>;
  hash: Hash;
  signal?: AbortSignal;
};
async function request(connection: SyncConnection, query: string, body?: unknown) {
  await connection.assertCurrent();
  const token = await connection.token();
  await connection.assertCurrent();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (connection.signal?.aborted) throw new SyncError("changed");
  connection.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 30_000);
  try {
    const response = await fetch(`${connection.origin}/api/mobile-sync${query}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      credentials: "omit",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    await connection.assertCurrent();
    if (response.status === 401) throw new SyncError("sign-in");
    if (response.status === 409 || response.status === 410) throw new SyncError("changed");
    if (response.status === 413) throw new SyncError("too-large");
    if (!response.ok) throw new SyncError("unavailable");
    const limit = 1_500_000;
    if (Number(response.headers.get("content-length")) > limit) throw new SyncError("too-large");
    // React Native fetch may not expose a ReadableStream; every server response is bounded.
    const text = await response.text();
    if (new TextEncoder().encode(text).length > limit) throw new SyncError("too-large");
    await connection.assertCurrent();
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
    connection.signal?.removeEventListener("abort", abort);
  }
}
export async function publishSnapshot(
  connection: SyncConnection,
  value: MobileSnapshot,
  id: string,
): Promise<MobilePublished> {
  const bytes = new TextEncoder().encode(JSON.stringify(mobileSnapshotSchema.parse(value)));
  if (bytes.length > mobileSnapshotBytes) throw new SyncError("too-large");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += mobileChunkBytes)
    chunks.push(bytes.slice(offset, offset + mobileChunkBytes));
  const manifest = mobileManifestSchema.parse({
    id,
    byteLength: bytes.length,
    sha256: await connection.hash(bytes),
    chunkHashes: await Promise.all(chunks.map(connection.hash)),
  });
  await request(connection, "", { action: "begin", manifest });
  for (const [index, chunk] of chunks.entries())
    await request(connection, "", { action: "chunk", id, index, data: fromByteArray(chunk) });
  return mobilePublishedSchema.parse(await request(connection, "", { action: "commit", id }));
}
export async function readPublished(connection: SyncConnection): Promise<MobilePublished | null> {
  const value = await request(connection, "");
  return value === null ? null : mobilePublishedSchema.parse(value);
}
export async function downloadSnapshot(
  connection: SyncConnection,
  published: MobilePublished,
): Promise<MobileSnapshot> {
  const { manifest } = published;
  const bytes = new Uint8Array(manifest.byteLength);
  for (const [index, expected] of manifest.chunkHashes.entries()) {
    const raw = await request(connection, `?id=${manifest.id}&index=${index}`);
    if (typeof raw !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(raw))
      throw new SyncError("unavailable");
    const chunk = toByteArray(raw);
    if (
      chunk.length !== Math.min(mobileChunkBytes, bytes.length - index * mobileChunkBytes) ||
      (await connection.hash(chunk)) !== expected
    )
      throw new SyncError("unavailable");
    bytes.set(chunk, index * mobileChunkBytes);
  }
  if ((await connection.hash(bytes)) !== manifest.sha256) throw new SyncError("unavailable");
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion !== 1
  )
    throw new SyncError("update-required");
  return mobileSnapshotSchema.parse(value);
}
