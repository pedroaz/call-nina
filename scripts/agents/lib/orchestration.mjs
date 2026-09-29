import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  renameSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { taskBranch } from "./task-metadata.mjs";

export { root } from "../../lib/config.mjs";
import { root, developmentConfig } from "../../lib/config.mjs";
export function git(args, cwd = root) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
// All linked worktrees share this small artifact/lock directory, never learner data.
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
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const lock = path.join(stateRoot, "operation.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error("ORCHESTRATION_OPERATION_BUSY: reconcile the owner before retrying");
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
export function resolveOrca() {
  const candidates = [developmentConfig().executables.orca];
  for (const name of ["orca-dev", "orca-ide", ...(process.platform === "linux" ? [] : ["orca"])]) {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter))
      candidates.push(path.join(dir, name));
  }
  if (process.platform === "linux")
    candidates.push(path.join(os.homedir(), ".config/orca/linux-orca-cli-shim/orca"));
  for (const candidate of candidates.filter(Boolean)) {
    if (!path.isAbsolute(candidate) || !existsSync(candidate)) continue;
    try {
      const help = execFileSync(candidate, ["orchestration", "--help"], {
        encoding: "utf8",
        timeout: 10000,
      });
      if (help.includes("worker-start") && help.includes("run-create")) return candidate;
    } catch {
      /* Try the next IDE launcher, never Linux's screen reader. */
    }
  }
  throw new Error("ORCA_IDE_CLI_UNAVAILABLE: set executables.orca in development.json");
}
export function orca(args) {
  const bin = resolveOrca();
  let output;
  try {
    output = execFileSync(bin, [...args, "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    // Preserve Orca's exact recovery receipt without logging commands/task text.
    if (error.stdout) process.stderr.write(error.stdout);
    throw new Error("ORCA_CALL_FAILED: inspect the receipt; do not blindly retry");
  }
  const reply = JSON.parse(output);
  if (!reply.ok) throw new Error(`ORCA_REJECTED: ${JSON.stringify(reply.error)}`);
  return reply.result;
}
export function assertCoordinator(run) {
  const file = path.join(stateRoot, "run.json");
  if (!run || !existsSync(file)) throw new Error("BOUND_COORDINATOR_REQUIRED");
  const binding = load(file);
  if (binding.run !== run) throw new Error("BOUND_COORDINATOR_REQUIRED");

  // Ask Orca to authenticate this invoking session. Never supply --from from a
  // shared receipt or substitute another terminal's launch identity/credentials.
  const caller = orca(["orchestration", "run-current"]).run;
  if (
    !caller ||
    caller.id !== run ||
    !process.env.ORCA_TERMINAL_HANDLE ||
    caller.coordinator_handle !== process.env.ORCA_TERMINAL_HANDLE ||
    caller.coordinator_handle !== binding.coordinator ||
    !Number.isSafeInteger(caller.consumer_generation) ||
    caller.consumer_generation !== binding.generation
  )
    throw new Error("LIVE_COORDINATOR_REQUIRED: invoking session does not own the bound Run");
  const live = orca(["orchestration", "run-show", "--id", run]).run;
  if (
    live?.id !== run ||
    live.coordinator_handle !== caller.coordinator_handle ||
    live.consumer_generation !== caller.consumer_generation
  )
    throw new Error("COORDINATOR_BINDING_CHANGED: reconcile and explicitly rebind");

  // A clean linked integration checkout is allowed even when the original
  // integrationRoot is dirty. Shared Git identity proves repository membership,
  // not coordinator authority; the live caller checks above remain mandatory.
  if (typeof binding.integrationRoot !== "string" || !path.isAbsolute(binding.integrationRoot))
    throw new Error("COORDINATOR_REPOSITORY_MISMATCH");
  const common = (cwd) =>
    realpathSync(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd).trim());
  if (common(root) !== common(binding.integrationRoot))
    throw new Error("COORDINATOR_REPOSITORY_MISMATCH");
  return binding;
}
export function role(name) {
  if (!/^[a-z][a-z-]+$/.test(name)) throw new Error("ROLE_INVALID");
  const value = parse(readFileSync(path.join(root, ".codex/agents", `${name}.toml`), "utf8"));
  for (const key of [
    "name",
    "description",
    "model",
    "model_reasoning_effort",
    "developer_instructions",
  ])
    if (typeof value[key] !== "string" || !value[key])
      throw new Error(`ROLE_FIELD_INVALID: ${key}`);
  if (value.name !== name) throw new Error("ROLE_NAME_MISMATCH");
  return value;
}
export const writers = new Set(["ui-engineer", "runtime-engineer"]);
// Launch-time enforcement only; direct editor writes still require pre-edit inspection.
export function assertWriterCheckout(target, assignment) {
  const checkout = realpathSync(target);
  if (checkout === realpathSync(primary) || checkout === realpathSync(root))
    throw new Error("ISOLATED_WRITER_REQUIRED");
  if (!Number.isSafeInteger(assignment.issue) || assignment.issue < 1)
    throw new Error("WRITER_TASK_ISSUE_REQUIRED");
  taskBranch(assignment.branch, assignment.issue);
  const branch = git(["branch", "--show-current"], checkout).trim();
  taskBranch(branch, assignment.issue);
  if (branch !== assignment.branch) throw new Error("ASSIGNMENT_BRANCH_MISMATCH");
}
export function tasks(run) {
  if (!/^run_[a-zA-Z0-9_-]+$/.test(run)) throw new Error("RUN_ID_INVALID");
  const result = orca(["orchestration", "task-list", "--run", run]);
  if (!Array.isArray(result.tasks)) throw new Error("ORCA_TASK_CONTRACT_CHANGED");
  return result.tasks;
}
export function assertNoVerification(target = root) {
  if (existsSync(verificationGate) && load(verificationGate).worktree === target)
    throw new Error("VERIFICATION_CHECKOUT_FROZEN");
}
export function assertVerificationBarrier() {
  if (!existsSync(verificationGate))
    throw new Error("VERIFY_BARRIER_REQUIRED: acquire with orchestrate verify-enter");
  const gate = load(verificationGate);
  if (gate.worktree !== root) throw new Error("VERIFY_CHECKOUT_MISMATCH");
  if (git(["rev-parse", "HEAD"]).trim() !== gate.head || git(["status", "--porcelain"]).trim())
    throw new Error("VERIFY_CHECKOUT_CHANGED");
  return gate;
}

// Offline recovery may only address the existing Run's reserved fixed checkout.
// Caller holds the shared operation lock throughout stop/reconciliation.
export function coordinatorVerificationBarrier(run, expectedHead) {
  assertCoordinator(run);
  if (!existsSync(verificationGate)) throw new Error("VERIFY_BARRIER_REQUIRED");
  const gate = load(verificationGate);
  if (gate.run !== run || gate.head !== expectedHead) throw new Error("VERIFY_BARRIER_MISMATCH");
  const common = (cwd) =>
    realpathSync(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd).trim());
  if (common(gate.worktree) !== common(root)) throw new Error("VERIFY_REPOSITORY_MISMATCH");
  if (
    git(["rev-parse", "HEAD"], gate.worktree).trim() !== gate.head ||
    git(["status", "--porcelain"], gate.worktree).trim()
  )
    throw new Error("VERIFY_CHECKOUT_CHANGED");
  return gate;
}

