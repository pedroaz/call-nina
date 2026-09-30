#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertVerificationBarrier,
  coordinatorVerificationBarrier,
  advanceVerificationBarrier,
  locked,
} from "../agents/lib/orchestration.mjs";
import { inspectOwnedProcess, lifecyclePaths, startMode, statusMode } from "./lib/lifecycle.mjs";
import {
  requestVerification,
  verificationRoot,
  recordVerificationController,
  persistVerificationProcesses,
  stopVerification,
  journalFingerprint,
  reconcileVerificationEffect,
} from "./lib/verification-client.mjs";
import {
  VerificationSession,
  root,
  runtimeRoot,
  failure,
  safeCode,
  validateVerificationJournal,
  mutatingActions,
} from "./lib/verification-session.mjs";

import {
  prepareControllerRecovery,
  recoveryContext,
  childRecoveryContext,
  validateRecoveryContext,
  recordRecoveryIntent,
  reconcileControllerRecovery,
  existingControllerRecovery,
  assertRecoveryAction,
} from "./lib/verification-recovery.mjs";

const { positionals, values: launchOptions } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: "string" },
    attempt: { type: "string" },
    "expected-head": { type: "string" },
    executable: { type: "string" },
    "config-dir": { type: "string" },
    "codex-executable": { type: "string" },
  },
});
const {
  run: recoveryRun,
  "expected-head": expectedHead,
  attempt: recoveryAttempt,
  ...appOptions
} = launchOptions;
for (const value of Object.values(appOptions))
  if (!path.isAbsolute(value)) throw failure("VERIFY_OPTION_PATH_INVALID");
