import { assertNoLinks, assertOwnedPath, syncDirectory } from "@call-nina/platform";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import {
  dataRootGenerationSchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
} from "@call-nina/contracts";

import {
  dataRootFormatVersion,
  dataRootManifestSchema,
  resolveDataRootLayout,
} from "./data-root-layout.js";

const maximumJsonBytes = 16 * 1024;

export const bootstrapPointerSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  dataRoot: z
    .string()
    .min(2)
    .max(4_096)
    .refine((value) => path.isAbsolute(value) && !value.includes("\0")),
  rootGeneration: dataRootGenerationSchema,
  dataRootFormatVersion: z.literal(dataRootFormatVersion),
  selectedAt: utcInstantSchema,
});

export const bootstrapReadStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unconfigured") }),
  z.strictObject({ status: z.literal("pointer-invalid") }),
  z.strictObject({
    status: z.literal("target-unavailable"),
    reason: z.enum(["missing", "not-directory", "non-canonical", "manifest-invalid"]),
    rootGeneration: dataRootGenerationSchema,
  }),
  z.strictObject({
    status: z.literal("generation-mismatch"),
    rootGeneration: dataRootGenerationSchema,
  }),
  z.strictObject({
    status: z.literal("ready"),
    dataRoot: z
      .string()
      .min(2)
      .max(4_096)
      .refine((value) => path.isAbsolute(value) && !value.includes("\0")),
    rootGeneration: dataRootGenerationSchema,
    dataRootFormatVersion: z.literal(dataRootFormatVersion),
  }),
]);

export type BootstrapPointer = z.infer<typeof bootstrapPointerSchema>;
export type BootstrapReadState = z.infer<typeof bootstrapReadStateSchema>;

async function assertPrivateBootstrapDirectory(bootstrapFile: string, create: boolean) {
  if (!path.isAbsolute(bootstrapFile) || bootstrapFile.includes("\0")) {
    throw new Error("OD_BOOTSTRAP_PATH_INVALID");
  }
  const directory = path.dirname(path.normalize(bootstrapFile));
  if (directory === path.parse(directory).root) throw new Error("OD_BOOTSTRAP_PATH_TOO_BROAD");
  await assertNoLinks(directory);
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const [canonical, metadata] = await Promise.all([realpath(directory), lstat(directory)]);
  await assertNoLinks(directory);
  await assertOwnedPath(directory);
  if (canonical !== directory || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("OD_BOOTSTRAP_DIRECTORY_UNSAFE");
  }
  return directory;
}

async function readBoundedRegularFile(filename: string): Promise<string> {
  const metadata = await lstat(filename);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maximumJsonBytes) {
    throw new Error("OD_BOOTSTRAP_FILE_INVALID");
  }
  return readFile(filename, "utf8");
}

async function readPointerValue(bootstrapFile: string): Promise<BootstrapPointer | null> {
  try {
    await assertPrivateBootstrapDirectory(bootstrapFile, false);
    const parsed: unknown = JSON.parse(await readBoundedRegularFile(bootstrapFile));
    return bootstrapPointerSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readTargetManifest(dataRoot: string) {
  const layout = resolveDataRootLayout(dataRoot);
  const metadata = await lstat(layout.manifest);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > maximumJsonBytes) {
    throw new Error("OD_DATA_ROOT_MANIFEST_INVALID");
  }
  const parsed: unknown = JSON.parse(await readFile(layout.manifest, "utf8"));
  return dataRootManifestSchema.parse(parsed);
}

export async function readBootstrapPointer(bootstrapFile: string): Promise<BootstrapReadState> {
  let pointer: BootstrapPointer | null;
  try {
    pointer = await readPointerValue(bootstrapFile);
  } catch {
    return { status: "pointer-invalid" };
  }
  if (pointer === null) return { status: "unconfigured" };

  let targetMetadata;
  try {
    targetMetadata = await stat(pointer.dataRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        status: "target-unavailable",
        reason: "missing",
        rootGeneration: pointer.rootGeneration,
      };
    }
    return {
      status: "target-unavailable",
      reason: "manifest-invalid",
      rootGeneration: pointer.rootGeneration,
    };
  }
  if (!targetMetadata.isDirectory()) {
    return {
      status: "target-unavailable",
      reason: "not-directory",
      rootGeneration: pointer.rootGeneration,
    };
  }

  let canonicalRoot;
  try {
    canonicalRoot = await realpath(pointer.dataRoot);
  } catch {
    return {
      status: "target-unavailable",
      reason: "missing",
      rootGeneration: pointer.rootGeneration,
    };
  }
  if (canonicalRoot !== path.normalize(pointer.dataRoot)) {
    return {
      status: "target-unavailable",
      reason: "non-canonical",
      rootGeneration: pointer.rootGeneration,
    };
  }

  let manifest;
  try {
    manifest = await readTargetManifest(canonicalRoot);
  } catch {
    return {
      status: "target-unavailable",
      reason: "manifest-invalid",
      rootGeneration: pointer.rootGeneration,
    };
  }
  if (manifest.generation !== pointer.rootGeneration) {
    return { status: "generation-mismatch", rootGeneration: pointer.rootGeneration };
  }
  return {
    status: "ready",
    dataRoot: canonicalRoot,
    rootGeneration: pointer.rootGeneration,
    dataRootFormatVersion: pointer.dataRootFormatVersion,
  };
}

