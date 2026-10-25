import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import {
  root,
  git,
  stateRoot,
  verificationGate,
  save,
  load,
  replace,
  manualVerificationOwner,
  assertManualVerificationOwner,
  verificationSourceDigest,
} from "./verification-state.mjs";
import { validateVerificationJournal } from "./verification-session.mjs";
import {
  privateJson,
  refreshVerificationProcesses,
  journalFingerprint,
} from "./verification-client.mjs";

const artifacts = [
  "verify.json",
  "verify.ready.json",
  "verification/processes.json",
  "verification/control.sock",
];
const journalAt = (target) => path.join(target, ".runtime/verification/recovery.json");
const archiveRoot = path.join(stateRoot, "verification-history");
function assertStopped(target = root) {
  if (artifacts.some((file) => existsSync(path.join(target, ".runtime", file))))
    throw new Error("VERIFY_MANUAL_PROCESS_STATE_RETAINED");
}
function journalState(target = root) {
  const file = journalAt(target);
  if (!existsSync(file)) return { state: "clean", fingerprint: null };
  const bytes = readFileSync(file);
  const fingerprint = journalFingerprint(bytes);
  try {
    const journal = JSON.parse(bytes);
    const { needsRecovery } = validateVerificationJournal(journal);
    return {
      state: needsRecovery ? "pending" : "clean",
      fingerprint,
      records: journal.records.length,
      preferences: Object.keys(journal.preferences).length,
      learningPreferences: Object.keys(journal.learningPreferences ?? {}).length,
      interruptedActions:
        (journal.interruptedActions ?? []).length + Number(Boolean(journal.pendingAction)),
    };
  } catch {
    return { state: "incompatible", fingerprint };
  }
}
function history() {
  if (!existsSync(archiveRoot)) return [];
  return readdirSync(archiveRoot)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const entry = load(path.join(archiveRoot, file));
      return {
        id: entry.id,
        kind: entry.kind,
        cleanup: entry.cleanup,
        at: entry.at,
        selectedCheckout: entry.worktree === root,
      };
    });
}
export function manualVerificationStatus() {
  const gate = existsSync(verificationGate) ? load(verificationGate) : undefined;
  const local = journalState();
  return {
    reservation: gate
      ? {
          mode: gate.mode ?? "orchestrated",
          run: gate.run,
          currentOwner: gate.mode === "manual" && gate.owner === process.env.CODEX_THREAD_ID,
          selectedCheckout: gate.worktree === root,
          processArtifacts: artifacts.some((file) =>
            existsSync(path.join(gate.worktree, ".runtime", file)),
          ),
          cleanup: journalState(gate.worktree).state,
        }
      : null,
    localCleanup: local,
    retained: history(),
    available: ["source-work", "build", "existing-window-visual-review"],
    next: gate
      ? gate.mode !== "manual"
        ? "Retired session retained: preserve ownership and private evidence; do not adopt or delete its resources."
        : "Use verify-manual-recover ARGS='--run <reported-manual-run>' after exact stop; active sessions are not adopted."
      : local.state === "incompatible"
        ? "Inspect the retained journal, then explicitly quarantine by its reported fingerprint; no learner records are deleted."
        : local.state === "pending"
          ? "Run verify-manual-enter, then verify-resume to recover this checkout using current source."
          : "Run verify-manual-enter then verify-start for a controlled session.",
  };
}
function archive(kind, target, gate, proof) {
  const local = journalState(target);
  const entry = {
    schemaVersion: 1,
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    worktree: target,
    cleanup: local.state,
    journalFingerprint: local.fingerprint,
    // Private immutable evidence, never application logs or a replacement for learner data.
    journalBase64: existsSync(journalAt(target))
      ? readFileSync(journalAt(target)).toString("base64")
      : null,
    ...(gate ? { reservation: gate } : {}),
    ...(proof ? { stopProof: proof } : {}),
  };
  save(path.join(archiveRoot, `${entry.id}.json`), entry);
  return entry;
}
async function exactStopProof(gate) {
  assertStopped(gate.worktree);
  if (!gate.started) return undefined;
  const proof = await privateJson(path.join(gate.worktree, ".runtime/verification/stopped.json"));
  if (
    proof.run !== gate.run ||
    proof.head !== gate.head ||
    proof.sourceDigest !== gate.sourceDigest ||
    proof.worktree !== gate.worktree ||
    proof.status !== "exact-processes-stopped" ||
    !Array.isArray(proof.processes) ||
    !proof.processes.length ||
    proof.journalFingerprint !== journalState(gate.worktree).fingerprint
  )
    throw new Error("VERIFY_STOP_PROOF_REQUIRED");
  if ((await refreshVerificationProcesses({ processes: [...proof.processes] })).length)
    throw new Error("VERIFY_OWNED_PROCESSES_RETAINED");
  return proof;
}
async function releaseStopped(gate, kind) {
  const proof = await exactStopProof(gate);
  if (JSON.stringify(load(verificationGate)) !== JSON.stringify(gate))
    throw new Error("VERIFY_MANUAL_OWNER_MISMATCH");
  const entry = archive(kind, gate.worktree, gate, proof);
  // A cleanup failure never masquerades as a live process. Keep its journal in
  // place for resume and a private snapshot for provenance before releasing.
  rmSync(verificationGate);
  return {
    verification: "released",
    mode: "manual",
    cleanup: entry.cleanup,
    recoveryId: entry.id,
    next:
      entry.cleanup === "clean"
        ? "verify-manual-enter"
        : "The original checkout retains its journal. Enter there and resume; independent work may continue.",
  };
}
export function enterManualVerification() {
  if (existsSync(verificationGate)) throw new Error("VERIFY_RESERVATION_ALREADY_HELD");
  const owner = manualVerificationOwner();
  assertStopped();
  const local = journalState();
  if (local.state === "incompatible") throw new Error("VERIFY_JOURNAL_QUARANTINE_REQUIRED");
  const gate = {
    schemaVersion: 1,
    mode: "manual",
    run: `manual_${randomUUID()}`,
    owner,
    worktree: root,
    head: git(["rev-parse", "HEAD"]).trim(),
    sourceDigest: verificationSourceDigest(),
    started: false,
  };
  save(verificationGate, gate);
  return {
    verification: "reserved",
    mode: "manual",
    baseHead: gate.head,
    sourceDigest: gate.sourceDigest,
    cleanup: local.state,
    next: local.state === "pending" ? "verify-resume" : "verify-start",
  };
}
export function markManualVerificationStarted(expected) {
  if (expected.mode !== "manual") return;
  const gate = assertManualVerificationOwner(load(verificationGate));
  if (gate.run !== expected.run || gate.sourceDigest !== expected.sourceDigest)
    throw new Error("VERIFY_MANUAL_OWNER_MISMATCH");
  replace(verificationGate, { ...gate, started: true });
}
export async function leaveManualVerification() {
  if (!existsSync(verificationGate)) return { verification: "not-held" };
  return releaseStopped(assertManualVerificationOwner(load(verificationGate)), "stopped-session");
}
// Explicit user-led recovery, never an automatic takeover based on elapsed time.
export async function recoverManualVerification(expectedRun) {
  manualVerificationOwner();
  if (!existsSync(verificationGate)) throw new Error("VERIFY_BARRIER_REQUIRED");
  const gate = load(verificationGate);
  if (gate.mode !== "manual" || !expectedRun || gate.run !== expectedRun)
    throw new Error("VERIFY_MANUAL_RECOVERY_SCOPE_MISMATCH");
  return releaseStopped(gate, "manual-handoff");
}
export function quarantineManualJournal(expectedFingerprint, selectedWorktree = root) {
  const target = realpathSync(selectedWorktree);
  const worktrees = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => realpathSync(line.slice(9)));
  if (!worktrees.includes(target)) throw new Error("VERIFY_CHECKOUT_MISMATCH");
  manualVerificationOwner();
  if (existsSync(verificationGate)) throw new Error("VERIFY_RESERVATION_ALREADY_HELD");
  assertStopped(target);
  const local = journalState(target);
  if (!expectedFingerprint || local.fingerprint !== expectedFingerprint || local.state === "clean")
    throw new Error("VERIFY_JOURNAL_CHANGED");
  const entry = archive("quarantined-unresolved", target);
  // This retires incompatible/stale automation, not its underlying obligations.
  // Never restore historical preferences or delete uncertain records here.
  replace(journalAt(target), {
    schemaVersion: 1,
    preferences: {},
    records: [],
    notes: [],
    receipts: [
      { code: "PRIOR_JOURNAL_QUARANTINED_UNRESOLVED", recoveryId: entry.id, at: entry.at },
    ],
  });
  return {
    verification: "quarantined",
    recoveryId: entry.id,
    cleanup: "unresolved",
    learnerDataChanged: false,
    next: "Independent work is available; archived obligations remain visible in verify-status.",
  };
}
