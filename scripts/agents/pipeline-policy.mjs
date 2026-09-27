#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { developmentConfig, root } from "../lib/config.mjs";
import { metadataDigest } from "./lib/task-metadata.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { "plan-digest": { type: "string" } },
});
const mode = positionals[0] ?? "plan";
if (!["plan", "apply"].includes(mode)) throw new Error("USE_PLAN_OR_APPLY");
const policy = JSON.parse(readFileSync(path.join(root, ".github/pipeline-policy.json"), "utf8"));
const desiredRule = policy.metadataRuleset;
if (
  policy.actionsEnabled !== false ||
  policy.branch !== "main" ||
  policy.squashMergeCommitTitle !== "PR_TITLE" ||
  policy.squashMergeCommitMessage !== "PR_BODY" ||
  desiredRule?.name !== "nina-task-metadata" ||
  desiredRule.target !== "branch" ||
  desiredRule.enforcement !== "active" ||
  desiredRule.bypass_actors.length ||
  JSON.stringify(desiredRule.conditions) !==
    JSON.stringify({ ref_name: { include: ["refs/heads/main"], exclude: [] } }) ||
  JSON.stringify(desiredRule.rules) !==
    JSON.stringify([
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "nina/task-metadata" }],
          strict_required_status_checks_policy: false,
        },
      },
    ])
)
  throw new Error("ONLY_LOCAL_METADATA_POLICY_SUPPORTED");
