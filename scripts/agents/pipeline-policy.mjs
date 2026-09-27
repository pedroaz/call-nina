#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { developmentConfig, root } from "../lib/config.mjs";

const mode = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(mode)) throw new Error("USE_PLAN_OR_APPLY");
const policy = JSON.parse(readFileSync(path.join(root, ".github/pipeline-policy.json"), "utf8"));
if (
  policy.actionsEnabled !== false ||
  policy.requiredStatusChecks !== null ||
  policy.branch !== "main"
)
  throw new Error("ONLY_PAUSED_PIPELINE_POLICY_SUPPORTED");
const repo = developmentConfig().github.repository;
function api(endpoint, method = "GET", fields = []) {
  const output = execFileSync(
    "gh",
    ["api", `repos/${repo}/${endpoint}`, "--method", method, ...fields],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return output.trim() ? JSON.parse(output) : null;
}
function read() {
  const actions = api("actions/permissions");
  const protection = api(`branches/${policy.branch}/protection`);
  return {
    actionsEnabled: actions.enabled,
    requiredStatusChecks: protection.required_status_checks ?? null,
  };
}
const before = read();
const checks = before.requiredStatusChecks;
if (
  checks &&
  ((checks.contexts ?? []).some((name) => name !== "static") ||
    (checks.checks ?? []).some((check) => check.context !== "static"))
)
  throw new Error("UNEXPECTED_REQUIRED_CHECKS: review the policy before changing protection");
console.log(JSON.stringify({ repository: repo, mode, before, desired: policy }, null, 2));
if (mode === "apply") {
  if (before.actionsEnabled) api("actions/permissions", "PUT", ["-F", "enabled=false"]);
  if (checks) api(`branches/${policy.branch}/protection/required_status_checks`, "DELETE");
  const after = read();
  if (after.actionsEnabled !== false || after.requiredStatusChecks !== null)
    throw new Error("PIPELINE_POLICY_NOT_APPLIED");
  console.log(JSON.stringify({ verified: after }, null, 2));
}
