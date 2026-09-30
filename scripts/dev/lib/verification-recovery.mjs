import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, readdir, readFile, readlink, realpath, mkdir, open } from "node:fs/promises";
import path from "node:path";
import {
  root,
  stateRoot,
  verificationGate,
  git,
  load,
  controllerRecoveryAuthority,
  coordinatorVerificationBarrier,
  orca,
} from "../../agents/lib/orchestration.mjs";
import {
  journalFingerprint,
  privateText,
  privateJson,
  refreshVerificationProcesses,
} from "./verification-client.mjs";
import {
  lifecycleModes,
  statusMode,
  processIdentity,
  sameProcess,
  inspectOwnedProcess,
} from "./lifecycle.mjs";
import { validateVerificationJournal } from "./verification-session.mjs";

const hash = (value) => journalFingerprint(JSON.stringify(value));
const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const attestation =
  "exclusive-fixed-checkout;successful-launch-evidence-retained;no-subsequent-build-or-output-change;same-user-and-config;current-digest-is-not-historical-proof";
const allowedActions = new Set([
  "status",
  "windows",
  "window",
  "snapshot",
  "screenshot",
  "wait",
  "restore",
  "cleanup",
  "stop",
]);
export function assertRecoveryAction(request) {
  if (!allowedActions.has(request.action) || request.languageSelection !== undefined)
    throw new Error("VERIFY_RECOVERY_ACTION_FORBIDDEN");
}

function environmentIdentity() {
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value &&
      ((key.startsWith("CALL_NINA_") &&
        !["CALL_NINA_RUN_ID", "CALL_NINA_READY_FILE"].includes(key)) ||
        [
          "NODE_OPTIONS",
          "NODE_PATH",
          "ELECTRON_OVERRIDE_DIST_PATH",
          "ELECTRON_RUN_AS_NODE",
        ].includes(key))
    )
      throw new Error("VERIFY_RECOVERY_OVERRIDE_FORBIDDEN");
  }
  return hash(
    Object.fromEntries(
      ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "APPDATA", "USER"].map((key) => [
        key,
        process.env[key] ?? null,
      ]),
    ),
  );
}
async function directorySafe(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error("VERIFY_DIRECTORY_UNSAFE");
}
async function absent(filename) {
  const info = await lstat(filename).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (info) throw new Error("VERIFY_RECOVERY_OWNERSHIP_RETAINED");
}

