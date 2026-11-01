import {
  uploadImageInputSchema,
  type UploadImageInput,
  type UploadImageMetadata,
} from "@call-nina/contracts";
import type { CallNinaDatabase } from "@call-nina/persistence";
import { nativeImage } from "electron";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";

function file(root: string, sha256: string) {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error("OD_VOCABULARY_IMAGE_INVALID");
  return path.join(root, "attachments", "uploads", sha256);
}
export function validateUploadImage(value: UploadImageInput) {
  const image = uploadImageInputSchema.parse(value),
    bytes = Buffer.from(image.data, "base64");
  const signature =
    image.mediaType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : image.mediaType === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const decoded = nativeImage.createFromBuffer(bytes),
    size = decoded.getSize();
  if (
    !signature ||
    bytes.length > 10 * 1024 * 1024 ||
    bytes.toString("base64") !== image.data ||
    decoded.isEmpty() ||
    size.width * size.height > 20_000_000
  )
    throw new Error("OD_VOCABULARY_IMAGE_INVALID");
  const metadata: UploadImageMetadata = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: image.mediaType,
    byteSize: bytes.length,
  };
  return { image, bytes, metadata };
}
async function assertManagedDirectory(root: string) {
  const directory = path.join(root, "attachments", "uploads");
  const [canonicalRoot, canonicalDirectory, stat] = await Promise.all([
    realpath(root),
    realpath(directory),
    lstat(directory),
  ]);
  if (
    stat.isSymbolicLink() ||
    path.relative(canonicalRoot, canonicalDirectory) !== path.join("attachments", "uploads")
  )
    throw new Error("OD_VOCABULARY_IMAGE_INVALID");
}
export async function storeUploadImage(root: string, value: UploadImageInput) {
  const { bytes, metadata } = validateUploadImage(value);
  const destination = file(root, metadata.sha256),
    directory = path.dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertManagedDirectory(root);
  let created = false;
  try {
    const handle = await open(destination, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      if (created) await unlink(destination).catch(() => {});
      throw error;
    }
    await readUploadImage(root, metadata);
  }
  return {
    metadata,
    created,
    discard: async () => {
      if (created) await unlink(destination);
    },
  };
}
export async function readUploadImage(
  root: string,
  metadata: UploadImageMetadata,
): Promise<UploadImageInput> {
  try {
    await assertManagedDirectory(root);
    const destination = file(root, metadata.sha256),
      stat = await lstat(destination);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== metadata.byteSize ||
      stat.size > 10 * 1024 * 1024
    )
      throw new Error("OD_VOCABULARY_IMAGE_INVALID");
    const bytes = await readFile(destination);
    if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256)
      throw new Error("OD_VOCABULARY_IMAGE_INVALID");
    return { mediaType: metadata.mediaType, data: bytes.toString("base64") };
  } catch (error) {
    if (error instanceof Error && error.message === "OD_VOCABULARY_IMAGE_INVALID") throw error;
    throw new Error("OD_UPLOAD_IMAGE_UNAVAILABLE");
  }
}

export async function cleanupUploadImages(database: CallNinaDatabase) {
  const { pendingUploadImageCleanup, finishUploadImageCleanup, assertCallNinaDatabaseLease } =
    await import("@call-nina/persistence");
  let failed = false;
  for (const sha256 of await pendingUploadImageCleanup(database)) {
    try {
      await assertCallNinaDatabaseLease(database);
      await assertManagedDirectory(database.dataRoot).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
      await unlink(file(database.dataRoot, sha256)).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
      await finishUploadImageCleanup(database, sha256);
    } catch {
      failed = true;
    }
  }
  return !failed;
}