const repo = developmentConfig().github.repository;
function api(endpoint, { method = "GET", body, optional = false, paginate = false } = {}) {
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/${repo}${endpoint ? `/${endpoint}` : ""}`,
      "--method",
      method,
      ...(body ? ["--input", "-"] : []),
      ...(paginate ? ["--paginate", "--jq", "tojson"] : []),
    ],
    {
      cwd: root,
      encoding: "utf8",
      input: body ? JSON.stringify(body) : undefined,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  const data = result.stdout.trim()
    ? paginate && result.status === 0
      ? result.stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : JSON.parse(result.stdout)
    : null;
  if (result.status !== 0) {
    if (optional && String(data?.status) === "404") return null;
    throw new Error(
      `GITHUB_POLICY_READ_OR_WRITE_FAILED: ${endpoint} (${data?.status ?? result.status})`,
    );
  }
  return paginate ? data.flat() : data;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function same(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function rulePayload(rule) {
  const result = Object.fromEntries(
    ["name", "target", "enforcement", "bypass_actors", "conditions", "rules"].map((key) => [
      key,
      rule[key],
    ]),
  );
  // GitHub may render the optional app binding as null. Never send an integration_id.
  for (const item of result.rules ?? [])
    for (const check of item.parameters?.required_status_checks ?? [])
      if (check.integration_id === null) delete check.integration_id;
  return result;
}
function ownedRule(rulesets) {
  const found = rulesets.filter((rule) => rule.name === desiredRule.name);
  if (found.length > 1) throw new Error("AMBIGUOUS_METADATA_RULESET_OWNERSHIP");
  const rule = found[0];
  if (!rule) return null;
  const payload = rulePayload(structuredClone(rule));
  if (
    rule.source_type !== "Repository" ||
    rule.source !== repo ||
    payload.target !== "branch" ||
    payload.bypass_actors?.length !== 0 ||
    !same(payload.conditions, desiredRule.conditions) ||
    payload.rules?.length !== 1 ||
    payload.rules[0].type !== "required_status_checks"
  )
    throw new Error("UNKNOWN_OWNED_RULESET_CONTENT: reconcile ownership manually");
  const parameters = payload.rules[0].parameters;
  if (
    !parameters ||
    Object.keys(payload.rules[0]).some((key) => !["type", "parameters"].includes(key)) ||
    Object.keys(parameters).some(
      (key) => !["required_status_checks", "strict_required_status_checks_policy"].includes(key),
    ) ||
    !same(parameters.required_status_checks, desiredRule.rules[0].parameters.required_status_checks)
  )
    throw new Error("UNKNOWN_OWNED_RULE_ADDITIONS: refusing to overwrite checks or app bindings");
  return rule;
}
function read() {
  const repository = api("");
  const summaries = api("rulesets?includes_parents=true&per_page=100", { paginate: true });
  const rulesets = summaries.map((rule) => api(`rulesets/${rule.id}`)).sort((a, b) => a.id - b.id);
  ownedRule(rulesets);
  return {
    // Preserve all merge-policy fields, without volatile repository counters.
    repository: Object.fromEntries(
      Object.entries(repository).filter(([key]) =>
        /^(?:allow_|squash_merge_|merge_commit_|delete_branch_on_merge|use_squash_pr_title_as_default)/.test(
          key,
        ),
      ),
    ),
    actions: api("actions/permissions"),
    protection: api(`branches/${policy.branch}/protection`, { optional: true }),
    rulesets,
  };
}
function plan(before) {
  const operations = [];
  const desired = {
    squash_merge_commit_title: policy.squashMergeCommitTitle,
    squash_merge_commit_message: policy.squashMergeCommitMessage,
  };
  if (Object.entries(desired).some(([key, value]) => before.repository[key] !== value))
    operations.push({
      endpoint: "",
      method: "PATCH",
      before: Object.fromEntries(Object.keys(desired).map((key) => [key, before.repository[key]])),
      body: desired,
    });
  if (before.actions.enabled !== false)
    operations.push({
      endpoint: "actions/permissions",
      method: "PUT",
      before: { enabled: before.actions.enabled },
      body: { enabled: false },
    });
  const owned = ownedRule(before.rulesets);
  if (!owned || !same(rulePayload(structuredClone(owned)), desiredRule))
    operations.push({
      endpoint: owned ? `rulesets/${owned.id}` : "rulesets",
      method: owned ? "PUT" : "POST",
      before: owned ? rulePayload(structuredClone(owned)) : null,
      body: desiredRule,
    });
  return operations;
}
function preserved(before, after) {
  const omitOwned = (snapshot) => ({
    repository: Object.fromEntries(
      Object.entries(snapshot.repository).filter(
        ([key]) =>
          ![
            "squash_merge_commit_title",
            "squash_merge_commit_message",
            "use_squash_pr_title_as_default",
          ].includes(key),
      ),
    ),
    actions: Object.fromEntries(
      Object.entries(snapshot.actions).filter(([key]) => key !== "enabled"),
    ),
    protection: snapshot.protection,
    rulesets: snapshot.rulesets.filter((rule) => rule.name !== desiredRule.name),
  });
  return same(omitOwned(before), omitOwned(after));
}
const before = read();
const operations = plan(before);
const digest = metadataDigest(canonical({ before, policy }));
console.log(
  JSON.stringify(
    {
      repository: repo,
      mode,
      digest,
      operations,
      unchanged: {
        classicProtection: before.protection,
        unrelatedRulesets: before.rulesets.filter((rule) => rule.name !== desiredRule.name),
      },
      limitation:
        "No hosted automation: arbitrary UI/raw-gh PR edits do not refresh metadata status; coordinator merge always freshly validates. Settings APIs do not offer atomic compare-and-swap.",
    },
    null,
    2,
  ),
);
if (mode === "apply") {
  if (values["plan-digest"] !== digest)
    throw new Error(
      "REVIEWED_PLAN_DIGEST_REQUIRED: run plan, review the diff, then apply --plan-digest SHA",
    );
  if (!same(read(), before)) throw new Error("POLICY_DRIFT_BEFORE_APPLY");
  for (const operation of operations) api(operation.endpoint, operation);
  const after = read();
  if (plan(after).length || !preserved(before, after))
    throw new Error("POLICY_READBACK_MISMATCH: reconcile without weakening unrelated settings");
  console.log(JSON.stringify({ verified: true, after }, null, 2));
}