async function validateNextTarget(dataRoot: string, nextGeneration: number): Promise<string> {
  if (!path.isAbsolute(dataRoot) || dataRoot.includes("\0")) {
    throw new Error("OD_DATA_ROOT_PATH_INVALID");
  }
  const canonicalRoot = await realpath(dataRoot);
  if (canonicalRoot !== path.normalize(dataRoot) || !(await stat(canonicalRoot)).isDirectory()) {
    throw new Error("OD_DATA_ROOT_TARGET_INVALID");
  }
  const manifest = await readTargetManifest(canonicalRoot);
  if (manifest.generation !== nextGeneration) throw new Error("OD_DATA_ROOT_GENERATION_INVALID");
  return canonicalRoot;
}

export async function writeBootstrapPointer(options: {
  bootstrapFile: string;
  dataRoot: string;
  expectedGeneration: number | null;
  selectedAt: string;
}): Promise<BootstrapPointer> {
  const directory = await assertPrivateBootstrapDirectory(options.bootstrapFile, true);
  const lockFile = `${options.bootstrapFile}.lock`;
  let lock;
  try {
    lock = await open(lockFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("OD_BOOTSTRAP_WRITE_BUSY");
    }
    throw error;
  }

  const temporaryFile = `${options.bootstrapFile}.${String(process.pid)}.${randomUUID()}.next`;
  try {
    await assertPrivateBootstrapDirectory(options.bootstrapFile, false);
    let current: BootstrapPointer | null;
    try {
      current = await readPointerValue(options.bootstrapFile);
    } catch {
      throw new Error("OD_BOOTSTRAP_POINTER_INVALID");
    }
    const currentGeneration = current?.rootGeneration ?? null;
    if (currentGeneration !== options.expectedGeneration) {
      throw new Error("OD_BOOTSTRAP_GENERATION_CONFLICT");
    }
    const nextGeneration = currentGeneration === null ? 1 : currentGeneration + 1;
    const canonicalRoot = await validateNextTarget(options.dataRoot, nextGeneration);
    const pointer = bootstrapPointerSchema.parse({
      schemaVersion: 1,
      dataRoot: canonicalRoot,
      rootGeneration: nextGeneration,
      dataRootFormatVersion,
      selectedAt: options.selectedAt,
    });
    const file = await open(temporaryFile, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(pointer, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryFile, options.bootstrapFile);
    await syncDirectory(directory);
    return pointer;
  } finally {
    await unlink(temporaryFile).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await lock.close();
    await unlink(lockFile);
  }
}

export async function assertCurrentDataRootLease(options: {
  bootstrapFile: string;
  dataRoot: string;
  rootGeneration: number;
}): Promise<void> {
  const state = await readBootstrapPointer(options.bootstrapFile);
  if (
    state.status !== "ready" ||
    state.dataRoot !== path.normalize(options.dataRoot) ||
    state.rootGeneration !== options.rootGeneration
  ) {
    throw new Error("OD_DATA_ROOT_STALE");
  }
}
