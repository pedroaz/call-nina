#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { developmentConfig, root } from "../lib/config.mjs";
import {
  metadataContext,
  taskBranch,
  taskIssue,
  validateCommit,
  validateMetadata,
  metadataDigest,
  squashMessageMatches,
} from "./lib/task-metadata.mjs";
import {
  assertCoordinator,
  locked,
  stateRoot,
  load,
  replace,
  tasks,
} from "./lib/orchestration.mjs";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(
    [
      "issue",
      "branch",
      "baseline",
      "head",
      "title-file",
      "body-file",
      "pr",
      "status",
      "run",
      "review-task",
      "verification",
      "verification-commit",
      "static-check-commit",
    ].map((key) => [key, { type: "string" }]),
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
  const result = graphql(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            id
            number
            state
            isDraft
            headRefOid
            headRefName
            headRepository {
              id
              nameWithOwner
            }
            baseRefName
            baseRefOid
            title
            body
            url
          }
        }
      }
    `,
    { number: Number(number) },
  );
  if (!result.data.repository?.pullRequest) throw new Error("PR_NOT_FOUND");
  return result.data.repository.pullRequest;
}
function trusted(comment) {
  return comment.user?.login === repo.split("/")[0];
}
function evidence(number, head) {
  return comments(number).some(
    (comment) =>
      trusted(comment) &&
      comment.body.startsWith(`<!-- nina-evidence:${head} -->`) &&
      comment.body.includes(`<!-- nina-local-static:${head} -->`),
  );
}
function api(endpoint, method, body) {
  return JSON.parse(
    execFileSync("gh", ["api", `repos/${repo}/${endpoint}`, "--method", method, "--input", "-"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(body),
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}
function graphql(query, variables = {}, paginate = false) {
  const [owner, name] = repo.split("/");
  return gh([
    "api",
    "graphql",
    ...(paginate ? ["--paginate", "--jq", "tojson"] : []),
    "-f",
    `query=${query}`,
    ...Object.entries({ owner, name, ...variables }).flatMap(([key, value]) => [
      typeof value === "number" ? "-F" : "-f",
      `${key}=${value}`,
    ]),
  ]);
}
function readIssue(number) {
  const data = graphql(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            id
            number
            state
            labels(first: 100) {
              nodes {
                name
              }
              pageInfo {
                hasNextPage
              }
            }
            repository {
              nameWithOwner
            }
            parent {
              number
              state
              repository {
                nameWithOwner
              }
            }
          }
        }
      }
    `,
    { number },
  );
  if (!data.data.repository?.issue) throw new Error("TASK_ISSUE_NOT_FOUND");
  if (data.data.repository.issue.labels.pageInfo.hasNextPage)
    throw new Error("INCOMPLETE_ISSUE_LABEL_READ");
  return data.data.repository.issue;
}
function connection(number, field, selection) {
  const query = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){${field}(first:100,after:$endCursor){totalCount nodes{${selection}} pageInfo{hasNextPage endCursor}}}}}`;
  const pages = graphql(query, { number: Number(number) }, true);
  const nodes = pages.flatMap((page) => page.data.repository.pullRequest[field].nodes);
  if (pages.some((page) => page.data.repository.pullRequest[field].totalCount !== nodes.length))
    throw new Error(`INCOMPLETE_OR_CHANGED_PR_CONNECTION: ${field}`);
  return nodes;
}
function snapshot(number) {
  const pull = pr(number);
  const issue = readIssue(taskBranch(pull.headRefName));
  const commits = connection(number, "commits", "commit{oid message}").map((node) => node.commit);
  const closingIssues = connection(
    number,
    "closingIssuesReferences",
    "number repository{nameWithOwner}",
  );
  if (metadataDigest(pr(number)) !== metadataDigest(pull))
    throw new Error("PR_CHANGED_DURING_READ");
  return { repo, pull, issue, commits, closingIssues };
}
function status(head, state, description) {
  api(`statuses/${head}`, "POST", {
    state,
    context: metadataContext,
    description: description.slice(0, 140),
  });
}
function checkedMetadata(current) {
  assertPublishedHead(current.pull);
  const head = current.pull.headRefOid;
  status(head, "pending", "Validating current task metadata");
  try {
    const result = validateMetadata(current);
    if (metadataDigest(snapshot(current.pull.number)) !== result.digest)
      throw new Error("PR_METADATA_CHANGED");
    assertPublishedHead(current.pull);
    status(head, "success", `Validated snapshot ${result.digest.slice(0, 32)}`);
    return result;
  } catch (error) {
    status(
      head,
      "failure",
      "Task metadata invalid or changed; run make github ARGS='validate --pr N'",
    );
    throw error;
  }
}
function refreshMetadata(number) {
  // Invalidate the known head before reads that might fail (including malformed branches).
  const pull = pr(number);
  if (pull.headRepository?.nameWithOwner !== repo) throw new Error("SAME_REPOSITORY_PR_REQUIRED");
  const head = pull.headRefOid;
  status(head, "pending", "Reading current task metadata");
  try {
    return checkedMetadata(snapshot(number));
  } catch (error) {
    status(head, "failure", "Task metadata validation failed");
    throw error;
  }
}
function metadataFiles() {
  if (!values["title-file"] || !values["body-file"])
    throw new Error("TITLE_AND_BODY_FILES_REQUIRED");
  return {
    title: readFileSync(values["title-file"], "utf8").trim(),
    body: readFileSync(values["body-file"], "utf8").trim(),
  };
}
function editPull(number) {
  const current = snapshot(number);
  assertPublishedHead(current.pull);
  const retained = publication(current.pull.headRefName);
  if (retained?.creation && !retained.creation.settled)
    throw new Error(`PR_CREATION_RECONCILIATION_REQUIRED: ${resumePublication(retained)}`);
  const proposed = { ...current, pull: { ...current.pull, ...metadataFiles() } };
  validateMetadata(proposed, { candidate: true });
  status(current.pull.headRefOid, "pending", "PR metadata edit in progress");
  try {
    if (metadataDigest(snapshot(number)) !== metadataDigest(current))
      throw new Error("PR_METADATA_CHANGED");
    api(`pulls/${number}`, "PATCH", { title: proposed.pull.title, body: proposed.pull.body });
    const actual = snapshot(number);
    if (
      actual.pull.title !== proposed.pull.title ||
      actual.pull.body !== proposed.pull.body ||
      actual.pull.headRefOid !== current.pull.headRefOid
    )
      throw new Error("PR_EDIT_READBACK_MISMATCH");
    return checkedMetadata(actual);
  } catch (error) {
    status(current.pull.headRefOid, "failure", "PR metadata edit failed validation");
    throw error;
  }
}
function branchState(branch, number) {
  const query = `query($owner:String!,$name:String!,$number:Int!,$ref:String!,$endCursor:String){repository(owner:$owner,name:$name){id ref(qualifiedName:$ref){name target{oid}} issue(number:$number){linkedBranches(first:100,after:$endCursor){nodes{ref{name target{oid} repository{nameWithOwner}}} pageInfo{hasNextPage endCursor}}}}}`;
  const pages = graphql(query, { number, ref: `refs/heads/${branch}` }, true);
  return {
    repositoryId: pages[0].data.repository.id,
    ref: pages[0].data.repository.ref,
    links: pages
      .flatMap((page) => page.data.repository.issue.linkedBranches.nodes)
      .map((node) => node.ref),
  };
}
function matchingLink(state, branch) {
  return state.links.some(
    (ref) =>
      ref?.name === branch &&
      ref.repository.nameWithOwner === repo &&
      ref.target.oid === state.ref?.target.oid,
  );
}
function branchPulls(branch, state = "open") {
  const found = gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--head",
    branch,
    "--state",
    state,
    "--limit",
    "100",
    "--json",
    "number",
  ]);
  if (found.length > 1) throw new Error("BRANCH_PR_AMBIGUOUS");
  return found;
}
function remoteCommits(head) {
  const pages = gh([
    "api",
    `repos/${repo}/compare/main...${head}?per_page=100`,
    "--paginate",
    "--jq",
    "tojson",
  ]);
  const commits = pages
    .flatMap((page) => page.commits)
    .map((commit) => ({ oid: commit.sha, message: commit.commit.message }));
  if (commits.length !== pages[0].total_commits) throw new Error("INCOMPLETE_BRANCH_COMMIT_READ");
  return commits;
}
function createPull() {
  const branch = values.branch;
  const task = taskBranch(branch);
  const retained = publication(branch);
  if (!retained || retained.run !== values.run) throw new Error("EXACT_PUBLICATION_RUN_REQUIRED");
  if (retained.creation || retained.pr)
    throw new Error(`PR_CREATION_ALREADY_RECORDED: ${resumePublication(retained)}`);
  const issue = readIssue(task);
  taskIssue(issue, repo, task);
  const state = branchState(branch, task);
  assertPublicationSettled(branch, state.ref?.target.oid);
  if (state.repositoryId !== retained.repositoryId)
    throw new Error("PUBLICATION_REPOSITORY_CHANGED");
  if (!state.ref || !matchingLink(state, branch))
    throw new Error("PUBLISHED_TASK_LINKED_BRANCH_REQUIRED");
  if (branchPulls(branch, "all").length) throw new Error("PR_ALREADY_EXISTS: use edit");
  const proposed = {
    repo,
    issue,
    commits: remoteCommits(state.ref.target.oid),
    closingIssues: [],
    pull: {
      state: "OPEN",
      baseRefName: "main",
      headRefName: branch,
      headRefOid: state.ref.target.oid,
      headRepository: { nameWithOwner: repo },
      ...metadataFiles(),
    },
  };
  validateMetadata(proposed, { candidate: true });
  status(proposed.pull.headRefOid, "pending", "Creating task PR");
  try {
    if (metadataDigest(branchState(branch, task)) !== metadataDigest(state))
      throw new Error("BRANCH_CHANGED");
    if (branchPulls(branch, "all").length) throw new Error("PR_ALREADY_EXISTS: use edit");
    // Persist the exact authored request before POST. Even a lost response or
    // process exit must leave enough evidence to adopt only this intended PR.
    retained.creation = {
      issueId: issue.id,
      base: proposed.pull.baseRefName,
      title: proposed.pull.title,
      body: proposed.pull.body,
      acknowledgement: "unconfirmed",
      settled: false,
    };
    recordPublication(retained, "pr-create-unconfirmed");
    const created = api("pulls", "POST", {
      head: branch,
      base: "main",
      title: proposed.pull.title,
      body: proposed.pull.body,
    });
    if (
      !Number.isSafeInteger(created.number) ||
      created.number < 1 ||
      typeof created.node_id !== "string"
    )
      throw new Error("PR_CREATE_ACKNOWLEDGEMENT_INVALID");
    retained.creation.acknowledgement = "succeeded";
    retained.pr = { number: created.number, id: created.node_id, previousHead: retained.head };
    recordPublication(retained, "pr-created");
    return reconcilePublication(retained);
  } catch (error) {
    if (retained.creation)
      return blockedPublication(retained, "pr-create-acknowledgement-or-readback-unconfirmed");
    status(proposed.pull.headRefOid, "failure", "PR creation requires metadata reconciliation");
    throw error;
  }
}
function localGit(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}
// One retained receipt per task branch, shared by all repository worktrees. Every
// observation is appended atomically; a completed attempt is archived before the
// next push. No receipt, status-write failure or interrupted read authorizes retry.
function publicationFile(branch) {
  taskBranch(branch);
  return path.join(stateRoot, "publications", `${metadataDigest({ repo, branch })}.json`);
}
function publication(branch) {
  const file = publicationFile(branch);
  if (!existsSync(file)) return null;
  const receipt = load(file);
  if (
    receipt.version !== 1 ||
    receipt.repo !== repo ||
    receipt.branch !== branch ||
    receipt.issue !== taskBranch(branch) ||
    !/^[a-f0-9]{40}$/.test(receipt.head ?? "") ||
    typeof receipt.repositoryId !== "string" ||
    !/^run_[a-zA-Z0-9_-]+$/.test(receipt.run ?? "") ||
    !["unattempted", "unconfirmed", "succeeded"].includes(receipt.push) ||
    ![
      "push-unattempted",
      "push-unconfirmed",
      "pushed",
      "pr-create-unconfirmed",
      "pr-created",
      "pending-propagation",
      "blocked",
      "ready",
    ].includes(receipt.outcome) ||
    (receipt.pr !== null &&
      (!Number.isSafeInteger(receipt.pr?.number) ||
        receipt.pr.number < 1 ||
        typeof receipt.pr.id !== "string" ||
        !/^[a-f0-9]{40}$/.test(receipt.pr.previousHead ?? ""))) ||
    (receipt.push === "unattempted" &&
      (!/^[a-f0-9]{40}$/.test(receipt.baseline ?? "") ||
        !/^[a-f0-9]{40}$/.test(receipt.previousBranchHead ?? "") ||
        !path.isAbsolute(receipt.preparation?.checkout ?? "") ||
        typeof receipt.preparation?.coordinator !== "string" ||
        !Number.isSafeInteger(receipt.preparation?.generation) ||
        !/^[a-f0-9]{64}$/.test(receipt.preparation?.issueDigest ?? "") ||
        (receipt.pr
          ? !/^[a-f0-9]{64}$/.test(receipt.preparation?.prDigest ?? "")
          : receipt.preparation?.prDigest !== null))) ||
    (receipt.creation !== undefined &&
      (receipt.push === "unattempted" ||
        typeof receipt.creation?.issueId !== "string" ||
        receipt.creation.base !== "main" ||
        typeof receipt.creation.title !== "string" ||
        typeof receipt.creation.body !== "string" ||
        !["unconfirmed", "succeeded"].includes(receipt.creation.acknowledgement) ||
        typeof receipt.creation.settled !== "boolean" ||
        (receipt.creation.settled && !receipt.pr))) ||
    !Array.isArray(receipt.observations)
  )
    throw new Error("PUBLICATION_RECEIPT_INVALID: retain and investigate the receipt");
  return receipt;
}
function recordPublication(receipt, outcome, details = {}) {
  receipt.outcome = outcome;
  receipt.observations.push({ at: new Date().toISOString(), outcome, ...details });
  replace(publicationFile(receipt.branch), receipt);
}
function resumePublication(receipt) {
  if (receipt.push === "unattempted")
    return `make github ARGS='publish --run ${receipt.run} --issue ${receipt.issue} --branch ${receipt.branch} --baseline ${receipt.baseline} --head ${receipt.head}'`;
  return `make github ARGS='reconcile-publication --run ${receipt.run} --issue ${receipt.issue} --branch ${receipt.branch} --head ${receipt.head}'`;
}
function assertPublicationSettled(branch, head) {
  const receipt = publication(branch);
  if (receipt && (receipt.outcome !== "ready" || receipt.head !== head))
    throw new Error(`PUBLICATION_RECONCILIATION_REQUIRED: ${resumePublication(receipt)}`);
}
function assertPublishedHead(pull) {
  if (pull.headRepository?.nameWithOwner !== repo) throw new Error("SAME_REPOSITORY_PR_REQUIRED");
  const receipt = publication(pull.headRefName);
  if (
    receipt &&
    (receipt.head !== pull.headRefOid ||
      receipt.repositoryId !== pull.headRepository.id ||
      !receipt.pr ||
      receipt.pr.number !== pull.number ||
      receipt.pr.id !== pull.id)
  )
    throw new Error(`PUBLICATION_HEAD_OR_OWNERSHIP_MISMATCH: ${resumePublication(receipt)}`);
  const ref = gh(["api", `repos/${repo}/git/ref/heads/${pull.headRefName}`]);
  if (ref.object.sha !== pull.headRefOid)
    throw new Error(
      "PR_BRANCH_HEAD_MISMATCH: reconcile publication before attaching metadata or evidence",
    );
}
function publicationResult(receipt) {
  const ready = receipt.outcome === "ready";
  if (!ready) process.exitCode = 1;
  return {
    repository: receipt.repo,
    branch: receipt.branch,
    head: receipt.head,
    pr: receipt.pr?.number ?? null,
    push: receipt.push,
    ...(receipt.creation ? { create: receipt.creation.acknowledgement } : {}),
    publication: receipt.outcome,
    deliveryBlocked: !ready,
    observation: receipt.observations.at(-1),
    next: ready
      ? receipt.pr
        ? "record exact-head local gates before merge"
        : "create task PR"
      : receipt.outcome === "blocked"
        ? `Investigate the retained observation and restore exact ownership/readback; then ${resumePublication(receipt)}`
        : resumePublication(receipt),
  };
}
function reconcilePublication(receipt) {
  if (receipt.run !== values.run) throw new Error("EXACT_PUBLICATION_RUN_REQUIRED");
  if (receipt.push === "unattempted")
    return blockedPublication(receipt, "push-provably-unattempted-use-publish", {}, false);
  // A single bounded pass per explicit invocation: no retry loop or background
  // monitor. Failed/unknown push calls are reconciled by readback, never repushed.
  let repositoryConfirmed = false;
  try {
    const state = branchState(receipt.branch, receipt.issue);
    const observed = { branchHead: state.ref?.target.oid ?? null };
    if (state.repositoryId !== receipt.repositoryId)
      return blockedPublication(receipt, "repository-changed", observed, false);
    repositoryConfirmed = true;
    if (observed.branchHead !== receipt.head)
      return blockedPublication(receipt, "branch-head-changed-or-unconfirmed", observed);
    status(receipt.head, "pending", "Reconciling retained publication; delivery blocked");
    const pulls = branchPulls(
      receipt.branch,
      receipt.creation && !receipt.creation.settled ? "all" : "open",
    );
    const issue = readIssue(receipt.issue);
    taskIssue(issue, repo, receipt.issue);
    if (receipt.creation && !receipt.creation.settled) {
      if (pulls.length !== 1 || issue.id !== receipt.creation.issueId)
        return blockedPublication(receipt, "intended-pr-absent-or-ownership-changed", observed);
      const intended = snapshot(String(pulls[0].number));
      const pull = intended.pull;
      if (
        pull.state !== "OPEN" ||
        pull.isDraft ||
        pull.baseRefName !== receipt.creation.base ||
        pull.headRefName !== receipt.branch ||
        pull.headRefOid !== receipt.head ||
        pull.headRepository?.nameWithOwner !== receipt.repo ||
        pull.headRepository?.id !== receipt.repositoryId ||
        pull.title !== receipt.creation.title ||
        pull.body !== receipt.creation.body ||
        intended.issue.id !== receipt.creation.issueId ||
        (receipt.pr && (receipt.pr.number !== pull.number || receipt.pr.id !== pull.id))
      )
        return blockedPublication(receipt, "intended-pr-readback-mismatch", observed);
      validateMetadata(intended);
      // Adoption is durable before subsequent status writes/validation. Keep
      // the original POST acknowledgement classification, including uncertainty.
      receipt.pr = { number: pull.number, id: pull.id, previousHead: receipt.head };
      recordPublication(receipt, "pr-created", { adopted: true });
    }
    if (receipt.pr) {
      if (pulls.length !== 1 || pulls[0].number !== receipt.pr.number)
        return blockedPublication(receipt, "pr-ownership-changed", observed);
      const pull = pr(String(receipt.pr.number));
      observed.prHead = pull.headRefOid;
      if (
        pull.id !== receipt.pr.id ||
        pull.state !== "OPEN" ||
        pull.baseRefName !== "main" ||
        pull.headRefName !== receipt.branch ||
        pull.headRepository?.nameWithOwner !== repo ||
        pull.headRepository?.id !== receipt.repositoryId
      )
        return blockedPublication(receipt, "pr-ownership-changed", observed);
      // Only the exact previously validated PR head is recognized as propagation
      // lag. An arbitrary ancestor or another head is a contradiction.
      if (pull.headRefOid !== receipt.head) {
        if (pull.headRefOid !== receipt.pr.previousHead)
          return blockedPublication(receipt, "unexpected-pr-head", observed);
        recordPublication(receipt, "pending-propagation", observed);
        return publicationResult(receipt);
      }
      const current = snapshot(String(receipt.pr.number));
      if (current.pull.headRefOid !== receipt.head || current.pull.id !== receipt.pr.id)
        return blockedPublication(receipt, "pr-changed-during-read", observed);
      if (
        receipt.creation &&
        !receipt.creation.settled &&
        (current.pull.title !== receipt.creation.title ||
          current.pull.body !== receipt.creation.body ||
          current.issue.id !== receipt.creation.issueId)
      )
        return blockedPublication(receipt, "intended-pr-metadata-changed", observed);
      const metadata = checkedMetadata(current);
      if (receipt.creation) receipt.creation.settled = true;
      recordPublication(receipt, "ready", { ...observed, metadata: metadata.digest });
      return { ...metadata, ...publicationResult(receipt) };
    }
    if (pulls.length || !matchingLink(state, receipt.branch))
      return blockedPublication(receipt, "linked-branch-ownership-changed", observed);
    const commits = remoteCommits(receipt.head);
    if (!commits.length) throw new Error("TASK_COMMITS_REQUIRED");
    for (const commit of commits) validateCommit(commit.message, receipt.issue);
    const after = branchState(receipt.branch, receipt.issue);
    if (
      after.repositoryId !== receipt.repositoryId ||
      after.ref?.target.oid !== receipt.head ||
      !matchingLink(after, receipt.branch) ||
      branchPulls(receipt.branch).length
    )
      return blockedPublication(receipt, "linked-branch-changed-during-read", observed);
    recordPublication(receipt, "ready", observed);
    return { ...publicationResult(receipt), linked: true, status: "pending" };
  } catch (error) {
    // Do not retain raw provider stderr, credentials or private paths. The CLI
    // failure remains uncertainty, distinct from a positively observed conflict.
    const code = /^([A-Z][A-Z_]+)(?=:|$)/.exec(error.message)?.[1];
    return blockedPublication(
      receipt,
      "readback-or-validation-unconfirmed",
      code ? { code } : {},
      repositoryConfirmed,
    );
  }
}
function blockedPublication(receipt, reason, observed = {}, invalidate = true) {
  recordPublication(receipt, "blocked", { reason, ...observed });
  // Never write status into an unconfirmed repository, and never let a failed
  // invalidation hide the durable outcome. Local delivery gates remain blocked.
  if (!invalidate) return publicationResult(receipt);
  try {
    status(receipt.head, "failure", "Publication blocked; reconcile retained exact-head receipt");
  } catch {
    recordPublication(receipt, "blocked", { reason, ...observed, metadataStatus: "unconfirmed" });
  }
  return publicationResult(receipt);
}
function assertPreparedCheckout(receipt) {
  if (
    realpathSync(root) !== receipt.preparation.checkout ||
    localGit(["branch", "--show-current"]) !== receipt.branch ||
    localGit(["rev-parse", "HEAD"]) !== receipt.head ||
    localGit(["status", "--porcelain"])
  )
    throw new Error("EXACT_CLEAN_PUBLICATION_CHECKOUT_REQUIRED");
}
function predecessorPrDigest(pull) {
  // main may advance independently. Retain the PR's base branch and authored
  // metadata, not its moving baseRefOid, while requiring the exact task head.
  return metadataDigest({
    id: pull.id,
    number: pull.number,
    state: pull.state,
    isDraft: pull.isDraft,
    headRefOid: pull.headRefOid,
    headRefName: pull.headRefName,
    headRepository: pull.headRepository,
    baseRefName: pull.baseRefName,
    title: pull.title,
    body: pull.body,
  });
}
function validateUnattemptedPush(receipt) {
  assertPreparedCheckout(receipt);
  const issue = readIssue(receipt.issue);
  taskIssue(issue, repo, receipt.issue);
  if (metadataDigest(issue) !== receipt.preparation.issueDigest)
    throw new Error("PUBLICATION_ISSUE_CHANGED");
  const main = gh(["api", `repos/${repo}/git/ref/heads/main`]).object.sha;
  localGit(["merge-base", "--is-ancestor", receipt.baseline, main]);
  localGit(["merge-base", "--is-ancestor", receipt.baseline, receipt.head]);
  localGit(["merge-base", "--is-ancestor", receipt.previousBranchHead, receipt.head]);
  const commits = localGit(["rev-list", "--reverse", `${main}..${receipt.head}`])
    .split("\n")
    .filter(Boolean)
    .map((oid) => ({ oid, message: localGit(["show", "-s", "--format=%B", oid]) }));
  if (!commits.length) throw new Error("TASK_COMMITS_REQUIRED");
  for (const commit of commits) validateCommit(commit.message, receipt.issue);
  const pulls = branchPulls(receipt.branch);
  if (receipt.pr) {
    if (pulls.length !== 1 || pulls[0].number !== receipt.pr.number)
      throw new Error("PUBLICATION_PREDECESSOR_PR_CHANGED");
    const current = snapshot(String(receipt.pr.number));
    if (
      current.pull.id !== receipt.pr.id ||
      current.pull.headRefOid !== receipt.previousBranchHead ||
      current.pull.headRefName !== receipt.branch ||
      current.pull.headRepository?.id !== receipt.repositoryId ||
      predecessorPrDigest(current.pull) !== receipt.preparation.prDigest ||
      metadataDigest(current.issue) !== receipt.preparation.issueDigest
    )
      throw new Error("PUBLICATION_PREDECESSOR_METADATA_CHANGED");
    validateMetadata(current);
    validateMetadata(
      { ...current, commits, pull: { ...current.pull, headRefOid: receipt.head } },
      { candidate: true },
    );
  } else if (pulls.length) throw new Error("PUBLICATION_PREDECESSOR_PR_CHANGED");
  const state = branchState(receipt.branch, receipt.issue);
  if (
    state.repositoryId !== receipt.repositoryId ||
    state.ref?.target.oid !== receipt.previousBranchHead ||
    (!receipt.pr && !matchingLink(state, receipt.branch))
  )
    throw new Error("PUBLICATION_PREDECESSOR_BRANCH_CHANGED");
  const binding = assertCoordinator(receipt.run);
  if (
    binding.coordinator !== receipt.preparation.coordinator ||
    binding.generation !== receipt.preparation.generation
  )
    throw new Error("EXACT_PUBLICATION_COORDINATOR_REQUIRED");
  assertPreparedCheckout(receipt);
}
function pushUnattempted(receipt) {
  if (receipt.push !== "unattempted" || receipt.run !== values.run)
    throw new Error("EXACT_UNATTEMPTED_PUBLICATION_REQUIRED");
  try {
    const state = branchState(receipt.branch, receipt.issue);
    if (state.repositoryId !== receipt.repositoryId)
      return blockedPublication(receipt, "repository-changed", {}, false);
    // Status failure here proves no push was attempted. Resume only from the
    // original clean checkout after freshly checking all retained evidence.
    if (receipt.pr && receipt.pr.previousHead !== receipt.head)
      status(receipt.pr.previousHead, "pending", "Task branch publication in progress");
    validateUnattemptedPush(receipt);
  } catch (error) {
    const code = /^([A-Z][A-Z_]+)(?=:|$)/.exec(error.message)?.[1];
    return blockedPublication(
      receipt,
      "pre-push-validation-or-status-unconfirmed",
      code ? { code } : {},
      false,
    );
  }
  // This durable transition is immediately before the effect. Never downgrade
  // uncertainty to unattempted, including process loss before push returns.
  receipt.push = "unconfirmed";
  recordPublication(receipt, "push-unconfirmed");
  try {
    localGit([
      "push",
      `https://github.com/${repo}.git`,
      `${receipt.head}:refs/heads/${receipt.branch}`,
    ]);
  } catch {
    return blockedPublication(receipt, "push-acknowledgement-unconfirmed");
  }
  receipt.push = "succeeded";
  recordPublication(receipt, "pushed");
  return reconcilePublication(receipt);
}
function publish() {
  const branch = values.branch;
  const number = taskBranch(branch, numeric(values.issue));
  const retained = publication(branch);
  if (
    values.head &&
    (!retained ||
      retained.run !== values.run ||
      retained.head !== values.head ||
      retained.baseline !== values.baseline)
  )
    throw new Error("EXACT_PUBLICATION_RECEIPT_REQUIRED");
  if (retained?.push === "unattempted") {
    if (!values.head)
      throw new Error(`EXACT_UNATTEMPTED_PUBLICATION_REQUIRED: ${resumePublication(retained)}`);
    return pushUnattempted(retained);
  }
  if (retained && retained.outcome !== "ready")
    throw new Error(`PUBLICATION_RECONCILIATION_REQUIRED: ${resumePublication(retained)}`);
  const issue = readIssue(number);
  taskIssue(issue, repo, number);
  if (!/^[a-f0-9]{40}$/.test(values.baseline ?? ""))
    throw new Error("EXPLICIT_BASELINE_OID_REQUIRED");
  if (localGit(["branch", "--show-current"]) !== branch)
    throw new Error("INTEGRATION_BRANCH_CHECKOUT_REQUIRED");
  if (localGit(["status", "--porcelain"])) throw new Error("CLEAN_INTEGRATION_CHECKOUT_REQUIRED");
  const head = localGit(["rev-parse", "HEAD"]);
  if (values.head && values.head !== head) throw new Error("EXACT_PUBLICATION_HEAD_REQUIRED");
  if (retained?.head === head) return reconcilePublication(retained);
  localGit(["merge-base", "--is-ancestor", values.baseline, head]);
  const main = gh(["api", `repos/${repo}/git/ref/heads/main`]).object.sha;
  localGit(["merge-base", "--is-ancestor", values.baseline, main]);
  const commits = localGit(["rev-list", "--reverse", `${main}..${head}`])
    .split("\n")
    .filter(Boolean)
    .map((oid) => ({ oid, message: localGit(["show", "-s", "--format=%B", oid]) }));
  if (!commits.length) throw new Error("TASK_COMMITS_REQUIRED");
  for (const commit of commits) validateCommit(commit.message, number);
  const state = branchState(branch, number);
  const pulls = branchPulls(branch);
  let previous;
  if (pulls.length) {
    const current = snapshot(String(pulls[0].number));
    assertPublishedHead(current.pull);
    validateMetadata(current);
    validateMetadata(
      { ...current, commits, pull: { ...current.pull, headRefOid: head } },
      { candidate: true },
    );
    if (
      current.pull.headRefName !== branch ||
      current.pull.headRepository.id !== state.repositoryId
    )
      throw new Error("BRANCH_PR_MISMATCH");
    previous = current.pull;
  } else if (state.ref && !matchingLink(state, branch))
    throw new Error("UNLINKED_REMOTE_BRANCH_CONFLICT");
  if (!state.ref) {
    const mutation = `mutation($input:CreateLinkedBranchInput!){createLinkedBranch(input:$input){linkedBranch{id}}}`;
    execFileSync("gh", ["api", "graphql", "--input", "-"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            issueId: issue.id,
            repositoryId: state.repositoryId,
            name: branch,
            oid: values.baseline,
          },
        },
      }),
    });
    const created = branchState(branch, number);
    if (!matchingLink(created, branch) || created.ref.target.oid !== values.baseline)
      throw new Error("LINKED_BRANCH_READBACK_MISMATCH");
  }
  const beforePush = branchState(branch, number);
  localGit(["merge-base", "--is-ancestor", beforePush.ref.target.oid, head]);
  if (previous && beforePush.ref.target.oid !== previous.headRefOid)
    throw new Error("BRANCH_CHANGED_BEFORE_PUSH");
  const binding = assertCoordinator(values.run);
  const receipt = {
    version: 1,
    repo,
    repositoryId: state.repositoryId,
    run: values.run,
    issue: number,
    branch,
    head,
    baseline: values.baseline,
    previousBranchHead: beforePush.ref.target.oid,
    pr: previous
      ? { number: previous.number, id: previous.id, previousHead: previous.headRefOid }
      : null,
    preparation: {
      checkout: realpathSync(root),
      coordinator: binding.coordinator,
      generation: binding.generation,
      issueDigest: metadataDigest(issue),
      prDigest: previous ? predecessorPrDigest(previous) : null,
    },
    push: "unattempted",
    observations: [],
  };
  if (retained) replace(`${publicationFile(branch)}.${retained.head}.json`, retained);
  recordPublication(receipt, "push-unattempted");
  return pushUnattempted(receipt);
}

