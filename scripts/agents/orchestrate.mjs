#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
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
} from "./lib/orchestration.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(
    ["run", "task", "worktree", "baseline", "coordinator", "role"].map((name) => [
      name,
      { type: "string" },
    ]),
  ),
});
const command = positionals[0] ?? "start";
const bindingFile = path.join(stateRoot, "run.json");
const help = `Call Nina Orca coordination (Git owns integration):
  No arguments: start the interactive coordinator using its role settings.
  roles | doctor
  start --role product-owner|coordinator  Interactive main agent, using its role settings
  bind --run RUN --coordinator HANDLE
  task                     Assignment JSON on stdin: run, role, title, brief,
                           owned:[], acceptance:[], exclusions:[], skills:[], deps:[], issue?, commit (reviewer/verifier)
  launch --run RUN --task TASK --worktree PATH --baseline COMMIT
  verify-enter --run RUN --worktree PATH
  verify-leave --run RUN
  finish --run RUN
Create worktrees from committed baselines using Orca. Integrate completed worker
commits using git in the integration checkout. Read the installed Orca skill for
messages, ownership, recovery and release. Never retry an uncertain dispatch.
Settings and executable overrides: development.json. No app is launched here.`;
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
function main() {
  if (command === "help") return { help };
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
    const config = role(mainRole);
    available(config, modelCatalog());
    console.log(
      JSON.stringify({
        role: config.name,
        model: config.model,
        effort: config.model_reasoning_effort,
      }),
    );
    const result = spawnSync(
      developmentConfig().executables.codex ?? "codex",
      [
        "--model",
        config.model,
        "-c",
        `model_reasoning_effort=${JSON.stringify(config.model_reasoning_effort)}`,
        "-c",
        `developer_instructions=${JSON.stringify(config.developer_instructions)}`,
        ...(mainRole === "coordinator"
          ? [
              "Start coordinating approved Call Nina work now. Read the orchestration skill, " +
                "reconcile existing Run/Task/Dispatch and GitHub state, and resume existing work " +
                "before claiming approved Ready tasks. Establish proven coordinator ownership " +
                "before dispatching workers; do not duplicate an active coordinator. Preserve " +
                "uncommitted changes and use an explicit committed baseline for workers. " +
                "If no approved work is actionable or startup is blocked, report the reason. " +
                "Do not enable recurring intake or publish releases.",
            ]
          : []),
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("MAIN_AGENT_EXITED_WITH_ERROR");
    return { role: config.name, exited: true };
  }
  return locked(() => {
    if (command === "bind") {
      tasks(values.run);
      if (!values.coordinator) throw new Error("EXPLICIT_COORDINATOR_REQUIRED");
      if (
        existsSync(bindingFile) &&
        (load(bindingFile).run !== values.run || load(bindingFile).integrationRoot !== root)
      )
        throw new Error("OTHER_COORDINATOR_BOUND: resume existing work first");
      const current = orca(["orchestration", "run-show", "--id", values.run]).run;
      if (current.coordinator_handle !== values.coordinator)
        throw new Error("COORDINATOR_MISMATCH");
      replace(bindingFile, {
        run: values.run,
        coordinator: values.coordinator,
        generation: current.consumer_generation,
        integrationRoot: root,
      });
      return { bound: true, run: values.run };
    }
    if (command === "task") {
      const input = JSON.parse(readFileSync(0, "utf8"));
      const binding = bound(input.run);
      const config = role(input.role);
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
      const config = role(spec.role);
      const limits = developmentConfig().workers;
      if (
        active.length >= limits.maximum ||
        (writers.has(spec.role) &&
          active.filter((item) => writers.has(assignment(item).role)).length >= limits.writers)
      )
        throw new Error("WORKER_LIMIT");
      const target = realpathSync(values.worktree);
      cleanWorktree(target);
      const baseline = git(["rev-parse", "--verify", `${values.baseline}^{commit}`]).trim();
      if (spec.commit && spec.commit !== baseline) throw new Error("ASSIGNMENT_COMMIT_MISMATCH");
      if (git(["rev-parse", "HEAD"], target).trim() !== baseline)
        throw new Error("WORKTREE_BASELINE_MISMATCH");
      if (writers.has(spec.role) && target === root) throw new Error("ISOLATED_WRITER_REQUIRED");
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
      if (
        result.launch?.effective?.model !== config.model ||
        result.launch?.effective?.effort !== config.model_reasoning_effort
      )
        throw new Error("LAUNCH_PREFERENCES_UNCONFIRMED: reconcile saved receipt");
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