// Fixed inventory: every runtime bundle/resource and installed dependency remains
// target-owned. Symlinks are hashed and their referents traversed, never followed
// into another checkout, cache, configuration directory or credential store.
export async function recoveryArtifacts(targetRoot) {
  const entries = [];
  const seen = new Set();
  async function visit(filename) {
    const relative = path.relative(targetRoot, filename);
    if (!relative || relative.startsWith("../") || path.isAbsolute(relative))
      throw new Error("VERIFY_ARTIFACT_ROOT_INVALID");
    const actual = await realpath(filename);
    if (
      !actual.startsWith(`${targetRoot}${path.sep}`) ||
      !/^(node_modules|apps|packages|plugins|content)(\/|$)/.test(
        path.relative(targetRoot, actual),
      ) ||
      path
        .relative(targetRoot, actual)
        .split(path.sep)
        .some((part) => [".git", ".runtime"].includes(part))
    )
      throw new Error("VERIFY_ARTIFACT_FOREIGN_ROOT");
    if (seen.has(filename)) return;
    seen.add(filename);
    const before = await lstat(filename);
    if (before.isSymbolicLink()) {
      entries.push([relative, "link", await readlink(filename)]);
      await visit(actual);
    } else if (before.isDirectory()) {
      entries.push([relative, "directory", before.mode]);
      for (const name of (await readdir(filename)).sort()) await visit(path.join(filename, name));
    } else if (before.isFile()) {
      const digest = createHash("sha256");
      const handle = await open(filename, "r");
      try {
        for await (const chunk of handle.createReadStream({ autoClose: false }))
          digest.update(chunk);
      } finally {
        await handle.close();
      }
      const after = await lstat(filename);
      if (
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error("VERIFY_ARTIFACT_CHANGED");
      entries.push([relative, "file", before.mode, before.size, digest.digest("hex")]);
    } else throw new Error("VERIFY_ARTIFACT_INVALID");
  }
  for (const relative of [
    "apps/desktop/dist",
    "apps/desktop/src/renderer/locales",
    "apps/mcp-server/dist",
    "plugins/call-nina",
    "content/curriculum",
    "node_modules",
    "apps/desktop/node_modules",
    "apps/mcp-server/node_modules",
  ])
    await visit(path.join(targetRoot, relative));
  for (const relative of [
    "apps/desktop/dist/main/index.js",
    "apps/desktop/dist/preload/index.cjs",
    "apps/desktop/dist/renderer/index.html",
    "apps/mcp-server/dist/index.js",
  ])
    if (!(await lstat(path.join(targetRoot, relative))).isFile())
      throw new Error("VERIFY_ARTIFACT_MISSING");
  const require = createRequire(path.join(targetRoot, "apps/desktop/package.json"));
  const electronRoot = path.dirname(require.resolve("electron/package.json"));
  const executableName = (await readFile(path.join(electronRoot, "path.txt"), "utf8")).trim();
  if (process.platform !== "linux" || executableName !== "electron")
    throw new Error("VERIFY_RECOVERY_ELECTRON_UNSUPPORTED");
  const electronExecutable = await realpath(path.join(electronRoot, "dist", executableName));
  if (
    !entries.some(
      (entry) => entry[0] === path.relative(targetRoot, electronExecutable) && entry[1] === "file",
    )
  )
    throw new Error("VERIFY_ARTIFACT_INCOMPLETE");
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { digest: hash(entries), count: entries.length, electronExecutable };
}

function validateRecoveryJournal(journal) {
  validateVerificationJournal(journal);
  const languages = ["en-US", "pt-BR", "es", "de"];
  const generation = (value) =>
    typeof value === "string" && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
  if (
    journal.records.some(
      (record, index) =>
        !record ||
        !languages.includes(record.language) ||
        !generation(record.rootGeneration) ||
        (journal.initialRoot !== undefined && record.rootGeneration !== journal.initialRoot) ||
        (record.kind === "material" &&
          !/^material-revision_[0-9a-z]{16,64}$/.test(record.revision ?? "")) ||
        journal.records.findIndex((entry) => entry.id === record.id) !== index,
    ) ||
    (journal.initialTarget !== undefined && !generation(journal.initialRoot)) ||
    (journal.learningPreferences !== undefined &&
      (!journal.learningPreferences ||
        typeof journal.learningPreferences !== "object" ||
        Array.isArray(journal.learningPreferences))) ||
    Object.values(journal.learningPreferences ?? {}).some(
      (preference) =>
        !generation(preference.rootGeneration) || preference.rootGeneration !== journal.initialRoot,
    )
  )
    throw new Error("VERIFY_RECOVERY_INVALID");
}

async function failedAttemptEvidence(gate) {
  const runtime = path.join(gate.worktree, ".runtime");
  const directory = path.join(runtime, "verification");
  await directorySafe(runtime);
  await directorySafe(directory);
  for (const mode of lifecycleModes) {
    if ((await statusMode({ mode, runtimeRoot: runtime })).status !== "stopped")
      throw new Error("VERIFY_RECOVERY_NOT_STOPPED");
    await absent(path.join(runtime, `${mode}.ready.json`));
  }
  for (const relative of [
    "start.lock",
    "verification/processes.json",
    "verification/shutdown.json",
    "verification/control.sock",
  ])
    await absent(path.join(runtime, relative));
  const original = await privateText(path.join(directory, "recovery.json"));
  const journal = JSON.parse(original);
  validateRecoveryJournal(journal);
  if (journal.pendingAction || journal.interruptedActions?.length || journal.baseline)
    throw new Error("VERIFY_RECOVERY_MUTATION_UNRESOLVED");
  const proofBytes = await privateText(path.join(directory, "stopped.json"));
  const proof = JSON.parse(proofBytes);
  const bootId = (await processIdentity(process.pid)).bootId;
  if (
    proof.schemaVersion !== 1 ||
    proof.run !== null ||
    proof.head !== null ||
    proof.app !== null ||
    proof.worktree !== gate.worktree ||
    !uuid(proof.lifecycleRunId) ||
    proof.status !== "exact-processes-stopped" ||
    !Number.isFinite(Date.parse(proof.stoppedAt)) ||
    !Array.isArray(proof.processes) ||
    !proof.processes.length ||
    !proof.processes.some((item) => sameProcess(item, proof.controller)) ||
    proof.processes.some((item) => !sameProcess(item, item) || item.bootId !== bootId) ||
    proof.journalFingerprint !== journalFingerprint(original)
  )
    throw new Error("VERIFY_FAILED_ATTEMPT_PROOF_REQUIRED");
  if ((await refreshVerificationProcesses({ processes: [...proof.processes] })).length)
    throw new Error("VERIFY_OWNED_PROCESSES_RETAINED");
  return {
    journalFingerprint: journalFingerprint(original),
    proofFingerprint: journalFingerprint(proofBytes),
    failedLifecycleRunId: proof.lifecycleRunId,
  };
}
function receiptFile(run, generation, gate) {
  return path.join(stateRoot, "controller-recovery", `${hash({ run, generation, gate })}.json`);
}
async function immutableJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await directorySafe(path.dirname(filename));
  const handle = await open(filename, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(filename), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  const parent = await open(path.dirname(path.dirname(filename)), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
function validateRequest(request, inventoryOnly) {
  const required = ["run", "expectedHead", "controllerHead", "reviewTask"];
  const keys = inventoryOnly
    ? required
    : [
        ...required,
        "expectedJournalFingerprint",
        "expectedProofFingerprint",
        "expectedArtifactDigest",
        "launchEvidence",
        "attestation",
      ];
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).sort().join() !== [...keys].sort().join() ||
    !/^run_[\w-]+$/.test(request.run ?? "") ||
    !/^[a-f0-9]{40}$/.test(request.expectedHead ?? "")
  )
    throw new Error("VERIFY_RECOVERY_REQUEST_INVALID");
  if (inventoryOnly) return;
  const evidence = request.launchEvidence;
  if (
    ![
      request.expectedJournalFingerprint,
      request.expectedProofFingerprint,
      request.expectedArtifactDigest,
    ].every(hex) ||
    request.attestation !== attestation ||
    !evidence ||
    Object.keys(evidence).sort().join() !== "at,dispatchId,head,sha256,taskId,toolItemId" ||
    !/^ctx_[\w-]+$/.test(evidence.dispatchId ?? "") ||
    !/^task_[\w-]+$/.test(evidence.taskId ?? "") ||
    evidence.head !== request.expectedHead ||
    !hex(evidence.sha256) ||
    !Number.isFinite(Date.parse(evidence.at)) ||
    typeof evidence.toolItemId !== "string" ||
    !/^orca:[a-zA-Z0-9%:_-]{1,250}$/.test(evidence.toolItemId)
  )
    throw new Error("VERIFY_RECOVERY_LAUNCH_EVIDENCE_REQUIRED");
}
export async function prepareControllerRecovery(request, inventoryOnly = false) {
  validateRequest(request, inventoryOnly);
  const authority = controllerRecoveryAuthority(
    request.run,
    request.expectedHead,
    request.controllerHead,
    request.reviewTask,
  );
  const { gate, binding, review } = authority;
  await directorySafe(stateRoot);
  await directorySafe(path.dirname(stateRoot));
  const filename = receiptFile(request.run, binding.generation, gate);
  const prior = await privateJson(filename).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (prior) {
    if (inventoryOnly || prior.requestDigest !== hash(request))
      throw new Error("VERIFY_RECOVERY_ATTEMPT_RETAINED");
    return { existing: true, receipt: prior, filename };
  }
  const environment = environmentIdentity();
  const evidence = await failedAttemptEvidence(gate);
  const artifacts = await recoveryArtifacts(gate.worktree);
  if (inventoryOnly)
    return {
      status: "inventory",
      ...evidence,
      artifacts: { digest: artifacts.digest, count: artifacts.count },
      appHead: gate.head,
      controllerHead: request.controllerHead,
      historicalDigest: null,
    };
  if (
    evidence.journalFingerprint !== request.expectedJournalFingerprint ||
    evidence.proofFingerprint !== request.expectedProofFingerprint ||
    artifacts.digest !== request.expectedArtifactDigest
  )
    throw new Error("VERIFY_RECOVERY_EVIDENCE_CHANGED");
  // The launch observation is separately attested; a current digest never proves
  // what bytes were used by a historical app. Bind its actual verifier assignment.
  const launch = load(path.join(stateRoot, "launches", `${request.launchEvidence.taskId}.json`));
  const launchReceipt = load(
    path.join(stateRoot, "launches", `${request.launchEvidence.taskId}.json.receipt`),
  );
  if (
    launch.run !== request.run ||
    launch.role !== "verifier" ||
    launch.baseline !== gate.head ||
    launch.target !== gate.worktree ||
    launchReceipt.dispatchId !== request.launchEvidence.dispatchId
  )
    throw new Error("VERIFY_RECOVERY_LAUNCH_EVIDENCE_REQUIRED");
  // Recheck after the potentially long inventory, before preparation. No journal write.
  const fresh = controllerRecoveryAuthority(
    request.run,
    request.expectedHead,
    request.controllerHead,
    request.reviewTask,
  );
  if (hash(fresh) !== hash(authority) || hash(await failedAttemptEvidence(gate)) !== hash(evidence))
    throw new Error("VERIFY_RECOVERY_EVIDENCE_CHANGED");
  const receipt = {
    schemaVersion: 1,
    id: randomUUID(),
    lifecycleRunId: randomUUID(),
    preparedAt: new Date().toISOString(),
    request,
    requestDigest: hash(request),
    run: request.run,
    generation: binding.generation,
    coordinator: binding.coordinator,
    gate,
    review,
    appHead: gate.head,
    controllerHead: request.controllerHead,
    targetRoot: gate.worktree,
    controllerRoot: root,
    environment,
    artifacts,
    evidence,
    launcher: await processIdentity(process.pid),
  };
  await immutableJson(filename, receipt);
  return { receipt, filename, existing: false };
}
export function recoveryContext(receipt, filename) {
  return {
    targetRoot: receipt.targetRoot,
    barrier: receipt.gate,
    electronExecutable: receipt.artifacts.electronExecutable,
    provenance: {
      appHead: receipt.appHead,
      controllerHead: receipt.controllerHead,
      controllerRoot: receipt.controllerRoot,
      targetRoot: receipt.targetRoot,
      recoveryReceipt: receipt.id,
      receiptDigest: hash(receipt),
      artifactDigest: receipt.artifacts.digest,
      lifecycleRunId: receipt.lifecycleRunId,
    },
    receipt,
    filename,
  };
}
export async function validateRecoveryContext(context, { beforeLaunch = false } = {}) {
  const { receipt, filename } = context;
  await directorySafe(path.dirname(filename));
  await directorySafe(path.join(receipt.targetRoot, ".runtime"));
  await directorySafe(path.join(receipt.targetRoot, ".runtime/verification"));
  const persisted = await privateJson(filename);
  const binding = await privateJson(path.join(stateRoot, "run.json"));
  const gate = await privateJson(verificationGate);
  if (
    hash(persisted) !== hash(receipt) ||
    receipt.requestDigest !== hash(receipt.request) ||
    hash(gate) !== hash(receipt.gate) ||
    binding.run !== receipt.run ||
    binding.generation !== receipt.generation ||
    binding.coordinator !== receipt.coordinator ||
    root !== receipt.controllerRoot ||
    (await realpath(root)) !== root ||
    (await realpath(receipt.targetRoot)) !== receipt.targetRoot ||
    git(["rev-parse", "HEAD"]).trim() !== receipt.controllerHead ||
    git(["status", "--porcelain"]).trim() ||
    git(["rev-parse", "HEAD"], receipt.targetRoot).trim() !== receipt.appHead ||
    git(["status", "--porcelain"], receipt.targetRoot).trim() ||
    environmentIdentity() !== receipt.environment
  )
    throw new Error("VERIFY_RECOVERY_CONTEXT_CHANGED");
  const live = orca(["orchestration", "run-show", "--id", receipt.run]).run;
  if (
    live?.coordinator_handle !== receipt.coordinator ||
    live.consumer_generation !== receipt.generation
  )
    throw new Error("VERIFY_RECOVERY_CONTEXT_CHANGED");
  const artifacts = await recoveryArtifacts(receipt.targetRoot);
  if (hash(artifacts) !== hash(receipt.artifacts)) throw new Error("VERIFY_ARTIFACT_CHANGED");
  if (beforeLaunch) {
    const directory = path.join(receipt.targetRoot, ".runtime/verification");
    if (
      journalFingerprint(await privateText(path.join(directory, "recovery.json"))) !==
        receipt.evidence.journalFingerprint ||
      journalFingerprint(await privateText(path.join(directory, "stopped.json"))) !==
        receipt.evidence.proofFingerprint
    )
      throw new Error("VERIFY_RECOVERY_EVIDENCE_CHANGED");
    const journal = JSON.parse(await privateText(path.join(directory, "recovery.json")));
    validateRecoveryJournal(journal);
    if (journal.pendingAction || journal.interruptedActions?.length || journal.baseline)
      throw new Error("VERIFY_RECOVERY_MUTATION_UNRESOLVED");
    const proof = await privateJson(path.join(directory, "stopped.json"));
    const bootId = (await processIdentity(process.pid)).bootId;
    if (
      proof.processes.some((item) => !sameProcess(item, item) || item.bootId !== bootId) ||
      (await refreshVerificationProcesses({ processes: [...proof.processes] })).length
    )
      throw new Error("VERIFY_OWNED_PROCESSES_RETAINED");
  }
}
export async function recordRecoveryIntent(context) {
  await validateRecoveryContext(context, { beforeLaunch: true });
  if (!sameProcess(context.receipt.launcher, await processIdentity(process.pid)))
    throw new Error("VERIFY_RECOVERY_LAUNCHER_CHANGED");
  await immutableJson(`${context.filename}.intent`, {
    receipt: context.receipt.id,
    lifecycleRunId: context.receipt.lifecycleRunId,
    launcher: context.receipt.launcher,
  });
}
export async function childRecoveryContext(run, expectedHead, attempt) {
  if (!uuid(attempt)) throw new Error("VERIFY_RECOVERY_ATTEMPT_INVALID");
  const binding = await privateJson(path.join(stateRoot, "run.json"));
  const gate = await privateJson(verificationGate);
  if (gate.run !== run || gate.head !== expectedHead) throw new Error("VERIFY_BARRIER_MISMATCH");
  const filename = receiptFile(run, binding.generation, gate);
  const receipt = await privateJson(filename);
  if (receipt.id !== attempt) throw new Error("VERIFY_RECOVERY_ATTEMPT_INVALID");
  const context = recoveryContext(receipt, filename);
  await validateRecoveryContext(context, { beforeLaunch: true });
  const authority = controllerRecoveryAuthority(
    run,
    expectedHead,
    receipt.controllerHead,
    receipt.request.reviewTask,
  );
  if (hash(authority.review) !== hash(receipt.review))
    throw new Error("VERIFY_EXACT_REVIEW_REQUIRED");
  const intent = await privateJson(`${filename}.intent`);
  const state = await privateJson(path.join(receipt.targetRoot, ".runtime/verify.json"));
  if (
    intent.receipt !== receipt.id ||
    intent.lifecycleRunId !== receipt.lifecycleRunId ||
    !sameProcess(intent.launcher, await processIdentity(intent.launcher.pid)) ||
    !sameProcess(intent.launcher, receipt.launcher) ||
    state.runId !== receipt.lifecycleRunId ||
    process.env.CALL_NINA_RUN_ID !== receipt.lifecycleRunId ||
    hash(state.provenance) !== hash(context.provenance) ||
    !(await inspectOwnedProcess(state)).owned
  )
    throw new Error("VERIFY_RECOVERY_LAUNCHER_CHANGED");
  const launcher = await processIdentity(state.pid);
  if (launcher.parentPid !== receipt.launcher.pid)
    throw new Error("VERIFY_RECOVERY_LAUNCHER_CHANGED");
  // Prove this controller descended from the exact recorded lifecycle launcher.
  const owned = await refreshVerificationProcesses({ processes: [launcher] });
  const controller = await processIdentity(process.pid);
  if (!owned.some((item) => sameProcess(item, controller))) {
    throw new Error("VERIFY_CONTROLLER_UNPROVEN");
  }
  return context;
}

// Reconciliation only observes this same attempt. It never retries spawn, rewrites
// original receipts, clears ownership or adopts proof from another lifecycle UUID.
export async function reconcileControllerRecovery(context) {
  await validateRecoveryContext(context);
  const { receipt, filename } = context;
  const runtime = path.join(receipt.targetRoot, ".runtime");
  const state = await privateJson(path.join(runtime, "verify.json")).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const proof = await privateJson(path.join(runtime, "verification/stopped.json"));
  if (proof.lifecycleRunId === receipt.lifecycleRunId) {
    if (hash(proof.provenance) !== hash(context.provenance))
      throw new Error("VERIFY_RECOVERY_ATTEMPT_CHANGED");
    const { stopVerification } = await import("./verification-client.mjs");
    return {
      receipt: receipt.id,
      lifecycleRunId: receipt.lifecycleRunId,
      ...(await stopVerification({ targetRoot: receipt.targetRoot, barrier: receipt.gate })),
    };
  }
  if (state) {
    if (
      state.runId !== receipt.lifecycleRunId ||
      hash(state.provenance) !== hash(context.provenance)
    )
      throw new Error("VERIFY_RECOVERY_ATTEMPT_CHANGED");
    return {
      status: "retained",
      receipt: receipt.id,
      lifecycleRunId: receipt.lifecycleRunId,
      lifecycle: await statusMode({ mode: "verify", runtimeRoot: runtime }),
      retry: "forbidden",
    };
  }
  const intent = await privateJson(`${filename}.intent`).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  // An intent without lifecycle ownership is an uncertain spawn, even when the
  // launcher exited. No process-name search or second app launch can settle it.
  if (intent) return { status: "spawn-unknown", receipt: receipt.id, retry: "forbidden" };
  if (sameProcess(receipt.launcher, await processIdentity(receipt.launcher.pid)))
    return { status: "prepared-owner-live", receipt: receipt.id, retry: "forbidden" };
  await failedAttemptEvidence(receipt.gate);
  return { status: "prepared-unstarted", receipt: receipt.id, retry: "forbidden" };
}

export async function existingControllerRecovery(run, expectedHead) {
  const gate = coordinatorVerificationBarrier(run, expectedHead);
  const binding = await privateJson(path.join(stateRoot, "run.json"));
  const filename = receiptFile(run, binding.generation, gate);
  const receipt = await privateJson(filename);
  controllerRecoveryAuthority(
    run,
    expectedHead,
    receipt.controllerHead,
    receipt.request.reviewTask,
  );
  const context = recoveryContext(receipt, filename);
  await validateRecoveryContext(context);
  return context;
}