// A stopped recovery may advance the *same* reserved checkout without releasing
// its obligations. The prepared receipt makes checkout/barrier crashes resumable.
export async function advanceVerificationBarrier(request) {
  const { run, expectedHead, nextHead, reviewTask, expectedJournalFingerprint } = request;
  if (
    Object.keys(request).some(
      (key) =>
        !["run", "expectedHead", "nextHead", "reviewTask", "expectedJournalFingerprint"].includes(
          key,
        ),
    ) ||
    !/^[a-f0-9]{40}$/.test(expectedHead ?? "") ||
    !/^[a-f0-9]{40}$/.test(nextHead ?? "") ||
    expectedHead === nextHead ||
    !/^[a-f0-9]{64}$/.test(expectedJournalFingerprint ?? "")
  )
    throw new Error("VERIFY_ADVANCE_INVALID");
  assertCoordinator(run);
  if (!existsSync(verificationGate)) throw new Error("VERIFY_BARRIER_REQUIRED");
  const gate = load(verificationGate);
  if (gate.run !== run || ![expectedHead, nextHead].includes(gate.head))
    throw new Error("VERIFY_BARRIER_MISMATCH");
  const common = (cwd) =>
    realpathSync(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd).trim());
  if (common(gate.worktree) !== common(root)) throw new Error("VERIFY_REPOSITORY_MISMATCH");
  if (
    git(["status", "--porcelain"], gate.worktree).trim() ||
    git(["status", "--porcelain"], root).trim() ||
    git(["rev-parse", "HEAD"], root).trim() !== nextHead
  )
    throw new Error("VERIFY_CLEAN_REVIEWED_SOURCE_REQUIRED");
  git(["merge-base", "--is-ancestor", expectedHead, nextHead]);
  if (git(["ls-tree", "-r", "--name-only", nextHead, "--", ".runtime"]).trim())
    throw new Error("VERIFY_TRACKED_RUNTIME_FORBIDDEN");
  const all = tasks(run);
  for (const task of all.filter((item) => item.status === "dispatched")) {
    const file = path.join(stateRoot, "launches", `${task.id}.json`);
    if (!existsSync(file) || load(file).target === gate.worktree)
      throw new Error("VERIFY_WORKER_STILL_OWNS_CHECKOUT");
  }
  const review = all.find((item) => item.id === reviewTask);
  const spec = /^NINA_ASSIGNMENT=([^\n]+)/.exec(review?.spec ?? "");
  if (
    review?.status !== "completed" ||
    !spec ||
    JSON.parse(spec[1]).role !== "reviewer" ||
    JSON.parse(spec[1]).commit !== nextHead ||
    !/^task_[\w-]+$/.test(reviewTask)
  )
    throw new Error("VERIFY_EXACT_REVIEW_REQUIRED");
  const reviewLaunch = load(path.join(stateRoot, "launches", `${reviewTask}.json`));
  if (reviewLaunch.run !== run || reviewLaunch.baseline !== nextHead)
    throw new Error("VERIFY_EXACT_REVIEW_REQUIRED");
  const { stoppedVerificationEvidence, journalFingerprint } =
    await import("../../dev/lib/verification-client.mjs");
  const { proof, original, journal } = await stoppedVerificationEvidence({
    ...gate,
    head: expectedHead,
  });
  if (
    journalFingerprint(original) !== expectedJournalFingerprint ||
    proof.journalFingerprint !== expectedJournalFingerprint
  )
    throw new Error("VERIFY_JOURNAL_CHANGED");
  const file = path.join(
    gate.worktree,
    ".runtime/verification",
    `advance-${expectedHead}-${nextHead}.json`,
  );
  const observedHead = git(["rev-parse", "HEAD"], gate.worktree).trim();
  let receipt;
  if (existsSync(file)) {
    receipt = load(file);
    if (
      JSON.stringify(receipt.request) !== JSON.stringify(request) ||
      receipt.worktree !== gate.worktree
    )
      throw new Error("VERIFY_ADVANCE_RECEIPT_MISMATCH");
  } else {
    if (gate.head !== expectedHead || observedHead !== expectedHead)
      throw new Error("VERIFY_ADVANCE_RECEIPT_REQUIRED");
    receipt = {
      id: randomUUID(),
      at: new Date().toISOString(),
      request,
      worktree: gate.worktree,
      lifecycleRunId: proof.lifecycleRunId,
      stopProof: proof,
      actions: [
        ...(journal.interruptedActions ?? []),
        ...(journal.pendingAction ? [journal.pendingAction] : []),
      ].map((entry) => ({
        action: entry.action,
        startedAt: entry.startedAt,
        actionId: entry.actionId,
        requestFingerprint: entry.requestFingerprint,
        sourceHead: entry.sourceHead ?? expectedHead,
      })),
    };
    replace(file, receipt);
  }
  if (![expectedHead, nextHead].includes(observedHead)) throw new Error("VERIFY_CHECKOUT_CHANGED");
  if (observedHead === expectedHead) git(["checkout", "--detach", nextHead], gate.worktree);
  if (
    git(["status", "--porcelain"], gate.worktree).trim() ||
    git(["rev-parse", "HEAD"], gate.worktree).trim() !== nextHead ||
    readFileSync(path.join(gate.worktree, ".runtime/verification/recovery.json"), "utf8") !==
      original
  )
    throw new Error("VERIFY_ADVANCE_READBACK_FAILED");
  if (gate.head !== nextHead)
    replace(verificationGate, {
      ...gate,
      head: nextHead,
      advances: [
        ...(gate.advances ?? []),
        {
          id: receipt.id,
          from: expectedHead,
          to: nextHead,
          journalFingerprint: expectedJournalFingerprint,
          reviewTask,
          actions: receipt.actions,
        },
      ],
    });
  else if (!gate.advances?.some((entry) => entry.id === receipt.id))
    throw new Error("VERIFY_ADVANCE_RECEIPT_MISMATCH");
  return {
    status: "advanced",
    head: nextHead,
    receiptId: receipt.id,
    journalFingerprint: expectedJournalFingerprint,
    recovery: "retained-resume-required",
  };
}
