import net from "node:net";
import { lstat, readFile, writeFile, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import {
  inspectOwnedProcess,
  processIdentity,
  processInventory,
  sameProcess,
} from "./lifecycle.mjs";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
export const verificationRoot = path.join(repositoryRoot, ".runtime", "verification");
export const socketPath = path.join(verificationRoot, "control.sock");
export async function requestVerification(
  request,
  timeoutMs = 300000,
  targetRoot = repositoryRoot,
) {
  try {
    return await send(request, timeoutMs, targetRoot);
  } catch (error) {
    throw new Error(
      /^VERIFY_[A-Z0-9_:]+$/.test(error?.message ?? "")
        ? error.message
        : "VERIFY_SESSION_UNAVAILABLE",
    );
  }
}
async function send(request, timeoutMs, targetRoot) {
  const repositoryRoot = targetRoot;
  const verificationRoot = path.join(targetRoot, ".runtime/verification");
  const socketPath = path.join(verificationRoot, "control.sock");
  const state = JSON.parse(
    await readFile(path.join(repositoryRoot, ".runtime/verify.json"), "utf8"),
  );
  if (!(await inspectOwnedProcess(state)).owned) throw new Error("VERIFY_OWNER_UNAVAILABLE");
  const directory = await lstat(verificationRoot);
  const socket = await lstat(socketPath);
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid() ||
    directory.mode & 0o077 ||
    !socket.isSocket() ||
    socket.uid !== process.getuid() ||
    socket.mode & 0o077
  )
    throw new Error("VERIFY_SOCKET_UNSAFE");
  return new Promise((resolve, reject) => {
    const connection = net.createConnection(socketPath);
    let output = "";
    connection.setEncoding("utf8");
    const deadline = setTimeout(
      () => connection.destroy(new Error("VERIFY_REQUEST_TIMEOUT")),
      timeoutMs,
    );
    connection.on("close", () => clearTimeout(deadline));
    connection.on("connect", () => connection.write(JSON.stringify(request) + "\n"));
    connection.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 2 * 1024 * 1024)
        connection.destroy(new Error("VERIFY_RESPONSE_LIMIT"));
      if (output.includes("\n")) {
        connection.destroy();
        try {
          const response = JSON.parse(output.slice(0, output.indexOf("\n")));
          if (!response.ok) {
            const phase =
              typeof response.phase === "string"
                ? response.phase.toUpperCase().replaceAll("-", "_")
                : "";
            reject(new Error(`${response.code}${/^[A-Z_]+$/.test(phase) ? `:${phase}` : ""}`));
          } else resolve(response.result);
        } catch {
          reject(new Error("VERIFY_RESPONSE_INVALID"));
        }
      }
    });
    connection.on("error", (error) =>
      reject(
        new Error(
          error.message === "VERIFY_REQUEST_TIMEOUT" ? error.message : "VERIFY_CONNECTION_FAILED",
        ),
      ),
    );
    connection.on("end", () => {
      if (!output.includes("\n")) reject(new Error("VERIFY_CONNECTION_CLOSED"));
    });
  });
}

const ownershipPath = path.join(verificationRoot, "processes.json");
export async function writePrivateJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await rename(temporary, filename);
}
async function privateText(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error("VERIFY_OWNERSHIP_UNSAFE");
  return readFile(filename, "utf8");
}
export async function privateJson(filename) {
  return JSON.parse(await privateText(filename));
}

// Follow only proven parentage. A shared process group alone never grants authority.
export async function refreshVerificationProcesses(record) {
  const inventory = await processInventory();
  const owned = record.processes.filter((prior) => {
    const observed = inventory.find((item) => item.pid === prior.pid);
    if (observed && !sameProcess(prior, observed))
      throw new Error("VERIFY_PROCESS_IDENTITY_CHANGED");
    return Boolean(observed);
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of inventory) {
      if (candidate.uid !== process.getuid()) continue;
      if (owned.some((item) => item.pid === candidate.pid)) continue;
      const parent = owned.find((item) => item.pid === candidate.parentPid);
      if (parent && sameProcess(parent, await processIdentity(parent.pid))) {
        owned.push(candidate);
        changed = true;
      }
    }
  }
  // Detect orphaned/unknown members, but never signal a group to collect them.
  const groups = record.processes
    .filter((item) => item.groupId === item.pid)
    .map((item) => item.pid);
  if (
    inventory.some(
      (item) => groups.includes(item.groupId) && !owned.some((known) => sameProcess(known, item)),
    )
  )
    throw new Error("VERIFY_PROCESS_GROUP_UNPROVEN");
  // Retain dead leaders as group anchors until the whole session is settled.
  record.processes = [
    ...record.processes.filter((item) => !owned.some((live) => live.pid === item.pid)),
    ...owned,
  ];
  if (record.processes.length > 4096) throw new Error("VERIFY_PROCESS_LIMIT");
  return owned;
}

