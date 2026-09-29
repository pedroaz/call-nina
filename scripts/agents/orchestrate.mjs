#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parse } from "smol-toml";
import { taskBranch } from "./lib/task-metadata.mjs";
import {
  assignmentPolicy,
  assignmentSettings,
  assertEffectiveSettings,
} from "./lib/assignment-policy.mjs";
import { developmentConfig } from "../lib/config.mjs";
import {
  root,
  stateRoot,
  verificationGate,
  git,
  role,
  writers,
  tasks,
  orca,
  resolveOrca,
  load,
  save,
  replace,
  locked,
  assertNoVerification,
  assertWriterCheckout,
} from "./lib/orchestration.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    idle: { type: "boolean" },
    ...Object.fromEntries(
      ["run", "task", "worktree", "baseline", "coordinator", "role"].map((name) => [
        name,
        { type: "string" },
      ]),
    ),
  },
});
const command = positionals[0] ?? "start";
const bindingFile = path.join(stateRoot, "run.json");
const startupFile = path.join(stateRoot, "coordinator-start.json");
const help = `Call Nina Orca coordination (Git owns integration):
  No arguments: start an Orca-managed coordinator using its role settings.
  roles | policy | doctor
  select                   Read-only selection check: role + execution JSON on stdin
  start [--idle]            Managed coordinator; --idle delivers policy then waits for user work
  start --role product-owner  Interactive planning agent in this terminal
  bind --run RUN --coordinator HANDLE
  task                     Assignment JSON on stdin: run, role, title, brief,
                           owned:[], acceptance:[], exclusions:[], skills:[], deps:[], issue + branch (writers), commit (reviewer/verifier),
                           execution:{risk,model,effort,rationale,escalation?}; see policy
  launch --run RUN --task TASK --worktree PATH --baseline COMMIT
  verify-enter --run RUN --worktree PATH
  verify-leave --run RUN
  finish --run RUN
Create worktrees from committed baselines using Orca. Integrate completed worker
commits using git in the integration checkout. Read the installed Orca skill for
messages, ownership, recovery and release. Never retry an uncertain dispatch.
Settings and executable overrides: development.json. The managed coordinator uses
Orca's bare Codex launcher and project model/effort defaults. An existing owned
Codex terminal receives instructions in this command's result, without a new agent.
Retained startup receipts block another launch until explicitly reconciled.
No Call Nina app is launched here.`;
function bound(run) {
  if (!existsSync(bindingFile)) throw new Error("RUN_NOT_BOUND");
  const binding = load(bindingFile);
  if (binding.run !== run || binding.integrationRoot !== root)
    throw new Error("RUN_OR_CHECKOUT_MISMATCH");
  const current = orca(["orchestration", "run-show", "--id", run]).run;
  if (
    current.coordinator_handle !== binding.coordinator ||
    current.consumer_generation !== binding.generation
  )
    throw new Error("COORDINATOR_BINDING_CHANGED: reconcile and explicitly rebind");
  return binding;
}
function assignment(task) {
  const match = /^NINA_ASSIGNMENT=([^\n]+)\n/.exec(task.spec ?? "");
  if (!match) throw new Error("TASK_NOT_CREATED_BY_ROLE_HELPER");
  return JSON.parse(match[1]);
}
function receiptFile(task) {
  if (!/^task_[\w-]+$/.test(task)) throw new Error("TASK_ID_INVALID");
  return path.join(stateRoot, "launches", task + ".json");
}
function cleanWorktree(target) {
  const registered = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .includes(`worktree ${target}`);
  if (!registered || git(["status", "--porcelain"], target).trim())
    throw new Error("CLEAN_REGISTERED_WORKTREE_REQUIRED");
}
function modelCatalog() {
  return JSON.parse(
    execFileSync(developmentConfig().executables.codex ?? "codex", ["debug", "models"], {
      cwd: root,
      encoding: "utf8",
    }),
  ).models;
}
function available(config, catalog) {
  if (
    !catalog
      ?.find((item) => item.slug === config.model)
      ?.supported_reasoning_levels?.some((item) => item.effort === config.model_reasoning_effort)
  )
    throw new Error(`ROLE_MODEL_UNAVAILABLE: ${config.name}`);
}
function fingerprint(target) {
  const journal = path.join(target, ".runtime/verification/recovery.json");
  return existsSync(journal)
    ? createHash("sha256").update(readFileSync(journal)).digest("hex")
    : null;
}
function verificationStopped(target) {
  const result = JSON.parse(
    execFileSync(process.execPath, [path.join(target, "scripts/dev/verify.mjs"), "status"], {
      cwd: target,
      encoding: "utf8",
    }),
  );
  return result.status === "stopped";
}
function repositoryIdentity(target) {
  if (typeof target !== "string" || !path.isAbsolute(target))
    throw new Error("COORDINATOR_REPOSITORY_UNKNOWN");
  return realpathSync(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], target).trim(),
  );
}
function ownedCoordinatorTerminal() {
  const handle = process.env.ORCA_TERMINAL_HANDLE;
  if (!handle?.startsWith("term_"))
    throw new Error("OWNED_ORCA_TERMINAL_REQUIRED: never copy another session's identity");
  const terminal = orca(["terminal", "show", "--terminal", handle]).terminal;
  if (
    terminal?.handle !== handle ||
    terminal.agentIdentity !== "codex" ||
    terminal.connected !== true ||
    terminal.writable !== true ||
    terminal.orphaned !== false ||
    !terminal.incarnationId ||
    repositoryIdentity(terminal.worktreePath) !== repositoryIdentity(root)
  )
    throw new Error("OWNED_CODEX_TERMINAL_UNCONFIRMED");
  return terminal;
}
function assertNoCoordinator() {
  // Refuse even malformed/stale receipts: absence of a live observation is not
  // proof that the previous agent stopped. All linked checkouts share this lock.
  if (existsSync(bindingFile))
    throw new Error("COORDINATOR_ALREADY_BOUND: inspect run.json and resume its owner");
  if (existsSync(startupFile))
    throw new Error("COORDINATOR_START_RETAINED: inspect coordinator-start.json; do not relaunch");
  const common = repositoryIdentity(root);
  const terminals = new Map();
  const checkouts = git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice(9));
  for (const checkout of checkouts) {
    const inventory = orca([
      "terminal",
      "list",
      "--worktree",
      `path:${checkout}`,
      "--limit",
      "1000",
    ]);
    if (
      !Array.isArray(inventory.terminals) ||
      inventory.truncated !== false ||
      inventory.totalCount !== inventory.terminals.length ||
      !Array.isArray(inventory.hostScope?.hostIds) ||
      !inventory.hostScope.hostIds.length ||
      !Array.isArray(inventory.hostScope?.omittedHostIds) ||
      inventory.hostScope.omittedHostIds.length
    )
      throw new Error("COORDINATOR_INVENTORY_INCOMPLETE: inspect repository terminal inventory");
    for (const terminal of inventory.terminals) {
      if (!terminal.handle || repositoryIdentity(terminal.worktreePath) !== common)
        throw new Error("COORDINATOR_INVENTORY_UNKNOWN");
      terminals.set(terminal.handle, terminal);
      if (
        terminal.agentIdentity === "codex" &&
        terminal.handle !== process.env.ORCA_TERMINAL_HANDLE
      )
        throw new Error(
          `COORDINATOR_TERMINAL_EXISTS: inspect ${terminal.handle}; do not launch another agent`,
        );
    }
  }
  let cursor;
  const cursors = new Set();
  do {
    const page = orca(["orchestration", "run-list", ...(cursor ? ["--cursor", cursor] : [])]);
    if (!Array.isArray(page.runs) || !("nextCursor" in page))
      throw new Error("COORDINATOR_RUNS_UNKNOWN");
    for (const run of page.runs) {
      if (run.legacy === 1 && run.coordinator_handle === null) continue;
      if (!run.coordinator_handle) throw new Error("COORDINATOR_RUN_OWNER_UNKNOWN");
      // Inventory absence never proves exit or repository scope. Resolve every
      // remaining Run owner; a stale unscoped handle remains an explicit blocker.
      let terminal;
      try {
        terminal =
          terminals.get(run.coordinator_handle) ??
          orca(["terminal", "show", "--terminal", run.coordinator_handle]).terminal;
      } catch {
        throw new Error(
          `COORDINATOR_RUN_UNRESOLVED: inspect ${run.id} / ${run.coordinator_handle}; scope and exit cannot be proven; startup remains blocked`,
        );
      }
      if (!terminal || terminal.handle !== run.coordinator_handle)
        throw new Error(`COORDINATOR_RUN_OWNER_UNKNOWN: inspect ${run.id}`);
      if (terminal.connected === false && historicalRunSettled(run)) continue;
      if (repositoryIdentity(terminal.worktreePath) === common)
        throw new Error(
          `COORDINATOR_RUN_EXISTS: inspect ${run.id}; do not create another coordinator`,
        );
    }
    cursor = page.nextCursor;
    if (cursor !== null && (typeof cursor !== "string" || !cursor || cursors.has(cursor)))
      throw new Error("COORDINATOR_RUNS_UNKNOWN");
    cursors.add(cursor);
  } while (cursor);
}
function historicalRunSettled(run) {
  const { wait } = orca([
    "terminal",
    "wait",
    "--terminal",
    run.coordinator_handle,
    "--for",
    "exit",
    "--timeout-ms",
    "1",
  ]);
  if (
    wait?.handle !== run.coordinator_handle ||
    wait.condition !== "exit" ||
    wait.satisfied !== true ||
    wait.status !== "exited"
  )
    return false;
  if (tasks(run.id).some((task) => !["completed", "failed"].includes(task.status))) return false;
  let cursor;
  const cursors = new Set();
  do {
    const result = orca([
      "orchestration",
      "worker-list",
      "--run",
      run.id,
      "--include-remote",
      ...(cursor ? ["--cursor", cursor] : []),
    ]);
    if (
      !Array.isArray(result.workers) ||
      result.scope?.run !== run.id ||
      typeof result.page?.hasMore !== "boolean" ||
      result.workers.some(
        (worker) =>
          worker.terminalState !== "released" || worker.resource?.releaseState !== "released",
      )
    )
      return false;
    if (!result.page.hasMore) return true;
    cursor = result.page.nextCursor;
    if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) return false;
    cursors.add(cursor);
  } while (cursor);
  return false;
}
function coordinatorDeliveryPhase(send, terminal) {
  if (send?.accepted === false) return "rejected";
  const prompt = send?.prompt;
  if (
    send?.accepted !== true ||
    send.handle !== terminal.handle ||
    typeof prompt?.requestId !== "string" ||
    !prompt.requestId ||
    prompt.provider !== "codex" ||
    prompt.processIncarnation !== terminal.incarnationId ||
    !["supported", "permission"].includes(prompt.observation) ||
    !Array.isArray(prompt.stages) ||
    prompt.stages.some((stage) => !["input_accepted", "turn_started"].includes(stage)) ||
    !prompt.stages.includes("input_accepted")
  )
    return "unconfirmed";
  return prompt.stages.includes("turn_started") ? "turn-started" : "input-accepted";
}
function startCoordinator() {
  assertNoCoordinator();
  const config = role("coordinator");
  const project = parse(readFileSync(path.join(root, ".codex/config.toml"), "utf8"));
  if (
    project.model !== config.model ||
    project.model_reasoning_effort !== config.model_reasoning_effort
  )
    throw new Error(
      "COORDINATOR_DEFAULTS_MISMATCH: align project defaults with the coordinator role",
    );
  available(config, modelCatalog());
  const cli = resolveOrca();
  const instructions =
    config.developer_instructions +
    "\n\n" +
    `Use ${config.model} at ${config.model_reasoning_effort} effort; verify effective settings before any Run mutation or dispatch.\n` +
    "Read the orchestration skill and reconcile existing Run/Task/Dispatch and GitHub state. " +
    "Before creating or binding a Run, prove that your own ORCA_TERMINAL_HANDLE matches the exact " +
    "startup receipt and live Orca terminal; never copy credentials or use focus-based identity. " +
    "If another coordinator exists, stop and report it without rebinding or dispatching. " +
    "Preserve uncommitted changes and use an explicit committed baseline for workers. " +
    "Do not enable recurring intake or publish releases.\n" +
    (values.idle
      ? "Idle startup: acknowledge these instructions and wait for the user. Do not create or bind a Run, claim work, or launch workers until the user requests work."
      : "Start coordinating approved Call Nina work now. Resume existing work before claiming Ready tasks; report when no approved work is actionable or startup is blocked.");
  const owned = process.env.ORCA_TERMINAL_HANDLE ? ownedCoordinatorTerminal() : null;
  const startup = {
    version: 1,
    attempt: randomUUID(),
    integrationRoot: root,
    cli,
    role: config.name,
    model: config.model,
    effort: config.model_reasoning_effort,
    idle: Boolean(values.idle),
    phase: "reserved",
  };
  save(startupFile, startup);
  const record = (phase, fields = {}) => {
    Object.assign(startup, fields, { phase });
    replace(startupFile, startup);
  };
  // Keep exact success/error envelopes and request IDs, including nonzero CLI
  // exits. Reserve before each call so even a crash cannot authorize a retry.
  const call = (stage, args) => {
    record(`${stage}-pending`);
    const result = spawnSync(cli, [...args, "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    let receipt;
    try {
      receipt = JSON.parse(result.stdout);
    } catch {
      /* Unknown transport outcome. */
    }
    save(path.join(stateRoot, "coordinator-starts", startup.attempt, `${stage}.json`), {
      status: result.status,
      signal: result.signal,
      error: result.error?.code ?? null,
      receipt: receipt ?? null,
    });
    if (stage === "delivery" && receipt?.ok === true && receipt.result?.send?.accepted === false) {
      record("delivery-rejected");
      throw new Error(
        "COORDINATOR_DELIVERY_REJECTED: inspect retained receipt; do not relaunch or resend",
      );
    }
    if (result.error || result.status !== 0 || receipt?.ok !== true)
      throw new Error(
        `COORDINATOR_${stage.toUpperCase()}_UNCONFIRMED: inspect retained receipt; do not relaunch or resend`,
      );
    return receipt.result;
  };
  if (owned) {
    // The current managed agent consumes this result itself. Never start a
    // nested Codex or inject a second prompt into its already-running turn.
    record("instructions-returned", { terminal: owned.handle, incarnation: owned.incarnationId });
    return { role: config.name, terminal: owned.handle, reused: true, instructions };
  }
  // Only the bare agent command selects Orca's supported managed launch path.
  // Appending model/-c arguments starts a shell command without launch authority.
  const created = call("creation", [
    "terminal",
    "create",
    "--worktree",
    `path:${root}`,
    "--title",
    "Call Nina coordinator",
    "--focus",
    "--command",
    "codex",
  ]);
  const handle = created.terminal?.handle;
  if (!handle?.startsWith("term_") || created.terminal.isReattach === true)
    throw new Error("COORDINATOR_CREATION_UNCONFIRMED: inspect retained creation receipt");
  record("created", { terminal: handle });
  // terminal.create returns a placement receipt, not terminal.show's live
  // identity fields. Resolve that exact new handle before readiness/delivery.
  const { terminal } = call("identity", ["terminal", "show", "--terminal", handle]);
  if (
    terminal?.handle !== handle ||
    !terminal.incarnationId ||
    terminal.agentIdentity !== "codex" ||
    terminal.connected !== true ||
    terminal.writable !== true ||
    realpathSync(terminal.worktreePath) !== root
  )
    throw new Error("COORDINATOR_IDENTITY_UNCONFIRMED: inspect retained identity receipt");
  record("identified", { incarnation: terminal.incarnationId });
  const readiness = call("readiness", [
    "terminal",
    "wait",
    "--terminal",
    terminal.handle,
    "--for",
    "tui-idle",
    "--timeout-ms",
    "60000",
  ]);
  if (
    readiness.wait?.satisfied !== true ||
    readiness.wait.handle !== handle ||
    readiness.wait.condition !== "tui-idle"
  )
    throw new Error("COORDINATOR_NOT_READY: inspect retained readiness receipt; do not relaunch");
  const delivery = call("delivery", [
    "terminal",
    "send",
    "--terminal",
    terminal.handle,
    "--text",
    instructions,
    "--enter",
    "--wait-submit",
    "1",
  ]);
  const phase = coordinatorDeliveryPhase(delivery.send, terminal);
  if (phase === "unconfirmed" || phase === "rejected")
    throw new Error(
      "COORDINATOR_DELIVERY_UNCONFIRMED: inspect retained delivery receipt; do not resend",
    );
  record(phase);
  return {
    role: config.name,
    terminal: terminal.handle,
    phase,
    delivery,
    ...(phase === "input-accepted"
      ? {
          notice:
            "Input accepted; turn start remains unconfirmed. Inspect this terminal; do not resend or relaunch.",
        }
      : {}),
  };
}
function main() {
  if (command === "help") return { help };
  if (command === "policy") return assignmentPolicy;
  if (command === "select") {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const selected = assignmentSettings(input);
    return { role: role(input.role).name, execution: input.execution, ...selected };
  }
  if (["roles", "doctor"].includes(command)) {
    const configs = readdirSync(path.join(root, ".codex/agents"))
      .filter((n) => n.endsWith(".toml"))
      .map((n) => role(n.slice(0, -5)));
    const roles = configs.map(({ name, model, model_reasoning_effort }) => ({
      name,
      model,
      effort: model_reasoning_effort,
    }));
    if (command === "roles") return roles;
    const catalog = modelCatalog();
    configs.forEach((config) => available(config, catalog));
    const runtime = orca(["status"]);
    return { cli: resolveOrca(), runtime, roles, configuration: developmentConfig() };
  }
  if (command === "start") {
    const mainRole = values.role ?? "coordinator";
    if (!["product-owner", "coordinator"].includes(mainRole)) throw new Error("MAIN_ROLE_REQUIRED");
    if (mainRole === "coordinator") return locked(startCoordinator);
    if (values.idle) throw new Error("IDLE_REQUIRES_COORDINATOR");
    const config = role(mainRole);
    available(config, modelCatalog());
    const result = spawnSync(
      developmentConfig().executables.codex ?? "codex",
      [
        "--model",
        config.model,
        "-c",
        `model_reasoning_effort=${JSON.stringify(config.model_reasoning_effort)}`,
        "-c",
        `developer_instructions=${JSON.stringify(config.developer_instructions)}`,
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("MAIN_AGENT_EXITED_WITH_ERROR");
    return { role: config.name, exited: true };
  }
  return locked(() => {
    if (command === "bind") {
      if (!values.coordinator) throw new Error("EXPLICIT_COORDINATOR_REQUIRED");
      // Never let --coordinator authenticate its own claim, or let Orca's implicit
      // focus fallback select a user-owned sibling terminal.
      const terminal = ownedCoordinatorTerminal();
      if (terminal.handle !== values.coordinator) throw new Error("COORDINATOR_MISMATCH");
      const caller = orca(["orchestration", "run-current"]).run;
      const current = orca(["orchestration", "run-show", "--id", values.run]).run;
      if (
        !caller ||
        caller.id !== values.run ||
        current?.id !== values.run ||
        caller.coordinator_handle !== terminal.handle ||
        current.coordinator_handle !== terminal.handle ||
        !Number.isSafeInteger(current.consumer_generation) ||
        current.consumer_generation < 1 ||
        caller.consumer_generation !== current.consumer_generation
      )
        throw new Error("LIVE_COORDINATOR_REQUIRED");
      if (existsSync(bindingFile)) {
        const binding = load(bindingFile);
        if (
          binding.run !== values.run ||
          binding.coordinator !== terminal.handle ||
          binding.generation !== current.consumer_generation ||
          repositoryIdentity(binding.integrationRoot) !== repositoryIdentity(root)
        )
          throw new Error(
            "OTHER_COORDINATOR_BOUND: inspect existing binding; never rebind implicitly",
          );
        return { bound: true, unchanged: true, run: values.run };
      }
      if (existsSync(startupFile)) {
        const startup = load(startupFile);
        if (
          startup.version !== 1 ||
          startup.integrationRoot !== root ||
          startup.terminal !== terminal.handle ||
          startup.incarnation !== terminal.incarnationId ||
          !["instructions-returned", "input-accepted", "turn-started"].includes(startup.phase)
        )
          throw new Error("COORDINATOR_START_UNCONFIRMED: inspect retained startup receipts");
      }
      save(bindingFile, {
        run: values.run,
        coordinator: terminal.handle,
        generation: current.consumer_generation,
        integrationRoot: root,
      });
      return { bound: true, run: values.run };
    }
    if (command === "task") {
      const input = JSON.parse(readFileSync(0, "utf8"));
      const binding = bound(input.run);
      const config = { ...role(input.role), ...assignmentSettings(input) };
      if (["coordinator", "product-owner"].includes(input.role))
        throw new Error("MAIN_ROLE_CANNOT_BE_WORKER");
      for (const key of ["title", "brief"])
        if (typeof input[key] !== "string" || !input[key].trim())
          throw new Error("ASSIGNMENT_TEXT_REQUIRED");
      for (const key of ["owned", "acceptance", "exclusions", "skills", "deps"])
        if (!Array.isArray(input[key]) || input[key].some((item) => typeof item !== "string"))
          throw new Error(`ASSIGNMENT_ARRAY_REQUIRED: ${key}`);
      if (!input.acceptance.length || (writers.has(input.role) && !input.owned.length))
        throw new Error("ASSIGNMENT_SCOPE_REQUIRED");
      if (writers.has(input.role)) {
        if (!Number.isSafeInteger(input.issue) || input.issue < 1)
          throw new Error("WRITER_TASK_ISSUE_REQUIRED");
        taskBranch(input.branch, input.issue);
      }
      if (["reviewer", "verifier"].includes(input.role)) {
        if (!input.commit) throw new Error("REVIEW_OR_VERIFICATION_COMMIT_REQUIRED");
        input.commit = git(["rev-parse", "--verify", `${input.commit}^{commit}`]).trim();
      }
      const spec = `NINA_ASSIGNMENT=${JSON.stringify(input)}\n\n${config.developer_instructions}\n\n${input.brief}`;
      return orca([
        "orchestration",
        "task-create",
        "--from",
        binding.coordinator,
        "--run",
        input.run,
        "--task-title",
        input.title,
        "--spec",
        spec,
        "--deps",
        JSON.stringify(input.deps),
      ]);
    }
    const binding = bound(values.run);
    const all = tasks(values.run);
    const active = all.filter((item) => item.status === "dispatched");
    if (command === "launch") {
      const task = all.find((item) => item.id === values.task);
      if (!task || task.status !== "ready") throw new Error("TASK_NOT_READY");
      const spec = assignment(task);
      const config = { ...role(spec.role), ...assignmentSettings(spec) };
      const limits = developmentConfig().workers;
      if (
        active.length >= limits.maximum ||
        (writers.has(spec.role) &&
          active.filter((item) => writers.has(assignment(item).role)).length >= limits.writers)
      )
        throw new Error("WORKER_LIMIT");
      const target = realpathSync(values.worktree);
      cleanWorktree(target);
      if (writers.has(spec.role)) assertWriterCheckout(target, spec);
      const baseline = git(["rev-parse", "--verify", `${values.baseline}^{commit}`]).trim();
      if (spec.commit && spec.commit !== baseline) throw new Error("ASSIGNMENT_COMMIT_MISMATCH");
      if (git(["rev-parse", "HEAD"], target).trim() !== baseline)
        throw new Error("WORKTREE_BASELINE_MISMATCH");
      if (spec.role === "verifier") {
        if (
          !existsSync(verificationGate) ||
          load(verificationGate).worktree !== target ||
          load(verificationGate).run !== values.run
        )
          throw new Error("VERIFICATION_GATE_REQUIRED");
      } else assertNoVerification(target);
      if (
        active.some(
          (item) =>
            !existsSync(receiptFile(item.id)) || load(receiptFile(item.id)).target === target,
        )
      )
        throw new Error("WORKTREE_BUSY_OR_UNKNOWN");
      available(config, modelCatalog());
      save(receiptFile(task.id), {
        run: values.run,
        task: task.id,
        target,
        baseline,
        role: spec.role,
        execution: spec.execution,
      });
      const result = orca([
        "orchestration",
        "worker-start",
        "--run",
        values.run,
        "--from",
        binding.coordinator,
        "--task",
        task.id,
        "--worktree",
        `path:${target}`,
        "--agent",
        "codex",
        "--model",
        config.model,
        "--effort",
        config.model_reasoning_effort,
      ]);
      save(receiptFile(task.id) + ".receipt", result);
      assertEffectiveSettings(result, config);
      return result;
    }
    if (command === "verify-enter") {
      const target = realpathSync(values.worktree);
      cleanWorktree(target);
      if (target === root) throw new Error("DEDICATED_VERIFICATION_WORKTREE_REQUIRED");
      if (existsSync(verificationGate)) throw new Error("VERIFICATION_ALREADY_RESERVED");
      if (
        active.some(
          (item) =>
            !existsSync(receiptFile(item.id)) || load(receiptFile(item.id)).target === target,
        )
      )
        throw new Error("VERIFICATION_WORKTREE_BUSY_OR_UNKNOWN");
      if (!verificationStopped(target)) throw new Error("VERIFICATION_ALREADY_RUNNING");
      save(verificationGate, {
        run: values.run,
        worktree: target,
        head: git(["rev-parse", "HEAD"], target).trim(),
        initialRecovery: fingerprint(target),
      });
      return { verification: "reserved", worktree: target };
    }
    if (command === "verify-leave") {
      if (!existsSync(verificationGate)) return { verification: "not-held" };
      const gate = load(verificationGate);
      if (gate.run !== values.run || !verificationStopped(gate.worktree))
        throw new Error("VERIFICATION_STILL_OWNED");
      if (fingerprint(gate.worktree) && fingerprint(gate.worktree) !== gate.initialRecovery) {
        const recovery = load(path.join(gate.worktree, ".runtime/verification/recovery.json"));
        if (
          recovery.records?.length ||
          Object.keys(recovery.preferences ?? {}).length ||
          recovery.notes?.length
        )
          throw new Error("VERIFICATION_CLEANUP_REQUIRED");
      }
      rmSync(verificationGate);
      return { verification: "released" };
    }
    if (command === "finish") {
      if (
        existsSync(verificationGate) ||
        all.some((item) => ["dispatched", "ready", "pending"].includes(item.status))
      )
        throw new Error("RUN_HAS_UNFINISHED_WORK");
      rmSync(bindingFile);
      return { detached: true, run: values.run };
    }
    throw new Error("UNKNOWN_COMMAND");
  });
}
try {
  console.log(JSON.stringify(main(), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