function main() {
  if (command === "help")
    return {
      help: `GitHub operations use the existing gh login; no token configuration.
  config | project-setup | queue
  status --issue N --status 'Ready'   Product Owner only for new scope
  claim --issue N --run RUN          Bound coordinator only
  evidence --pr N --run RUN --review-task TASK --verification-commit SHA --static-check-commit SHA --verification 'observed details or deferred reason'
  publish --run RUN --issue N --branch task/N-description --baseline SHA [--head SHA]
                                    Publish local HEAD; --head required to resume a proven unattempted push
  reconcile-publication --run RUN --issue N --branch task/N-description --head SHA
                                    One retained-publication readback pass; never pushes or creates a PR
  validate --pr N                   Read-only current metadata validation
  validate --pr N --run RUN         Also refresh the required metadata status
  create --run RUN --branch task/N-description --title-file PATH --body-file PATH
  edit --run RUN --pr N --title-file PATH --body-file PATH
  merge --run RUN --pr N            Fresh metadata + exact-head local review/static evidence + resolved discussions
Use these coordinator paths for task PR publication and edits. No automatic revalidation
of arbitrary GitHub UI/raw-gh edits is available while hosted automation is disabled.
Merge always rereads metadata; GitHub offers a head CAS, not atomic title/body CAS.
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
  if (
    ["claim", "publish", "reconcile-publication", "create", "edit", "merge", "evidence"].includes(
      command,
    ) ||
    (command === "validate" && values.run)
  )
    assertCoordinator(values.run);
  if (command === "claim") {
    const number = numeric(values.issue);
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
  if (command === "publish") return publish();
  if (command === "reconcile-publication") {
    taskBranch(values.branch, numeric(values.issue));
    const receipt = publication(values.branch);
    if (!receipt || receipt.run !== values.run || receipt.head !== values.head)
      throw new Error("EXACT_PUBLICATION_RECEIPT_REQUIRED");
    return reconcilePublication(receipt);
  }
  if (command === "create") return createPull();
  const number = numeric(values.pr);
  if (command === "validate") {
    if (values.run) return refreshMetadata(number);
    const current = snapshot(number);
    assertPublishedHead(current.pull);
    return validateMetadata(current);
  }
  if (command === "edit") return editPull(number);
  const pull = pr(number);
  if (
    pull.state !== "OPEN" ||
    pull.isDraft ||
    pull.baseRefName !== "main" ||
    pull.headRepository?.nameWithOwner !== repo
  )
    throw new Error("ELIGIBLE_MAIN_PR_REQUIRED");
  assertPublishedHead(pull);
  assertPublicationSettled(pull.headRefName, pull.headRefOid);
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
      values["verification-commit"] !== reviewed ||
      values["static-check-commit"] !== reviewed
    )
      throw new Error("REVIEW_VERIFICATION_AND_STATIC_COMMIT_MISMATCH");
    assertPublishedHead(pull);
    if (metadataDigest(pr(number)) !== metadataDigest(pull))
      throw new Error("PR_CHANGED_DURING_READ");
    if (!evidence(number, pull.headRefOid))
      post(
        number,
        `<!-- nina-evidence:${pull.headRefOid} -->\nLocal review: \`${values["review-task"]}\` in \`${values.run}\`.\n\nVerification at \`${reviewed}\`: ${values.verification}\n\n<!-- nina-local-static:${reviewed} -->\nCoordinator confirms local make check passed and all actionable local findings are resolved for this commit.`,
      );
    return { head: pull.headRefOid, evidence: true };
  }
  if (command === "merge") {
    const branchRules = gh([
      "api",
      `repos/${repo}/rules/branches/main?per_page=100`,
      "--paginate",
      "--jq",
      "tojson",
    ]).flat();
    if (branchRules.some((rule) => rule.type === "merge_queue"))
      throw new Error(
        "MERGE_QUEUE_UNSUPPORTED: immediate validated squash required; never enqueue or enable auto-merge",
      );
    if (!evidence(number, pull.headRefOid)) throw new Error("CURRENT_HEAD_LOCAL_EVIDENCE_REQUIRED");
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
    const current = snapshot(number);
    if (current.pull.isDraft) throw new Error("ELIGIBLE_MAIN_PR_REQUIRED");
    if (current.pull.headRefOid !== pull.headRefOid) throw new Error("PR_HEAD_CHANGED");
    const metadata = checkedMetadata(current);
    const reread = snapshot(number);
    if (metadataDigest(reread) !== metadata.digest) {
      status(current.pull.headRefOid, "failure", "Metadata changed during merge preparation");
      throw new Error("PR_METADATA_CHANGED: restart merge checks");
    }
    assertPublishedHead(reread.pull);
    // --match-head-commit protects the code; title/body have no atomic GitHub CAS.
    gh(
      [
        "pr",
        "merge",
        number,
        "--repo",
        repo,
        "--squash",
        "--match-head-commit",
        pull.headRefOid,
        "--subject",
        metadata.subject,
        "--body",
        metadata.body,
      ],
      false,
    );
    const merged = gh(["pr", "view", number, "--repo", repo, "--json", "state,mergeCommit"]);
    if (merged.state !== "MERGED" || !merged.mergeCommit?.oid)
      throw new Error("MERGE_NOT_CONFIRMED");
    const commit = gh(["api", `repos/${repo}/commits/${merged.mergeCommit.oid}`]);
    const issue = readIssue(metadata.task);
    if (
      !squashMessageMatches(commit.commit.message, metadata, number) ||
      issue.state !== "CLOSED" ||
      (issue.parent?.number ?? null) !== metadata.epic ||
      (metadata.epic !== null && issue.parent?.state !== "OPEN")
    )
      throw new Error(
        "POST_MERGE_METADATA_MISMATCH: inspect squash message, task closure and parent epic when present",
      );
    return {
      merged: merged.mergeCommit.oid,
      task: metadata.task,
      epic: metadata.epic,
      metadata: metadata.digest,
    };
  }
  throw new Error("UNKNOWN_COMMAND");
}
try {
  if (
    ![
      "help",
      "config",
      "project-setup",
      "queue",
      "status",
      "claim",
      "evidence",
      "publish",
      "reconcile-publication",
      "validate",
      "create",
      "edit",
      "merge",
    ].includes(command)
  )
    throw new Error("UNKNOWN_COMMAND");
  console.log(
    JSON.stringify(["help", "config", "queue"].includes(command) ? main() : locked(main), null, 2),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