export async function recordVerificationController(state) {
  const launcher = await processIdentity(state.pid);
  const controller = await processIdentity(process.pid);
  if (!launcher || launcher.startTicks !== state.startTicks || !controller)
    throw new Error("VERIFY_LIFECYCLE_OWNER_REQUIRED");
  const record = {
    schemaVersion: 1,
    runId: state.runId,
    controller,
    app: null,
    processes: [launcher],
  };
  const owned = await refreshVerificationProcesses(record);
  if (!owned.some((item) => sameProcess(controller, item)))
    throw new Error("VERIFY_CONTROLLER_UNPROVEN");
  await writePrivateJson(ownershipPath, record);
  return record;
}
export async function recordVerificationApp(record, pid) {
  const app = await processIdentity(pid);
  const owned = await refreshVerificationProcesses(record);
  if (!app || !owned.some((item) => sameProcess(app, item))) throw new Error("VERIFY_APP_UNPROVEN");
  record.app = app;
  await writePrivateJson(ownershipPath, record);
}
export async function persistVerificationProcesses(record) {
  await refreshVerificationProcesses(record);
  await writePrivateJson(ownershipPath, record);
}

async function signalExact(identity, signal) {
  const observed = await processIdentity(identity.pid);
  if (!observed || observed.zombie) return;
  if (!sameProcess(identity, observed)) throw new Error("VERIFY_PROCESS_IDENTITY_CHANGED");
  try {
    process.kill(identity.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

const stoppedArtifacts = [
  "verification/control.sock",
  "verification/processes.json",
  "verification/shutdown.json",
  "verification/screenshot.png",
  "verify.json",
  "verify.ready.json",
];
async function stoppedArtifact(targetRoot, relative) {
  const filename = path.join(targetRoot, ".runtime", relative);
  const info = await lstat(filename).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!info) return undefined;
  if (info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error("VERIFY_OWNERSHIP_UNSAFE");
  if (relative === "verification/control.sock") {
    if (!info.isSocket()) throw new Error("VERIFY_SOCKET_UNSAFE");
    return { relative, kind: "socket", device: info.dev, inode: info.ino };
  }
  if (!info.isFile()) throw new Error("VERIFY_OWNERSHIP_UNSAFE");
  return { relative, kind: "file", sha256: journalFingerprint(await readFile(filename)) };
}
async function finalizeStoppedVerification(targetRoot, barrier, proof) {
  const bootId = (await processIdentity(process.pid)).bootId;
  if (
    proof.schemaVersion !== 1 ||
    proof.worktree !== targetRoot ||
    proof.run !== (barrier?.run ?? null) ||
    proof.head !== (barrier?.head ?? null) ||
    proof.status !== "exact-processes-stopped" ||
    typeof proof.lifecycleRunId !== "string" ||
    !Array.isArray(proof.processes) ||
    !proof.processes.some((item) => sameProcess(item, proof.controller)) ||
    (proof.app && !proof.processes.some((item) => sameProcess(item, proof.app))) ||
    proof.processes.some((item) => !sameProcess(item, item) || item.bootId !== bootId) ||
    !Array.isArray(proof.finalization) ||
    proof.finalization.some(
      (item, index) =>
        !stoppedArtifacts.includes(item.relative) ||
        proof.finalization.findIndex((other) => other.relative === item.relative) !== index,
    )
  )
    throw new Error("VERIFY_STOP_PROOF_REQUIRED");
  if ((await refreshVerificationProcesses({ processes: [...proof.processes] })).length)
    throw new Error("VERIFY_OWNED_PROCESSES_RETAINED");
  const journalFile = path.join(targetRoot, ".runtime/verification/recovery.json");
  const original = await privateText(journalFile).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if ((original === undefined ? null : journalFingerprint(original)) !== proof.journalFingerprint)
    throw new Error("VERIFY_JOURNAL_CHANGED");
  // Validate every survivor before removing any. A different/new session's file
  // cannot be adopted merely because an earlier stop receipt exists.
  for (const relative of stoppedArtifacts) {
    const observed = await stoppedArtifact(targetRoot, relative);
    if (
      observed &&
      JSON.stringify(observed) !==
        JSON.stringify(proof.finalization.find((item) => item.relative === relative))
    )
      throw new Error("VERIFY_SHUTDOWN_OWNER_CHANGED");
  }
  for (const relative of stoppedArtifacts) {
    const observed = await stoppedArtifact(targetRoot, relative);
    if (!observed) continue;
    if (
      JSON.stringify(observed) !==
      JSON.stringify(proof.finalization.find((item) => item.relative === relative))
    )
      throw new Error("VERIFY_SHUTDOWN_OWNER_CHANGED");
    await rm(path.join(targetRoot, ".runtime", relative));
  }
  const journal = original === undefined ? undefined : JSON.parse(original);
  return {
    status: proof.disposition,
    journalFingerprint: proof.journalFingerprint,
    escalated: proof.escalated,
    failures: proof.failures,
    remainingRecords: journal?.records ?? [],
    remainingPreferences: Object.keys(journal?.preferences ?? {}),
    notes: journal?.notes ?? [],
    pendingAction: journal?.pendingAction,
    interruptedActions: journal?.interruptedActions ?? [],
  };
}

// Caller serializes this with starts. Timeouts never release a pending UI action:
// escalation first stops its processes, and preserves its journal for resumption.
export async function stopVerification({
  targetRoot = repositoryRoot,
  barrier,
  suspend = false,
} = {}) {
  const verificationRoot = path.join(targetRoot, ".runtime/verification");
  const ownershipPath = path.join(verificationRoot, "processes.json");
  const repositoryRoot = targetRoot;
  const directory = await lstat(verificationRoot).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (
    directory &&
    (!directory.isDirectory() || directory.uid !== process.getuid() || directory.mode & 0o077)
  )
    throw new Error("VERIFY_DIRECTORY_UNSAFE");
  let state;
  try {
    state = await privateJson(path.join(repositoryRoot, ".runtime/verify.json"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let record;
  try {
    record = await privateJson(ownershipPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const stoppedProof = await privateJson(path.join(verificationRoot, "stopped.json")).catch(
    (error) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  if (
    stoppedProof &&
    (!state || state.runId === stoppedProof.lifecycleRunId) &&
    (!record || record.runId === stoppedProof.lifecycleRunId)
  ) {
    const remaining = await Promise.all(
      stoppedArtifacts.map((relative) => stoppedArtifact(targetRoot, relative)),
    );
    if (remaining.some(Boolean))
      return finalizeStoppedVerification(targetRoot, barrier, stoppedProof);
  }
  if (state && state.mode !== "verify") throw new Error("VERIFY_OWNERSHIP_INVALID");
  if (state && !record) throw new Error("VERIFY_PROCESS_OWNERSHIP_REQUIRED");
  if (
    record &&
    (record.schemaVersion !== 1 ||
      record.runId !== state?.runId ||
      !Array.isArray(record.processes) ||
      !record.processes.some(
        (item) => item.pid === state.pid && item.startTicks === state.startTicks,
      ) ||
      !record.processes.some((item) => sameProcess(item, record.controller)))
  )
    throw new Error("VERIFY_OWNERSHIP_INVALID");
  const recoveryFile = path.join(verificationRoot, "shutdown.json");
  if (record) {
    const bootId = (await processIdentity(process.pid)).bootId;
    if (
      record.controller?.bootId !== bootId ||
      record.processes.some((item) => !sameProcess(item, item) || item.bootId !== bootId)
    )
      throw new Error("VERIFY_PROCESS_IDENTITY_CHANGED");
    const retained = await privateJson(recoveryFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (retained) {
      if (retained.runId !== record.runId) throw new Error("VERIFY_SHUTDOWN_OWNER_CHANGED");
      for (const item of retained.processes) {
        if (!record.processes.some((prior) => sameProcess(prior, item)))
          record.processes.push(item);
      }
    }
    // Save children before a graceful parent exit can reparent them.
    await refreshVerificationProcesses(record);
    await writePrivateJson(recoveryFile, record);
  }
  let cleanup;
  let gracefulFailure;
  if (state && (await inspectOwnedProcess(state)).owned) {
    try {
      cleanup = await requestVerification(
        { action: suspend ? "suspend" : "stop" },
        30000,
        targetRoot,
      );
    } catch (error) {
      gracefulFailure = error.message;
    }
  }
  if (!record) {
    const journal = await privateJson(path.join(verificationRoot, "recovery.json")).catch(
      (error) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    return {
      status: "already-stopped",
      notes: journal?.notes ?? [],
      remainingRecords: journal?.records ?? [],
      remainingPreferences: Object.keys(journal?.preferences ?? {}),
      pendingAction: journal?.pendingAction,
      interruptedActions: journal?.interruptedActions ?? [],
    };
  }
  const latest = await privateJson(ownershipPath);
  if (latest.runId !== record.runId || !sameProcess(latest.controller, record.controller))
    throw new Error("VERIFY_SHUTDOWN_OWNER_CHANGED");
  record.app = latest.app;
  if (record.app && !latest.processes.some((item) => sameProcess(item, record.app)))
    throw new Error("VERIFY_APP_OWNERSHIP_REQUIRED");
  for (const item of latest.processes) {
    if (!record.processes.some((prior) => sameProcess(prior, item))) record.processes.push(item);
  }
  if (["stopped", "suspended"].includes(cleanup?.status)) await delay(250);
  let live = await refreshVerificationProcesses(record);
  // A rejected launch can exit before an Electron identity is recorded. Reconcile
  // only when every proven process is gone; missing app proof never grants signals.
  if (!record.app && live.length) throw new Error("VERIFY_APP_OWNERSHIP_REQUIRED");
  const escalated = live.length > 0;
  await writePrivateJson(recoveryFile, record);
  // The socket request is the controller's graceful shutdown. Never deliver a
  // controller SIGTERM: Playwright handlers can signal a whole child group.
  // Kill only its exact identity, after all known children have exited.
  const controllers = new Set([state.pid, record.controller.pid]);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const sent = new Set();
    const deadline = Date.now() + 5000;
    do {
      live = await refreshVerificationProcesses(record);
      await writePrivateJson(recoveryFile, record);
      const children = live.filter((item) => !controllers.has(item.pid));
      for (const item of children.length ? children : live) {
        const key = `${item.pid}:${item.startTicks}`;
        if (!sent.has(key)) {
          await signalExact(item, controllers.has(item.pid) ? "SIGKILL" : signal);
          sent.add(key);
        }
      }
      if (!live.length) break;
      await delay(100);
    } while (Date.now() < deadline);
  }
  live = await refreshVerificationProcesses(record);
  if (live.length) throw new Error("VERIFY_OWNED_PROCESSES_RETAINED");
  // The controller is now gone; reading its final journal cannot race a mutation.
  const journal = await privateJson(path.join(verificationRoot, "recovery.json")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!cleanup && journal) {
    if (!journal.notes.includes("INTERRUPTED_SHUTDOWN")) journal.notes.push("INTERRUPTED_SHUTDOWN");
    await writePrivateJson(path.join(verificationRoot, "recovery.json"), journal);
  }
  // Durable terminal identity evidence precedes removing any ownership file.
  const proof = {
    schemaVersion: 1,
    run: barrier?.run ?? null,
    head: barrier?.head ?? null,
    worktree: targetRoot,
    lifecycleRunId: record.runId,
    controller: record.controller,
    app: record.app,
    processes: record.processes,
    stoppedAt: new Date().toISOString(),
    status: "exact-processes-stopped",
    disposition: suspend && cleanup?.status === "suspended" && !escalated ? "suspended" : "stopped",
    journalFingerprint: journal ? journalFingerprint(JSON.stringify(journal)) : null,
  };
  proof.escalated = escalated;
  proof.failures = [
    ...(cleanup?.failures ?? []),
    ...(!cleanup ? [gracefulFailure ?? "VERIFY_CLEANUP_UNCONFIRMED"] : []),
  ];
  proof.finalization = (
    await Promise.all(stoppedArtifacts.map((relative) => stoppedArtifact(targetRoot, relative)))
  ).filter(Boolean);
  await writePrivateJson(path.join(verificationRoot, "stopped.json"), proof);
  return finalizeStoppedVerification(targetRoot, barrier, proof);
}

export function journalFingerprint(text) {
  return createHash("sha256").update(text).digest("hex");
}

// Only a coordinator-authenticated barrier may supply this context. No public
// command accepts a filesystem target or a generic effects-cleared assertion.
export async function reconcileVerificationEffect(barrier, request, command) {
  const plugin = command === "reconcile-plugin-refresh";
  if (!["reconcile-disclosure", "reconcile-plugin-refresh"].includes(command))
    throw new Error("VERIFY_RECONCILIATION_INVALID");
  const filename = path.join(barrier.worktree, ".runtime/verification/recovery.json");
  const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const allowed = [
    "run",
    "expectedHead",
    "expectedJournalFingerprint",
    "action",
    "startedAt",
    "actionId",
    "requestFingerprint",
    "sourceHead",
    "evidenceKind",
    "sourceReferences",
    "evidenceReferences",
    "attestation",
    "effectReadback",
    "effectSourceReferences",
  ];
  if (
    !request ||
    Object.keys(request).some((key) => !allowed.includes(key)) ||
    request.run !== barrier.run ||
    request.expectedHead !== barrier.head ||
    !hex(request.expectedJournalFingerprint) ||
    !hex(request.requestFingerprint) ||
    request.action !== "click" ||
    !(
      request.sourceHead === barrier.head ||
      barrier.advances?.some((entry) => entry.from === request.sourceHead)
    ) ||
    typeof request.startedAt !== "string" ||
    !Number.isFinite(Date.parse(request.startedAt)) ||
    new Date(request.startedAt).toISOString() !== request.startedAt ||
    (request.actionId !== undefined && !/^[a-f0-9-]{36}$/.test(request.actionId)) ||
    request.evidenceKind !==
      (plugin
        ? "source-bounded-scoped-nina-plugin-refresh"
        : "source-bounded-main-reading-summary-disclosure") ||
    request.attestation !==
      (plugin
        ? "original-request-and-screen-bound-to-entry;only-scoped-nina-plugin-refresh;explicit-action-and-fresh-registration-verified;cleanup-and-settings-readback-confirmed"
        : "original-request-and-screen-bound-to-entry;all-target-and-ancestor-effects-transient-local-ui;cleanup-and-settings-readback-confirmed")
  )
    throw new Error("VERIFY_RECONCILIATION_INVALID");
  const pluginPaths = [
    "apps/desktop/src/renderer/SettingsPage.tsx",
    "apps/desktop/src/main/plugin-integration.ts",
    "packages/codex-client/src/plugin.ts",
    "packages/codex-client/src/plugin-source.ts",
  ];
  const sourcePaths = plugin
    ? pluginPaths
    : [
        "apps/desktop/src/renderer/components/ui/Disclosure.tsx",
        "apps/desktop/src/renderer/ReadingPractice.tsx",
        "apps/desktop/src/renderer/components/layout/AppShell.tsx",
        "apps/desktop/src/renderer/useHelperSelection.ts",
      ];
  if (
    !Array.isArray(request.sourceReferences) ||
    request.sourceReferences.length !== sourcePaths.length ||
    sourcePaths.some(
      (sourcePath) =>
        request.sourceReferences.filter((ref) => ref.path === sourcePath).length !== 1,
    ) ||
    request.sourceReferences.some(
      (ref) =>
        Object.keys(ref).some((key) => !["path", "commit", "startLine", "endLine"].includes(key)) ||
        ref.commit !== request.sourceHead ||
        !Number.isInteger(ref.startLine) ||
        !Number.isInteger(ref.endLine) ||
        ref.startLine < 1 ||
        ref.endLine < ref.startLine ||
        ref.endLine > 10000,
    ) ||
    !Array.isArray(request.evidenceReferences) ||
    request.evidenceReferences.length < 5 ||
    request.evidenceReferences.length > 12 ||
    request.evidenceReferences.some(
      (ref) =>
        !ref ||
        Object.keys(ref).some((key) => !["id", "sha256", "kind"].includes(key)) ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(ref.id) ||
        !hex(ref.sha256),
    )
  )
    throw new Error("VERIFY_RECONCILIATION_EVIDENCE_REQUIRED");
  const evidenceKinds = [
    "original-request",
    "original-result",
    "original-screen",
    "cleanup-readback",
    "settings-readback",
    ...(plugin ? ["plugin-action-success", "plugin-registration-readback"] : []),
  ];
  if (
    request.evidenceReferences.some((ref) => !evidenceKinds.includes(ref.kind)) ||
    evidenceKinds.some(
      (kind) => request.evidenceReferences.filter((ref) => ref.kind === kind).length !== 1,
    )
  )
    throw new Error("VERIFY_RECONCILIATION_EVIDENCE_REQUIRED");
  if (plugin) {
    const effect = request.effectReadback;
    if (
      !effect ||
      Object.keys(effect).some(
        (key) =>
          !["head", "action", "sourceVersion", "at", "result", "plugin", "registration"].includes(
            key,
          ),
      ) ||
      effect.head !== barrier.head ||
      !["install", "refresh"].includes(effect.action) ||
      typeof effect.sourceVersion !== "string" ||
      !/^[0-9]+\.[0-9]+\.[0-9]+(?:[+-][a-zA-Z0-9.-]+)?$/.test(effect.sourceVersion) ||
      effect.sourceVersion.length > 100 ||
      typeof effect.at !== "string" ||
      !Number.isFinite(Date.parse(effect.at)) ||
      new Date(effect.at).toISOString() !== effect.at ||
      effect.at <= request.startedAt ||
      effect.result !== "verified" ||
      effect.plugin !== "installed" ||
      effect.registration !== "verified" ||
      !Array.isArray(request.effectSourceReferences) ||
      request.effectSourceReferences.length !== pluginPaths.length ||
      pluginPaths.some(
        (sourcePath) =>
          request.effectSourceReferences.filter((ref) => ref.path === sourcePath).length !== 1,
      ) ||
      request.effectSourceReferences.some(
        (ref) =>
          !ref ||
          Object.keys(ref).some(
            (key) => !["path", "commit", "startLine", "endLine"].includes(key),
          ) ||
          ref.commit !== barrier.head ||
          !Number.isInteger(ref.startLine) ||
          !Number.isInteger(ref.endLine) ||
          ref.startLine < 1 ||
          ref.endLine < ref.startLine ||
          ref.endLine > 10000,
      )
    )
      throw new Error("VERIFY_PLUGIN_EFFECT_UNPROVEN");
  } else if (request.effectReadback !== undefined || request.effectSourceReferences !== undefined)
    throw new Error("VERIFY_RECONCILIATION_INVALID");
  const { proof, journal, original } = await stoppedVerificationEvidence(barrier);
  const receiptKey = journalFingerprint(
    JSON.stringify({
      action: request.action,
      startedAt: request.startedAt,
      actionId: request.actionId,
      expectedJournalFingerprint: request.expectedJournalFingerprint,
    }),
  );
  const prior = journal.receipts?.find((item) => item.key === receiptKey);
  if (prior && JSON.stringify(prior.evidence) === JSON.stringify(request))
    return {
      status: "already-reconciled",
      receiptId: prior.id,
      effect: prior.effect,
      dispatchOccurrence: "unknown",
      notes: journal.notes,
      interruptedActions: journal.interruptedActions,
      pendingAction: journal.pendingAction,
      remainingRecords: journal.records,
      remainingPreferences: Object.keys(journal.preferences ?? {}),
    };
  if (journalFingerprint(original) !== request.expectedJournalFingerprint)
    throw new Error("VERIFY_JOURNAL_CHANGED");
  if (
    journal.schemaVersion !== 1 ||
    !Array.isArray(journal.records) ||
    journal.records.length ||
    !journal.preferences ||
    Object.keys(journal.preferences).length ||
    journal.baseline ||
    journal.pendingAction ||
    !Array.isArray(journal.notes) ||
    journal.notes.some(
      (note) => !["ACTION_RECONCILIATION_REQUIRED", "INTERRUPTED_SHUTDOWN"].includes(note),
    ) ||
    !Array.isArray(journal.interruptedActions) ||
    (journal.receipts !== undefined && !Array.isArray(journal.receipts))
  )
    throw new Error("VERIFY_UI_RECOVERY_REQUIRED");
  const matches = journal.interruptedActions.filter(
    (entry) =>
      entry.action === request.action &&
      entry.startedAt === request.startedAt &&
      entry.actionId === request.actionId,
  );
  if (
    matches.length !== 1 ||
    (matches[0].requestFingerprint &&
      matches[0].requestFingerprint !== request.requestFingerprint) ||
    (matches[0]?.sourceHead && matches[0].sourceHead !== request.sourceHead) ||
    (request.sourceHead !== barrier.head &&
      !barrier.advances?.some((advance) =>
        advance.actions?.some(
          (entry) =>
            entry.action === request.action &&
            entry.startedAt === request.startedAt &&
            entry.actionId === request.actionId &&
            entry.sourceHead === request.sourceHead,
        ),
      ))
  )
    throw new Error("VERIFY_ACTION_IDENTITY_MISMATCH");
  if (plugin && request.effectReadback.at > proof.stoppedAt)
    throw new Error("VERIFY_PLUGIN_EFFECT_UNPROVEN");
  const entry = matches[0];
  const receipt = {
    id: randomUUID(),
    key: receiptKey,
    at: new Date().toISOString(),
    effect: plugin
      ? "scoped-nina-plugin-refresh-effect-reconciled"
      : "transient-disclosure-effect-reconciled",
    dispatchOccurrence: "unknown",
    entry,
    evidence: request,
    lifecycleRunId: proof.lifecycleRunId,
    stopProof: proof,
  };
  journal.receipts ??= [];
  journal.receipts.push(receipt);
  journal.interruptedActions = journal.interruptedActions.filter((item) => item !== entry);
  if (!journal.interruptedActions.length)
    journal.notes = journal.notes.filter(
      (note) => !["ACTION_RECONCILIATION_REQUIRED", "INTERRUPTED_SHUTDOWN"].includes(note),
    );
  // All supported writers share the operation lock; compare again before atomic
  // publication. Receipt and resolution cannot be split by a process crash.
  if ((await readFile(filename, "utf8")) !== original) throw new Error("VERIFY_JOURNAL_CHANGED");
  await writePrivateJson(filename, journal);
  const readback = await privateJson(filename);
  if (!readback.receipts?.some((item) => item.id === receipt.id))
    throw new Error("VERIFY_RECEIPT_READBACK_FAILED");
  return {
    status: "reconciled",
    receiptId: receipt.id,
    effect: receipt.effect,
    dispatchOccurrence: "unknown",
    journalFingerprint: journalFingerprint(JSON.stringify(readback)),
    interruptedActions: readback.interruptedActions,
    notes: readback.notes,
  };
}

export async function stoppedVerificationEvidence(barrier) {
  const directory = path.join(barrier.worktree, ".runtime/verification");
  const filename = path.join(directory, "recovery.json");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error("VERIFY_DIRECTORY_UNSAFE");
  for (const file of [
    "processes.json",
    "shutdown.json",
    "control.sock",
    "../verify.json",
    "../verify.ready.json",
    "../start.lock",
  ]) {
    if (
      await lstat(path.join(directory, file)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      })
    )
      throw new Error("VERIFY_STOP_PROOF_REQUIRED");
  }
  const proof = await privateJson(path.join(directory, "stopped.json"));
  const bootId = (await processIdentity(process.pid)).bootId;
  if (
    proof.schemaVersion !== 1 ||
    proof.run !== barrier.run ||
    !(
      proof.head === barrier.head ||
      barrier.advances?.some((entry) => entry.from === proof.head && entry.to === barrier.head)
    ) ||
    proof.worktree !== barrier.worktree ||
    proof.status !== "exact-processes-stopped" ||
    typeof proof.stoppedAt !== "string" ||
    !Number.isFinite(Date.parse(proof.stoppedAt)) ||
    !proof.app ||
    !Array.isArray(proof.processes) ||
    !proof.processes.some((item) => sameProcess(item, proof.controller)) ||
    !proof.processes.some((item) => sameProcess(item, proof.app)) ||
    proof.processes.some((item) => !sameProcess(item, item) || item.bootId !== bootId)
  )
    throw new Error("VERIFY_STOP_PROOF_REQUIRED");
  const identities = { processes: [...proof.processes] };
  if ((await refreshVerificationProcesses(identities)).length)
    throw new Error("VERIFY_OWNED_PROCESSES_RETAINED");
  const original = await privateText(filename);
  const journal = JSON.parse(original);
  return { proof, journal, original };
}
