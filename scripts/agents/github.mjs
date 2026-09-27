#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { developmentConfig, root } from "../lib/config.mjs";
import { locked, stateRoot, load, tasks } from "./lib/orchestration.mjs";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(
    ["issue", "pr", "status", "run", "review-task", "verification", "verification-commit"].map(
      (key) => [key, { type: "string" }],
    ),
  ),
});
const command = positionals[0] ?? "help";
const config = developmentConfig();
const repo = config.github.repository;
const states = ["Backlog", "Ready", "In progress", "Review", "Blocked", "Done"];
function gh(args, json = true) {
  const output = execFileSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return json
    ? args.includes("--paginate")
      ? output
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : JSON.parse(output)
    : output.trim();
}
function numeric(value) {
  if (!/^[1-9]\d*$/.test(value ?? "")) throw new Error("POSITIVE_NUMBER_REQUIRED");
  return value;
}
function project() {
  if (!config.github.projectNumber)
    throw new Error("PROJECT_NOT_CONFIGURED: run project-setup after gh browser authorization");
  return gh([
    "project",
    "view",
    String(config.github.projectNumber),
    "--owner",
    config.github.projectOwner,
    "--format",
    "json",
  ]);
}
function fields() {
  return gh([
    "project",
    "field-list",
    String(config.github.projectNumber),
    "--owner",
    config.github.projectOwner,
    "--format",
    "json",
  ]).fields;
}
function items() {
  const p = project();
  // Paginate the authoritative Project API; do not silently truncate the Ready queue.
  const query = `query($id:ID!,$endCursor:String){node(id:$id){... on ProjectV2{items(first:100,after:$endCursor){nodes{id content{... on Issue{number url title state repository{nameWithOwner}}} fieldValues(first:30){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}} pageInfo{hasNextPage endCursor}}}}}`;
  return gh([
    "api",
    "graphql",
    "--paginate",
    "--jq",
    "tojson",
    "-f",
    `query=${query}`,
    "-f",
    `id=${p.id}`,
  ])
    .flatMap((page) => page.data.node.items.nodes)
    .map((item) => ({
      ...item,
      status: item.fieldValues.nodes.find((v) => v.field?.name === "Status")?.name,
      priority: item.fieldValues.nodes.find((v) => v.field?.name === "Priority")?.name,
    }))
    .filter((item) => item.content?.repository?.nameWithOwner === repo);
}
function issueItem(number) {
  const item = items().find((item) => item.content.number === Number(number));
  if (!item) throw new Error("ISSUE_NOT_IN_PROJECT");
  return item;
}
function setStatus(number, status) {
  if (!states.includes(status)) throw new Error("STATUS_INVALID");
  const p = project();
  const field = fields().find((field) => field.name === "Status");
  const option = field?.options?.find((option) => option.name === status);
  if (!option) throw new Error("PROJECT_STATUS_MISSING");
  const item = issueItem(number);
  gh(
    [
      "project",
      "item-edit",
      "--id",
      item.id,
      "--project-id",
      p.id,
      "--field-id",
      field.id,
      "--single-select-option-id",
      option.id,
    ],
    false,
  );
  return { issue: Number(number), status };
}
function comments(number) {
  return gh([
    "api",
    `repos/${repo}/issues/${number}/comments`,
    "--paginate",
    "--jq",
    "tojson",
  ]).flat();
}
function post(number, body) {
  // Structured stdin avoids shell interpolation and preserves exact Markdown.
  return JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${repo}/issues/${number}/comments`, "--method", "POST", "--input", "-"],
      { cwd: root, encoding: "utf8", input: JSON.stringify({ body }) },
    ),
  );
}
function pr(number) {
  return gh([
    "pr",
    "view",
    number,
    "--repo",
    repo,
    "--json",
    "number,state,isDraft,headRefOid,headRepositoryOwner,baseRefName,url",
  ]);
}
function trusted(comment) {
  return comment.user?.login === repo.split("/")[0];
}
function cloudRequest(comment) {
  return (
    trusted(comment) &&
    /^@codex\s+review\b/m.test(comment.body) &&
    comment.body.includes("<!-- nina-cloud-review-once -->")
  );
}
function evidence(number, head) {
  return comments(number).some(
    (comment) => trusted(comment) && comment.body.startsWith(`<!-- nina-evidence:${head} -->`),
  );
}
function main() {
  if (command === "help")
    return {
      help: `GitHub operations use the existing gh login; no token configuration.
  config | project-setup | queue
  status --issue N --status 'Ready'   Product Owner only for new scope
  claim --issue N --run RUN          Bound coordinator only
  evidence --pr N --run RUN --review-task TASK --verification-commit SHA --verification 'observed details or deferred reason'
  review --pr N                     Request cloud review once per PR
  merge --pr N                      Exact-head local evidence + cloud completion + static checks
Use gh issue/pr directly for authoring; gh api for missing operations.
Settings: development.json. Recurring intake remains disabled until activation.`,
    };
  if (command === "config") return config;
  if (command === "project-setup") {
    if (!config.github.projectNumber) {
      const found = gh([
        "project",
        "list",
        "--owner",
        config.github.projectOwner,
        "--format",
        "json",
        "--limit",
        "100",
      ]).projects.filter((p) => p.title === "Call Nina");
      if (found.length > 1) throw new Error("PROJECT_SELECTION_AMBIGUOUS");
      const p =
        found[0] ??
        gh([
          "project",
          "create",
          "--owner",
          config.github.projectOwner,
          "--title",
          "Call Nina",
          "--format",
          "json",
        ]);
      config.github.projectNumber = p.number;
      writeFileSync(path.join(root, "development.json"), JSON.stringify(config, null, 2) + "\n");
    }
    const p = project();
    gh(
      [
        "project",
        "link",
        String(config.github.projectNumber),
        "--owner",
        config.github.projectOwner,
        "--repo",
        repo,
      ],
      false,
    );
    const status = fields().find((f) => f.name === "Status");
    if (!status) throw new Error("PROJECT_STATUS_FIELD_MISSING");
    if (status.options.map((o) => o.name).join("|") !== states.join("|")) {
      if (items().length) throw new Error("EXISTING_PROJECT_STATUS_MIGRATION_REQUIRES_REVIEW");
      const query = `mutation($field:ID!,$options:[ProjectV2SingleSelectFieldOptionInput!]!){updateProjectV2Field(input:{fieldId:$field,singleSelectOptions:$options}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}`;
      const payload = {
        query,
        variables: {
          field: status.id,
          options: states.map((name, i) => ({
            name,
            color: ["GRAY", "BLUE", "YELLOW", "PURPLE", "RED", "GREEN"][i],
            description: name,
          })),
        },
      };
      execFileSync("gh", ["api", "graphql", "--input", "-"], {
        cwd: root,
        encoding: "utf8",
        input: JSON.stringify(payload),
      });
    }
    if (!fields().some((f) => f.name === "Priority"))
      gh(
        [
          "project",
          "field-create",
          String(config.github.projectNumber),
          "--owner",
          config.github.projectOwner,
          "--name",
          "Priority",
          "--data-type",
          "SINGLE_SELECT",
          "--single-select-options",
          "P0,P1,P2",
        ],
        false,
      );
    return { project: p.url, number: config.github.projectNumber, intakeEnabled: false };
  }
  if (command === "queue") {
    const binding = path.join(stateRoot, "run.json");
    return {
      enabled: config.intake.enabled,
      coordinator: existsSync(binding) ? load(binding) : null,
      items: items()
        .filter((item) => ["Ready", "In progress", "Review", "Blocked"].includes(item.status))
        .map(({ content, status, priority }) => ({ ...content, status, priority }))
        .sort((a, b) => (a.priority ?? "P2").localeCompare(b.priority ?? "P2")),
    };
  }
  if (command === "status") return setStatus(numeric(values.issue), values.status);
  if (command === "claim") {
    const number = numeric(values.issue);
    const binding = load(path.join(stateRoot, "run.json"));
    if (binding.run !== values.run) throw new Error("BOUND_COORDINATOR_REQUIRED");
    const item = issueItem(number);
    const marker = `<!-- nina-run:${values.run} -->`;
    const claims = comments(number).filter(
      (comment) => trusted(comment) && /^<!-- nina-run:run_[a-zA-Z0-9_-]+ -->\n/.test(comment.body),
    );
    if (claims.some((comment) => !comment.body.startsWith(marker)))
      throw new Error("ISSUE_ALREADY_CLAIMED: reconcile its existing Run");
    if (item.content.state !== "OPEN") throw new Error("ISSUE_CLOSED");
    if (claims.length && item.status !== "Ready")
      return { issue: Number(number), status: item.status, resumed: true };
    if (!claims.length && item.status !== "Ready") throw new Error("ISSUE_NOT_READY");
    if (!claims.length)
      post(number, `${marker}\nDevelopment claimed by Orca Run \`${values.run}\`.`);
    return setStatus(number, "In progress");
  }
  const number = numeric(values.pr);
  const pull = pr(number);
  if (
    pull.state !== "OPEN" ||
    pull.isDraft ||
    pull.baseRefName !== "main" ||
    pull.headRepositoryOwner.login !== repo.split("/")[0]
  )
    throw new Error("ELIGIBLE_MAIN_PR_REQUIRED");
  if (command === "evidence") {
    const review = tasks(values.run).find((task) => task.id === values["review-task"]);
    const spec = /^NINA_ASSIGNMENT=([^\n]+)/.exec(review?.spec ?? "");
    if (
      review?.status !== "completed" ||
      !spec ||
      JSON.parse(spec[1]).role !== "reviewer" ||
      !values.verification?.trim()
    )
      throw new Error("COMPLETED_REVIEW_AND_VERIFICATION_EVIDENCE_REQUIRED");
    const reviewed = JSON.parse(spec[1]).commit;
    const launchPath = path.join(stateRoot, "launches", `${review.id}.json`);
    if (
      reviewed !== pull.headRefOid ||
      !existsSync(launchPath) ||
      load(launchPath).baseline !== reviewed ||
      load(launchPath).run !== values.run ||
      values["verification-commit"] !== reviewed
    )
      throw new Error("REVIEW_AND_VERIFICATION_COMMIT_MISMATCH");
    if (!evidence(number, pull.headRefOid))
      post(
        number,
        `<!-- nina-evidence:${pull.headRefOid} -->\nLocal review: \`${values["review-task"]}\` in \`${values.run}\`.\n\nVerification at \`${reviewed}\`: ${values.verification}\n\nCoordinator confirms all actionable local findings are resolved for this commit.`,
      );
    return { head: pull.headRefOid, evidence: true };
  }
  if (command === "review") {
    if (!evidence(number, pull.headRefOid)) throw new Error("CURRENT_HEAD_LOCAL_EVIDENCE_REQUIRED");
    if (comments(number).some(cloudRequest)) return { review: "already-requested" };
    if (
      gh(["api", `repos/${repo}/pulls/${number}/reviews`, "--paginate", "--jq", "tojson"])
        .flat()
        .some((review) => review.user?.login === "chatgpt-codex-connector[bot]")
    )
      return { review: "already-completed" };
    post(number, "@codex review\n\n<!-- nina-cloud-review-once -->");
    return { review: "requested" };
  }
  if (command === "merge") {
    if (!evidence(number, pull.headRefOid)) throw new Error("CURRENT_HEAD_LOCAL_EVIDENCE_REQUIRED");
    const reviews = gh([
      "api",
      `repos/${repo}/pulls/${number}/reviews`,
      "--paginate",
      "--jq",
      "tojson",
    ]).flat();
    const completed = reviews.some(
      (review) => review.user?.login === "chatgpt-codex-connector[bot]" && review.submitted_at,
    );
    const requests = comments(number).filter(cloudRequest);
    const approvedReaction = requests.some((comment) =>
      gh([
        "api",
        `repos/${repo}/issues/comments/${comment.id}/reactions`,
        "--paginate",
        "--jq",
        "tojson",
      ])
        .flat()
        .some(
          (reaction) =>
            reaction.user?.login === "chatgpt-codex-connector[bot]" && reaction.content === "+1",
        ),
    );
    if (!completed && !approvedReaction) throw new Error("CLOUD_REVIEW_NOT_COMPLETE");
    const [owner, name] = repo.split("/");
    const query = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}`;
    const pages = gh([
      "api",
      "graphql",
      "--paginate",
      "--jq",
      "tojson",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ]);
    if (
      pages.some((page) =>
        page.data.repository.pullRequest.reviewThreads.nodes.some((thread) => !thread.isResolved),
      )
    )
      throw new Error("UNRESOLVED_REVIEW_DISCUSSIONS");
    const checks = gh([
      "api",
      `repos/${repo}/commits/${pull.headRefOid}/check-runs`,
      "--paginate",
      "--jq",
      "tojson",
    ]).flatMap((page) => page.check_runs);
    if (
      !checks.some(
        (check) =>
          check.name === "static" &&
          check.app?.slug === "github-actions" &&
          check.status === "completed" &&
          check.conclusion === "success",
      )
    )
      throw new Error("STATIC_CHECK_NOT_SUCCESSFUL");
    gh(["pr", "checks", number, "--repo", repo, "--required"], false);
    return {
      merged: gh(
        ["pr", "merge", number, "--repo", repo, "--squash", "--match-head-commit", pull.headRefOid],
        false,
      ),
    };
  }
  throw new Error("UNKNOWN_COMMAND");
}
try {
  console.log(
    JSON.stringify(["help", "config", "queue"].includes(command) ? main() : locked(main), null, 2),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
