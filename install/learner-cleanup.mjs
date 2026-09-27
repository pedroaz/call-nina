import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { assertNoLinks, assertOwnedPath } from "../packages/platform/src/index.ts";
import { exists, inside } from "./platform.mjs";

export async function inspectCleanup(bootstrapFile) {
  const { readBootstrapPointer, callNinaMigrations, dataRootManifestSchema } =
    await import("../packages/persistence/dist/index.js");
  await assertNoLinks(bootstrapFile);
  const state = await readBootstrapPointer(bootstrapFile);
  if (state.status !== "ready")
    throw new Error("DATA_ROOT_NOT_READY: no learner files were removed.");
  const root = state.dataRoot;
  await assertNoLinks(root);
  await assertOwnedPath(root);
  const manifestPath = path.join(root, ".open-deutsch-root.json");
  const manifest = dataRootManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.generation !== state.rootGeneration) throw new Error("DATA_ROOT_CHANGED");
  const databaseFile = path.join(root, "open-deutsch.sqlite3");
  await assertNoLinks(databaseFile);
  await assertOwnedPath(databaseFile);
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  let attachments;
  try {
    const version = database.prepare("PRAGMA user_version").get().user_version;
    if (version !== callNinaMigrations.length)
      throw new Error(
        "DATA_SCHEMA_UNRECOGNIZED: open the app with a compatible version before cleanup.",
      );
    if (database.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("DATA_DATABASE_DAMAGED");
    database.prepare("SELECT learner_id, onboarding_state FROM learner_profiles LIMIT 1").all();
    attachments = database.prepare("SELECT relative_path, sha256 FROM attachment_metadata").all();
  } finally {
    database.close();
  }
  const files = [];
  for (const attachment of attachments) {
    const filename = path.resolve(root, attachment.relative_path);
    if (
      !inside(path.join(root, "attachments"), filename) ||
      filename === path.join(root, "attachments")
    )
      throw new Error("ATTACHMENT_PATH_INVALID");
    if (!(await exists(filename))) continue;
    await assertNoLinks(filename);
    await assertOwnedPath(filename);
    if (
      createHash("sha256")
        .update(await readFile(filename))
        .digest("hex") !== attachment.sha256
    )
      throw new Error("ATTACHMENT_CHANGED: no learner files were removed.");
    files.push(filename);
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const filename = databaseFile + suffix;
    if (await exists(filename)) {
      await assertNoLinks(filename);
      await assertOwnedPath(filename);
      files.push(filename);
    }
  }
  const logs = path.join(root, "logs");
  if (await exists(logs)) {
    await assertNoLinks(logs);
    for (const name of await readdir(logs)) {
      if (!/^(desktop|app-server|mcp-server)\.log(?:\.[0-9]+)?$/.test(name)) continue;
      const filename = path.join(logs, name);
      await assertNoLinks(filename);
      await assertOwnedPath(filename);
      if (!(await lstat(filename)).isFile()) throw new Error("LOG_FILE_INVALID");
      // Only remove structurally recognized redacted log records.
      const lines = (await readFile(filename, "utf8")).trim().split("\n").filter(Boolean);
      if (
        lines.every((line) =>
          /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z (DEBUG|INFO|WARN|ERROR) (desktop|app-server|mcp-server) [A-Z][A-Z0-9_]+ run=\S+ session=\S+ correlation=\S+ action=\S+ phase=\S+ outcome=\S+ duration_ms=\S+ /u.test(
            line,
          ),
        )
      )
        files.push(filename);
    }
  }
  return { root, generation: state.rootGeneration, files, manifestPath };
}
export async function removeLearnerData(cleanup, bootstrapFile) {
  const fresh = await inspectCleanup(bootstrapFile);
  if (
    fresh.root !== cleanup.root ||
    fresh.generation !== cleanup.generation ||
    JSON.stringify(fresh.files) !== JSON.stringify(cleanup.files)
  )
    throw new Error("DATA_ROOT_CHANGED");
  for (const filename of cleanup.files) {
    await assertNoLinks(filename);
    await unlink(filename);
  }
  // Unknown diagnostics, exports, or files are never recursively removed.
  for (const directory of [
    "attachments",
    "logs",
    "diagnostics/redacted",
    "diagnostics",
    "test-data",
  ]) {
    const filename = path.join(cleanup.root, directory);
    if (await exists(filename)) {
      await assertNoLinks(filename);
      await rmdir(filename).catch((error) => {
        if (error.code !== "ENOTEMPTY") throw error;
      });
    }
  }
  await unlink(cleanup.manifestPath);
  await unlink(bootstrapFile);
  const leftovers = await readdir(cleanup.root);
  if (leftovers.length)
    console.log(`Preserved unrelated files in ${cleanup.root}: ${leftovers.join(", ")}`);
  else await rmdir(cleanup.root);
}