const forwardedOptions = Object.entries(appOptions).flatMap(([key, value]) => [`--${key}`, value]);
const maxRequest = 64 * 1024;
async function run(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      const batch = pending.split("\n");
      pending = batch.pop().slice(-4000);
      for (const line of batch) {
        lines.push(
          line
            .replaceAll(root, "<workspace>")
            .replace(/\/(?:home|Users|tmp)\/[^\s:]+/gu, "<private-path>")
            .slice(0, 2000),
        );
        if (lines.length > 40) lines.shift();
      }
    });
  }
  const [code] = await once(child, "exit");
  if (code !== 0) {
    for (const line of lines) process.stderr.write(line + "\n");
    throw failure("VERIFY_BUILD_FAILED");
  }
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw failure("VERIFY_REQUEST_INVALID");
  const fields = {
    status: [],
    windows: [],
    window: ["index"],
    snapshot: ["target"],
    screenshot: [],
    viewport: ["width", "height"],
    "reduced-motion": ["value"],
    click: ["target"],
    "double-click": ["target"],
    fill: ["target", "value"],
    select: ["target", "value"],
    press: ["target", "key"],
    wait: ["target", "state", "timeoutMs"],
    "prepare-ai": [],
    "begin-records": ["kind"],
    "confirm-no-creation": ["confirmation"],
    track: ["id"],
    cleanup: ["id"],
    note: ["code"],
    restore: ["languageSelection"],
    stop: [],
    suspend: [],
  };
  if (
    !Object.hasOwn(fields, request.action) ||
    Object.keys(request).some((key) => key !== "action" && !fields[request.action].includes(key))
  )
    throw failure("VERIFY_REQUEST_INVALID");
  for (const key of ["value", "key", "id", "code", "kind", "confirmation"]) {
    if (
      request[key] !== undefined &&
      (typeof request[key] !== "string" || request[key].length > 16000)
    )
      throw failure("VERIFY_REQUEST_INVALID");
  }
  if (
    request.timeoutMs !== undefined &&
    (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 180000)
  )
    throw failure("VERIFY_REQUEST_INVALID");
  if (
    request.state !== undefined &&
    !["visible", "hidden", "attached", "detached"].includes(request.state)
  )
    throw failure("VERIFY_REQUEST_INVALID");
  if (request.action === "window" && (!Number.isInteger(request.index) || request.index < 0))
    throw failure("VERIFY_REQUEST_INVALID");
  return request;
}
function locate(page, target) {
  if (
    !target ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    Object.keys(target).some((key) => !["role", "name", "label", "selector", "index"].includes(key))
  )
    throw failure("VERIFY_TARGET_INVALID");
  for (const key of ["role", "name", "label", "selector"])
    if (
      target[key] !== undefined &&
      (typeof target[key] !== "string" || !target[key].length || target[key].length > 500)
    )
      throw failure("VERIFY_TARGET_INVALID");
  if (
    [target.role, target.label, target.selector].filter((value) => value !== undefined).length !== 1
  )
    throw failure("VERIFY_TARGET_INVALID");
  if (target.name !== undefined && !target.role) throw failure("VERIFY_TARGET_INVALID");
  let locator = target.role
    ? page.getByRole(target.role, { name: target.name, exact: true })
    : target.label
      ? page.getByLabel(target.label, { exact: true })
      : page.locator(target.selector);
  if (target.index !== undefined) {
    if (!Number.isInteger(target.index) || target.index < 0 || target.index > 1000)
      throw failure("VERIFY_TARGET_INVALID");
    locator = locator.nth(target.index);
  }
  return locator;
}
async function serve(resume = false, recovering = false) {
  if (recovering && Object.keys(appOptions).length)
    throw failure("VERIFY_RECOVERY_OVERRIDE_FORBIDDEN");
  const context = recovering
    ? await childRecoveryContext(recoveryRun, expectedHead, recoveryAttempt)
    : { targetRoot: root, barrier: assertVerificationBarrier() };
  const barrier = context.barrier;
  const runtimeRoot = path.join(context.targetRoot, ".runtime");
  const verificationRoot = path.join(runtimeRoot, "verification");
  const socketPath = path.join(verificationRoot, "control.sock");
  const lifecycle = lifecyclePaths(runtimeRoot, "verify");
  if (!process.env.CALL_NINA_RUN_ID || process.env.CALL_NINA_READY_FILE !== lifecycle.ready)
    throw failure("VERIFY_LIFECYCLE_OWNER_REQUIRED");
  // The starter records ownership just after spawn; do not build or launch until it is proven.
  let lifecycleOwned = false;
  let lifecycleState;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const state = JSON.parse(await readFile(lifecycle.state, "utf8"));
      lifecycleOwned =
        state.runId === process.env.CALL_NINA_RUN_ID &&
        state.mode === "verify" &&
        (await inspectOwnedProcess(state)).owned;
      if (lifecycleOwned) break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(10);
  }
  if (!lifecycleOwned) throw failure("VERIFY_LIFECYCLE_OWNER_REQUIRED");
  lifecycleState = JSON.parse(await readFile(lifecycle.state, "utf8"));
  let recovery;
  process.umask(0o077);
  await mkdir(verificationRoot, { recursive: true, mode: 0o700 });
  const info = await lstat(verificationRoot);
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
    throw failure("VERIFY_DIRECTORY_UNSAFE");
  const ownership = await recordVerificationController(lifecycleState, context);
  try {
    const previous = JSON.parse(
      await readFile(path.join(verificationRoot, "recovery.json"), "utf8"),
    );
    const { needsRecovery } = validateVerificationJournal(previous);
    if (needsRecovery && !resume) throw failure("VERIFY_RECOVERY_REQUIRED");
    {
      recovery = needsRecovery
        ? previous
        : {
            schemaVersion: 1,
            records: [],
            notes: [],
            preferences: {},
            receipts: previous.receipts ?? [],
          };
      if (recovery.pendingAction) {
        recovery.interruptedActions ??= [];
        recovery.interruptedActions.push(recovery.pendingAction);
        delete recovery.pendingAction;
        if (!recovery.notes.includes("ACTION_RECONCILIATION_REQUIRED"))
          recovery.notes.push("ACTION_RECONCILIATION_REQUIRED");
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) throw failure("VERIFY_RECOVERY_INVALID");
    if (error.code !== "ENOENT") throw error;
  }
  await rm(socketPath, { force: true });
  await rm(path.join(verificationRoot, "screenshot.png"), { force: true });
  if (!recovering) await run("pnpm", ["--filter", "@call-nina/desktop", "run", "build"]);
  if (recovering) await validateRecoveryContext(context, { beforeLaunch: true });
  const session = new VerificationSession(
    verificationRoot,
    recovery,
    appOptions,
    ownership,
    context,
  );
  await session.persist();
  let recording;
  const ownershipTimer = setInterval(() => {
    if (recording) return;
    recording = persistVerificationProcesses(ownership, context)
      .catch(() => {
        // Retain the last proof; recovery revalidates every identity before acting.
      })
      .finally(() => {
        recording = undefined;
      });
  }, 1000);
  let server;
  let closing = false;
  let shutdownRequested = false;
  let active = Promise.resolve();
  let shutdown;
  function requestStop(suspend = false) {
    shutdownRequested = true;
    shutdown ??= active.then(() => close(suspend));
    return shutdown;
  }
  async function journaled(request, operation) {
    const { action } = request;
    if (recovering) {
      assertRecoveryAction(request);
      await validateRecoveryContext(context);
    }
    if (!mutatingActions.includes(action)) return operation();
    const identity = {
      actionId: randomUUID(),
      action,
      startedAt: new Date().toISOString(),
      sourceHead: barrier.head,
      ...(recovering
        ? { controllerHead: context.provenance.controllerHead, recoveryReceipt: context.receipt.id }
        : {}),
    };
    // Only the digest is retained; selectors, labels, keys and fill text stay ephemeral.
    identity.requestFingerprint = journalFingerprint(JSON.stringify(request));
    let target;
    try {
      if (action === "restore" && request.languageSelection !== undefined)
        await session.historicalLanguageSelection(request.languageSelection);
      if (["click", "double-click", "fill", "select", "press"].includes(action)) {
        if (["fill", "select"].includes(action) && typeof request.value !== "string")
          throw failure("VERIFY_REQUEST_INVALID");
        if (action === "press" && (typeof request.key !== "string" || !request.key.length))
          throw failure("VERIFY_REQUEST_INVALID");
        target = locate(session.page, request.target);
        const count = await target.count().catch(() => {
          throw failure("VERIFY_TARGET_INVALID");
        });
        if (count !== 1) throw failure(count ? "VERIFY_TARGET_AMBIGUOUS" : "VERIFY_TARGET_MISSING");
        await session.rememberSettings();
        if (action === "select") {
          const selection = await session.languageSelectionOwnership(target, request.value);
          if (selection) identity.learningLanguageSelection = selection;
        }
      }
      if (
        action === "cleanup" &&
        (!/^(activity|material)_[0-9a-z]{16,64}$/.test(request.id ?? "") ||
          !session.journal.records.some((entry) => entry.id === request.id))
      )
        throw failure("VERIFY_RECORD_NOT_OWNED");
    } catch (error) {
      session.journal.receipts ??= [];
      session.journal.receipts.push({
        ...identity,
        phase: "not-dispatched",
        code: safeCode(error),
      });
      await session.persist();
      throw error;
    }
    if (session.journal.pendingAction) {
      session.journal.interruptedActions ??= [];
      session.journal.interruptedActions.push(session.journal.pendingAction);
      if (!session.journal.notes.includes("ACTION_RECONCILIATION_REQUIRED"))
        session.journal.notes.push("ACTION_RECONCILIATION_REQUIRED");
    }
    session.journal.pendingAction = { ...identity, phase: "dispatch-may-have-started" };
    await session.persist();
    const result = await operation(target);
    if (recovering) await validateRecoveryContext(context);
    delete session.journal.pendingAction;
    await session.persist();
    return result;
  }
  async function close(suspend = false) {
    if (closing) return { status: "stopping" };
    closing = true;
    let cleanup;
    try {
      if (suspend) {
        session.journal.suspended = { at: new Date().toISOString() };
        await session.persist();
        cleanup = { failures: [], retained: true };
      } else cleanup = await journaled({ action: "stop" }, () => session.restore());
    } catch {
      cleanup = {
        failures: ["VERIFY_CLEANUP_FAILED"],
        remainingRecords: session.journal.records,
        remainingPreferences: Object.keys(session.journal.preferences),
      };
    }
    try {
      await session.application?.close();
    } catch {
      closing = false;
      cleanup.failures.push("VERIFY_APP_CLOSE_FAILED");
      return { status: "retained", ...cleanup };
    }
    await rm(path.join(verificationRoot, "screenshot.png"), { force: true });
    // Keep the private journal as the immutable receipt archive, even when all
    // cleanup obligations are settled. A later launch preserves these receipts.
    // Defer closing the listener until the stop response has been flushed.
    setTimeout(() => server?.close(), 25);
    return { status: suspend ? "suspended" : "stopped", ...cleanup };
  }
  async function dispatch(input, target) {
    const request = validateRequest(input);
    if (closing) throw failure("VERIFY_STOPPING");
    const page = session.page;
    if (request.action !== "status") session.phase = request.action;
    let result;
    switch (request.action) {
      case "status":
        return {
          phase: session.phase,
          aiPrepared: Boolean(session.aiPrepared),
          records: session.journal.records,
          notes: session.journal.notes,
          pendingAction: session.journal.pendingAction,
          interruptedActions: session.journal.interruptedActions,
        };
      case "windows": {
        let timeout;
        try {
          // Page.title has no timeout option. Only this read-only query may
          // finish locally while its browser response remains outstanding.
          result = await Promise.race([
            Promise.all(
              session.application
                .windows()
                .map(async (window, index) => ({ index, title: await window.title() })),
            ),
            new Promise((_, reject) => {
              timeout = setTimeout(() => reject(failure("VERIFY_WINDOWS_TIMEOUT")), 15000);
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
        break;
      }
      case "window": {
        const selected = session.application.windows()[request.index];
        if (!selected) throw failure("VERIFY_WINDOW_UNAVAILABLE");
        session.page = selected;
        return { index: request.index };
      }
      case "snapshot":
        result = {
          snapshot: (
            await (
              request.target ? locate(page, request.target) : page.locator("body")
            ).ariaSnapshot({ timeout: 15000 })
          ).slice(0, 48000),
          openedMaterialId: await page
            .locator("[data-material-id]")
            .first()
            .getAttribute("data-material-id", { timeout: 500 })
            .catch(() => null),
          openedActivityId: await page
            .locator("[data-activity-id]")
            .first()
            .getAttribute("data-activity-id", { timeout: 500 })
            .catch(() => null),
        };
        break;
      case "viewport": {
        if (
          !Number.isInteger(request.width) ||
          !Number.isInteger(request.height) ||
          request.width < 700 ||
          request.width > 2400 ||
          request.height < 500 ||
          request.height > 1600
        )
          throw failure("VERIFY_REQUEST_INVALID");
        await page.setViewportSize({ width: request.width, height: request.height });
        result = { width: request.width, height: request.height };
        break;
      }
      case "reduced-motion": {
        if (!["reduce", "no-preference"].includes(request.value))
          throw failure("VERIFY_REQUEST_INVALID");
        await page.emulateMedia({ reducedMotion: request.value });
        result = { reducedMotion: request.value };
        break;
      }
      case "screenshot": {
        const filename = path.join(verificationRoot, "screenshot.png");
        await page.screenshot({ path: filename, timeout: 15000 });
        await chmod(filename, 0o600);
        result = { path: filename, retention: "deleted-on-stop" };
        break;
      }
      case "click":
        await target.click();
        break;
      case "double-click":
        await target.dblclick();
        break;
      case "fill":
        if (typeof request.value !== "string") throw failure("VERIFY_REQUEST_INVALID");
        await target.fill(request.value);
        break;
      case "select":
        if (typeof request.value !== "string") throw failure("VERIFY_REQUEST_INVALID");
        await target.selectOption(request.value);
        break;
      case "press":
        if (typeof request.key !== "string") throw failure("VERIFY_REQUEST_INVALID");
        await target.press(request.key);
        break;
      case "wait":
        await locate(page, request.target).waitFor({
          state: request.state ?? "visible",
          timeout: request.timeoutMs ?? 15000,
        });
        break;
      case "prepare-ai":
        result = await session.prepareAI();
        break;
      case "begin-records":
        result = await session.beginRecords(request.kind);
        break;
      case "confirm-no-creation":
        result = await session.confirmNoCreation(request.confirmation);
        break;
      case "track":
        await session.trackActivity(request.id);
        break;
      case "cleanup":
        await session.cleanupActivity(request.id);
        break;
      case "note":
        if (!/^[A-Z][A-Z0-9_]{0,100}$/.test(request.code ?? ""))
          throw failure("VERIFY_REQUEST_INVALID");
        session.journal.notes.push(request.code);
        await session.persist();
        break;
      case "restore":
        result = await session.restore(request.languageSelection);
        break;
      case "stop":
      case "suspend":
        return requestStop(request.action === "suspend");
    }
    session.phase = "ready";
    return result ?? { status: "ok" };
  }
  try {
    await session.launch();
    let busy = false;
    server = net.createServer((connection) => {
      connection.setEncoding("utf8");
      connection.setTimeout(10000, () => connection.destroy());
      connection.on("error", () => {});
      let buffer = "";
      let submitted = false;
      connection.on("data", async (chunk) => {
        if (submitted) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer) > maxRequest) {
          submitted = true;
          connection.end(JSON.stringify({ ok: false, code: "VERIFY_REQUEST_LIMIT" }) + "\n");
          return;
        }
        if (!buffer.includes("\n")) return;
        submitted = true;
        connection.setTimeout(300000);
        let request;
        try {
          request = validateRequest(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
          if (recovering) assertRecoveryAction(request);
        } catch {
          connection.end(JSON.stringify({ ok: false, code: "VERIFY_REQUEST_INVALID" }) + "\n");
          return;
        }
        if (["stop", "suspend"].includes(request.action)) {
          try {
            connection.end(
              JSON.stringify({
                ok: true,
                result: await requestStop(request.action === "suspend"),
              }) + "\n",
            );
          } catch (error) {
            connection.end(JSON.stringify({ ok: false, code: safeCode(error) }) + "\n");
          }
          return;
        }
        if (shutdownRequested) {
          connection.end(JSON.stringify({ ok: false, code: "VERIFY_STOPPING" }) + "\n");
          return;
        }
        if (busy) {
          connection.end(
            JSON.stringify(
              request?.action === "status"
                ? { ok: true, result: { phase: session.phase, busy: true } }
                : { ok: false, code: "VERIFY_BUSY" },
            ) + "\n",
          );
          return;
        }
        busy = true;
        let finish;
        active = new Promise((resolve) => {
          finish = resolve;
        });
        try {
          connection.end(
            JSON.stringify({
              ok: true,
              result: await journaled(request, (target) => dispatch(request, target)),
            }) + "\n",
          );
        } catch (error) {
          connection.end(
            JSON.stringify({ ok: false, code: safeCode(error), phase: session.phase }) + "\n",
          );
        } finally {
          busy = false;
          finish();
        }
      });
    });
    server.listen(socketPath);
    await once(server, "listening");
    await chmod(socketPath, 0o600);
    const ready = lifecyclePaths(runtimeRoot, "verify").ready;
    await writeFile(
      ready,
      JSON.stringify({ status: "ready", runId: process.env.CALL_NINA_RUN_ID }),
      { mode: 0o600 },
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () => {
        void requestStop();
      });
    await once(server, "close");
    await rm(socketPath, { force: true });
  } catch (error) {
    // Preserve process/journal proof for bounded external recovery if close hangs.
    void session.application?.close().catch(() => {});
    throw error;
  } finally {
    clearInterval(ownershipTimer);
    await recording;
  }
}

async function stopLocal(suspend) {
  let barrier;
  try {
    barrier = assertVerificationBarrier();
  } catch (error) {
    if (suspend) throw error;
  }
  return stopVerification({ suspend, barrier });
}

try {
  const action = positionals[0];
  let result;
  if (action === "serve-recovery") await serve(true, true);
  else if (action === "serve" || action === "serve-resume") await serve(action === "serve-resume");
  else if (action === "start" || action === "resume") {
    result = await locked(async () => {
      const barrier = assertVerificationBarrier();
      // Fail before spawning whenever the retained journal already violates the
      // current contract. The child still revalidates after ownership is recorded.
      try {
        validateVerificationJournal(
          JSON.parse(await readFile(path.join(verificationRoot, "recovery.json"), "utf8")),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      process.stderr.write(
        "Live verification uses your selected learner data and connected Codex account. AI actions consume usage; use prepare-ai before generation.\n",
      );
      return await startMode({
        mode: "verify",
        verificationContext: { targetRoot: root, barrier },
        runtimeRoot,
        cwd: root,
        command: process.env.DISPLAY
          ? [
              process.execPath,
              "scripts/dev/verify.mjs",
              action === "resume" ? "serve-resume" : "serve",
              ...forwardedOptions,
            ]
          : [
              "xvfb-run",
              "-a",
              process.execPath,
              "scripts/dev/verify.mjs",
              action === "resume" ? "serve-resume" : "serve",
              ...forwardedOptions,
            ],
        timeoutMs: 180000,
      });
    });
    result = { status: result.status, pid: result.pid };
  } else if (
    ["recovery-inventory", "recovery-resume", "recovery-reconcile", "recovery-do"].includes(action)
  ) {
    if (Object.keys(appOptions).length || recoveryAttempt)
      throw failure("VERIFY_RECOVERY_OVERRIDE_FORBIDDEN");
    let input = "";
    if (action !== "recovery-reconcile") {
      for await (const chunk of process.stdin) {
        input += chunk;
        if (Buffer.byteLength(input) > maxRequest) throw failure("VERIFY_REQUEST_LIMIT");
      }
    }
    result = await locked(async () => {
      if (["recovery-do", "recovery-reconcile"].includes(action)) {
        const context = await existingControllerRecovery(recoveryRun, expectedHead);
        if (action === "recovery-reconcile") return reconcileControllerRecovery(context);
        const request = validateRequest(JSON.parse(input));
        assertRecoveryAction(request);
        if (request.action === "stop") return stopVerification(context);
        return requestVerification(request, 300000, context.targetRoot);
      }
      const prepared = await prepareControllerRecovery(
        JSON.parse(input),
        action === "recovery-inventory",
      );
      if (action === "recovery-inventory") return prepared;
      const context = recoveryContext(prepared.receipt, prepared.filename);
      if (prepared.existing) return reconcileControllerRecovery(context);
      const command = [
        process.execPath,
        path.join(root, "scripts/dev/verify.mjs"),
        "serve-recovery",
        "--run",
        context.receipt.run,
        "--expected-head",
        context.receipt.appHead,
        "--attempt",
        context.receipt.id,
      ];
      const state = await startMode({
        mode: "verify",
        runtimeRoot: path.join(context.targetRoot, ".runtime"),
        cwd: root,
        command: process.env.DISPLAY ? command : ["xvfb-run", "-a", ...command],
        verificationContext: context,
        beforeSpawn: () => recordRecoveryIntent(context),
        timeoutMs: 180000,
      });
      await validateRecoveryContext(context);
      return {
        status: state.status,
        receipt: context.receipt.id,
        lifecycleRunId: state.runId,
        appHead: context.receipt.appHead,
        controllerHead: context.receipt.controllerHead,
      };
    });
  } else if (action === "status") result = await statusMode({ mode: "verify", runtimeRoot });
  else if (action === "do") {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > maxRequest) throw failure("VERIFY_REQUEST_LIMIT");
    }
    const request = validateRequest(JSON.parse(input));
    result = ["stop", "suspend"].includes(request.action)
      ? await locked(() => stopLocal(request.action === "suspend"))
      : await requestVerification(request);
  } else if (["stop", "suspend"].includes(action)) {
    result = await locked(() => stopLocal(action === "suspend"));
  } else if (
    [
      "recovery-stop",
      "reconcile-disclosure",
      "reconcile-plugin-refresh",
      "recovery-advance",
    ].includes(action)
  ) {
    let input = "";
    if (action !== "recovery-stop") {
      for await (const chunk of process.stdin) {
        input += chunk;
        if (Buffer.byteLength(input) > maxRequest) throw failure("VERIFY_REQUEST_LIMIT");
      }
    }
    result = await locked(async () => {
      if (action === "recovery-advance") return advanceVerificationBarrier(JSON.parse(input));
      const barrier = coordinatorVerificationBarrier(recoveryRun, expectedHead);
      if (action === "recovery-stop")
        return stopVerification({ targetRoot: barrier.worktree, barrier });
      return reconcileVerificationEffect(barrier, JSON.parse(input), action);
    });
  } else if (["snapshot", "screenshot"].includes(action)) {
    result = await requestVerification({ action });
  } else throw failure("VERIFY_COMMAND_INVALID");
  if (result) {
    process.stdout.write(JSON.stringify(result) + "\n");
    if (
      result.failures?.length ||
      (result.status !== "suspended" &&
        (result.notes?.length ||
          result.pendingAction ||
          result.interruptedActions?.length ||
          result.remainingRecords?.length ||
          result.remainingPreferences?.length))
    )
      process.exitCode = 1;
  }
} catch (error) {
  const code = error.message?.startsWith("LIFECYCLE_APP_ALREADY_RUNNING_OR_RETAINED:")
    ? "VERIFY_APP_ALREADY_RUNNING_OR_RETAINED"
    : error.message?.startsWith("LIFECYCLE_START_LOCKED")
      ? "VERIFY_START_LOCKED"
      : safeCode(error, "VERIFY_COMMAND_FAILED");
  if (code === "VERIFY_COMMAND_FAILED")
    process.stderr.write(
      "Inspect make logs-once ARGS='--scope history --component lifecycle' and .runtime/logs/verify.log for startup/build diagnostics.\n",
    );
  process.stderr.write(code + "\n");
  process.exitCode = 1;
}
