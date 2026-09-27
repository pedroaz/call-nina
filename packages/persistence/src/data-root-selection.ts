import { pathPermissions, syncDirectory } from "@call-nina/platform";
import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import type { DataRootGeneration } from "@call-nina/contracts";

import {
  dataRootDirectories,
  dataRootManifestSchema,
  resolveDataRootLayout,
  type DataRootManifest,
} from "./data-root-layout.js";

const dedicatedDirectoryName = "call-nina-data";
const maximumManifestBytes = 16 * 1024;
const mintedPlans = new WeakSet<object>();

export const dataRootSelectionWarnings = [
  "broad-permissions",
  "git-worktree",
  "install-directory",
] as const;
export type DataRootSelectionWarning = (typeof dataRootSelectionWarnings)[number];
export type DataRootSelectionAction =
  "open-existing-root" | "initialize-empty-directory" | "create-dedicated-subdirectory";
export type DataRootSelectionPlan = Readonly<{
  choicePath: string;
  dataRoot: string;
  action: DataRootSelectionAction;
  warnings: readonly DataRootSelectionWarning[];
}>;

async function assertNoSymlinkTraversal(candidate: string): Promise<void> {
  if (!path.isAbsolute(candidate) || candidate.includes("\0")) {
    throw new Error("OD_DATA_ROOT_PATH_INVALID");
  }
  const normalized = path.normalize(candidate);
  if (normalized === path.parse(normalized).root) throw new Error("OD_DATA_ROOT_PATH_TOO_BROAD");
  const parsed = path.parse(normalized);
  let cursor = parsed.root;
  for (const segment of normalized.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) throw new Error("OD_DATA_ROOT_SYMLINK_UNSAFE");
      if (cursor !== normalized && !metadata.isDirectory()) {
        throw new Error("OD_DATA_ROOT_TRAVERSAL_INVALID");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertOwnedDirectory(
  directory: string,
  options: { allowGroupOrWorldWritable?: boolean } = {},
): Promise<void> {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("OD_DATA_ROOT_NOT_DIRECTORY");
  }
  if (!(await pathPermissions(directory)).owned) throw new Error("OD_DATA_ROOT_NOT_OWNED");
  if (!options.allowGroupOrWorldWritable && (await pathPermissions(directory)).writableByOthers) {
    throw new Error("OD_DATA_ROOT_PERMISSIONS_UNSAFE");
  }
}

async function assertWritable(directory: string): Promise<void> {
  await access(directory, constants.W_OK);
  const probe = path.join(directory, `.call-nina-write-probe-${randomUUID()}`);
  const file = await open(probe, "wx", 0o600);
  try {
    await file.sync();
  } finally {
    await file.close();
    await unlink(probe);
  }
}

async function readExistingManifest(dataRoot: string): Promise<DataRootManifest | null> {
  const manifestPath = resolveDataRootLayout(dataRoot).manifest;
  let metadata;
  try {
    metadata = await lstat(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size > maximumManifestBytes ||
    !(await pathPermissions(manifestPath)).owned
  ) {
    throw new Error("OD_DATA_ROOT_MANIFEST_INVALID");
  }
  try {
    return dataRootManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch {
    throw new Error("OD_DATA_ROOT_MANIFEST_INVALID");
  }
}

async function directoryIsEmpty(directory: string): Promise<boolean> {
  return (await readdir(directory)).length === 0;
}

function pathContainedBy(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isInsideGitWorktree(candidate: string): Promise<boolean> {
  let cursor = candidate;
  while (cursor !== path.parse(cursor).root) {
    try {
      const marker = await lstat(path.join(cursor, ".git"));
      if (marker.isDirectory() || marker.isFile()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    cursor = path.dirname(cursor);
  }
  return false;
}

async function canonicalKnownRoots(roots: readonly string[]): Promise<string[]> {
  const result: string[] = [];
  for (const root of roots) {
    if (!path.isAbsolute(root)) throw new Error("OD_INSTALL_ROOT_INVALID");
    result.push(await realpath(root));
  }
  return result;
}

async function hasBroadPermissions(candidate: string): Promise<boolean> {
  return (await pathPermissions(candidate)).broad;
}

async function hasGroupOrWorldWritePermissions(candidate: string): Promise<boolean> {
  return (await pathPermissions(candidate)).writableByOthers;
}

async function inspectSelection(
  choice: string,
  options: { knownInstallRoots?: readonly string[] },
): Promise<DataRootSelectionPlan> {
  await assertNoSymlinkTraversal(choice);
  const canonicalChoice = await realpath(path.normalize(choice));
  if (canonicalChoice !== path.normalize(choice))
    throw new Error("OD_DATA_ROOT_PATH_NON_CANONICAL");
  await assertOwnedDirectory(canonicalChoice, { allowGroupOrWorldWritable: true });
  await assertWritable(canonicalChoice);

  const warnings = new Set<DataRootSelectionWarning>();
  const choiceHasBroadPermissions = await hasBroadPermissions(canonicalChoice);
  const choiceHasGroupOrWorldWritePermissions =
    await hasGroupOrWorldWritePermissions(canonicalChoice);
  if (choiceHasBroadPermissions) warnings.add("broad-permissions");
  if (await isInsideGitWorktree(canonicalChoice)) warnings.add("git-worktree");
  const installRoots = await canonicalKnownRoots(options.knownInstallRoots ?? []);
  if (installRoots.some((root) => pathContainedBy(root, canonicalChoice))) {
    warnings.add("install-directory");
  }

  let action: DataRootSelectionAction;
  let dataRoot: string;
  if ((await readExistingManifest(canonicalChoice)) !== null) {
    await assertOwnedDirectory(canonicalChoice);
    action = "open-existing-root";
    dataRoot = canonicalChoice;
  } else if ((await directoryIsEmpty(canonicalChoice)) && !choiceHasGroupOrWorldWritePermissions) {
    action = "initialize-empty-directory";
    dataRoot = canonicalChoice;
  } else {
    dataRoot = path.join(canonicalChoice, dedicatedDirectoryName);
    await assertNoSymlinkTraversal(dataRoot);
    try {
      await assertOwnedDirectory(dataRoot);
      await assertWritable(dataRoot);
      if ((await readExistingManifest(dataRoot)) !== null) {
        action = "open-existing-root";
      } else if (await directoryIsEmpty(dataRoot)) {
        action = "initialize-empty-directory";
      } else {
        throw new Error("OD_DATA_ROOT_SUBDIRECTORY_CONFLICT");
      }
      if (await hasBroadPermissions(dataRoot)) warnings.add("broad-permissions");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      action = "create-dedicated-subdirectory";
    }
  }

  return Object.freeze({
    choicePath: canonicalChoice,
    dataRoot,
    action,
    warnings: Object.freeze([...warnings].sort()),
  });
}

export async function inspectDataRootChoice(
  choice: string,
  options: { knownInstallRoots?: readonly string[] } = {},
): Promise<DataRootSelectionPlan> {
  const plan = await inspectSelection(choice, options);
  mintedPlans.add(plan);
  return plan;
}

async function assertExistingLayoutSafe(dataRoot: string, warnings: Set<DataRootSelectionWarning>) {
  const layout = resolveDataRootLayout(dataRoot);
  const directoryCandidates = [
    layout.attachments,
    layout.logs,
    path.dirname(layout.diagnostics),
    layout.diagnostics,
    layout.testData,
  ];
  const fileCandidates = [layout.database, layout.manifest];
  for (const candidate of [...directoryCandidates, ...fileCandidates]) {
    await assertNoSymlinkTraversal(candidate);
    try {
      const metadata = await lstat(candidate);
      const expectsDirectory = directoryCandidates.includes(candidate);
      if (
        metadata.isSymbolicLink() ||
        !(await pathPermissions(candidate)).owned ||
        (expectsDirectory ? !metadata.isDirectory() : !metadata.isFile())
      ) {
        throw new Error("OD_DATA_ROOT_CONTENT_UNSAFE");
      }
      if ((await pathPermissions(candidate)).broad) warnings.add("broad-permissions");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function writeManifestAtomically(dataRoot: string, manifest: DataRootManifest) {
  const layout = resolveDataRootLayout(dataRoot);
  const temporary = `${layout.manifest}.${String(process.pid)}.${randomUUID()}.next`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, layout.manifest);
    await syncDirectory(dataRoot);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

export async function materializeDataRootSelection(
  plan: DataRootSelectionPlan,
  options: {
    generation: DataRootGeneration;
    createdAt: string;
    knownInstallRoots?: readonly string[];
  },
) {
  if (!mintedPlans.has(plan)) throw new Error("OD_DATA_ROOT_SELECTION_PLAN_INVALID");
  mintedPlans.delete(plan);
  const current = await inspectSelection(
    plan.choicePath,
    options.knownInstallRoots === undefined ? {} : { knownInstallRoots: options.knownInstallRoots },
  );
  if (current.action !== plan.action || current.dataRoot !== plan.dataRoot) {
    throw new Error("OD_DATA_ROOT_SELECTION_CHANGED");
  }

  if (plan.action === "create-dedicated-subdirectory") {
    await mkdir(plan.dataRoot, { mode: 0o700 });
  }
  await assertNoSymlinkTraversal(plan.dataRoot);
  await assertOwnedDirectory(plan.dataRoot);
  await assertWritable(plan.dataRoot);

  const warnings = new Set(plan.warnings);
  await assertExistingLayoutSafe(plan.dataRoot, warnings);
  const existingManifest = await readExistingManifest(plan.dataRoot);
  const layout = resolveDataRootLayout(plan.dataRoot);
  for (const directory of dataRootDirectories(layout)) {
    await assertNoSymlinkTraversal(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertNoSymlinkTraversal(directory);
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || !(await pathPermissions(directory)).owned) {
      throw new Error("OD_DATA_ROOT_CONTENT_UNSAFE");
    }
    if ((await pathPermissions(directory)).broad) warnings.add("broad-permissions");
  }

  const manifest = dataRootManifestSchema.parse({
    schemaVersion: 1,
    kind: "open-deutsch-data-root",
    dataRootFormatVersion: 1,
    generation: options.generation,
    createdAt: existingManifest?.createdAt ?? options.createdAt,
  });
  await writeManifestAtomically(plan.dataRoot, manifest);
  return Object.freeze({
    dataRoot: plan.dataRoot,
    action: plan.action,
    warnings: Object.freeze([...warnings].sort()),
    manifest,
  });
}
