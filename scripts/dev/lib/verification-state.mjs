import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  renameSync,
  lstatSync,
} from "node:fs";
import path from "node:path";

export { root } from "../../lib/config.mjs";
import { root } from "../../lib/config.mjs";
export function git(args, cwd = root) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
// Shared verification state stays at its established path to preserve reservations
// and private recovery history across this workflow cleanup; never learner data.
export const primary = git(["worktree", "list", "--porcelain"]).split("\n")[0].slice(9);
export const stateRoot = path.join(primary, ".runtime/orchestration");
export const verificationGate = path.join(stateRoot, "verification.json");
export function save(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
}
export function load(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
export function replace(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  save(temporary, value);
  try {
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export function locked(fn) {
  const resource = "verification";
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const lock = path.join(stateRoot, `${resource}.lock`);
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("VERIFY_OPERATION_BUSY");
    throw error;
  }
  try {
    const result = fn();
    if (result && typeof result.then === "function")
      return result.finally(() => rmSync(lock, { recursive: true }));
    rmSync(lock, { recursive: true });
    return result;
  } catch (error) {
    rmSync(lock, { recursive: true });
    throw error;
  }
}

// Reservations bind the current chat and fingerprinted source, including local edits.
export function manualVerificationOwner() {
  const owner = process.env.CODEX_THREAD_ID;
  if (!/^[a-f0-9-]{36}$/i.test(owner ?? "")) throw new Error("VERIFY_MANUAL_SESSION_REQUIRED");
  return owner;
}
export function verificationSourceDigest(target = root) {
  const digest = createHash("sha256");
  digest.update("desktop-verification-source-v2\0");
  const files = [
    ...new Set(
      git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], target)
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  for (const file of files) {
    // Bind executable desktop/controller inputs, not unrelated docs or website edits.
    if (
      !/^(apps\/(desktop|mcp-server)\/|packages\/|scripts\/(dev|build|lib|agents)\/|content\/|plugins\/)/.test(
        file,
      ) &&
      !/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|toolchain\.json|\.node-version|tsconfig[^/]*\.json|development\.json)$/.test(
        file,
      )
    )
      continue;
    if (/\.(md|mdx)$/.test(file) && !file.startsWith("content/") && !file.startsWith("plugins/"))
      continue;
    digest.update(JSON.stringify(file));
    let info;
    try {
      info = lstatSync(path.join(target, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      digest.update("deleted\0");
      continue;
    }
    if (!info.isFile()) throw new Error("VERIFY_MANUAL_SOURCE_UNSUPPORTED");
    digest.update(`${info.mode & 0o111}:${info.size}:`);
    digest.update(readFileSync(path.join(target, file)));
  }
  return digest.digest("hex");
}
export function assertManualVerificationOwner(gate, target = root) {
  if (
    gate.mode !== "manual" ||
    gate.schemaVersion !== 1 ||
    typeof gate.started !== "boolean" ||
    !/^[a-f0-9]{40}$/.test(gate.head ?? "") ||
    gate.owner !== manualVerificationOwner() ||
    gate.worktree !== target ||
    !/^manual_[a-f0-9-]{36}$/.test(gate.run ?? "") ||
    !/^[a-f0-9]{64}$/.test(gate.sourceDigest ?? "")
  )
    throw new Error("VERIFY_MANUAL_OWNER_MISMATCH");
  return gate;
}
export function assertVerificationBarrier({ allowSourceChanges = false } = {}) {
  if (!existsSync(verificationGate))
    throw new Error("VERIFY_BARRIER_REQUIRED: use make verify-manual-enter");
  const gate = load(verificationGate);
  if (gate.worktree !== root) throw new Error("VERIFY_CHECKOUT_MISMATCH");
  if (gate.mode !== "manual") throw new Error("VERIFY_RETIRED_SESSION_RETAINED");
  assertManualVerificationOwner(gate);
  if (!allowSourceChanges && verificationSourceDigest() !== gate.sourceDigest)
    throw new Error("VERIFY_CHECKOUT_CHANGED");
  return gate;
}
