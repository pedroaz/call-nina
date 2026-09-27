#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
} from "./lib/task-metadata.mjs";
import { locked, stateRoot, load, tasks } from "./lib/orchestration.mjs";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(
    [
      "issue",
      "branch",
      "baseline",
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
            number
            state
            isDraft
            headRefOid
            headRefName
            headRepository {
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
function cloudRequest(comment) {
  return (
    trusted(comment) &&
    /^@codex\s+review\b/m.test(comment.body) &&
    comment.body.includes("<!-- nina-cloud-review-once -->")
  );
}
function evidence(number, head) {
  return comments(number).some(
    (comment) =>
      trusted(comment) &&
      comment.body.startsWith(`<!-- nina-evidence:${head} -->`) &&
      comment.body.includes(`<!-- nina-local-static:${head} -->`),
  );
}
function coordinator() {
  const binding = load(path.join(stateRoot, "run.json"));
  if (!values.run || binding.run !== values.run) throw new Error("BOUND_COORDINATOR_REQUIRED");
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
  const head = current.pull.headRefOid;
  status(head, "pending", "Validating current task metadata");
  try {
    const result = validateMetadata(current);
    if (metadataDigest(snapshot(current.pull.number)) !== result.digest)
      throw new Error("PR_METADATA_CHANGED");
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
function branchPulls(branch) {
  const found = gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--head",
    branch,
    "--state",
    "open",
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
  const issue = readIssue(task);
  taskIssue(issue, repo, task);
  const state = branchState(branch, task);
  if (!state.ref || !matchingLink(state, branch))
    throw new Error("PUBLISHED_TASK_LINKED_BRANCH_REQUIRED");
  if (branchPulls(branch).length) throw new Error("PR_ALREADY_EXISTS: use edit");
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
    const created = api("pulls", "POST", {
      head: branch,
      base: "main",
      title: proposed.pull.title,
      body: proposed.pull.body,
    });
    const actual = snapshot(String(created.number));
    if (
      actual.pull.headRefOid !== proposed.pull.headRefOid ||
      actual.pull.title !== proposed.pull.title ||
      actual.pull.body !== proposed.pull.body
    )
      throw new Error("PR_CREATE_READBACK_MISMATCH");
    return { pr: created.html_url, ...checkedMetadata(actual) };
  } catch (error) {
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
function publish() {
  const branch = values.branch;
  const number = taskBranch(branch, numeric(values.issue));
  const issue = readIssue(number);
  taskIssue(issue, repo, number);
  if (!/^[a-f0-9]{40}$/.test(values.baseline ?? ""))
    throw new Error("EXPLICIT_BASELINE_OID_REQUIRED");
  if (localGit(["branch", "--show-current"]) !== branch)
    throw new Error("INTEGRATION_BRANCH_CHECKOUT_REQUIRED");
  if (localGit(["status", "--porcelain"])) throw new Error("CLEAN_INTEGRATION_CHECKOUT_REQUIRED");
  const head = localGit(["rev-parse", "HEAD"]);
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
  if (pulls.length) {
    const current = snapshot(String(pulls[0].number));
    validateMetadata(current);
    validateMetadata(
      { ...current, commits, pull: { ...current.pull, headRefOid: head } },
      { candidate: true },
    );
    if (current.pull.headRefName !== branch) throw new Error("BRANCH_PR_MISMATCH");
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
  if (pulls.length)
    status(beforePush.ref.target.oid, "pending", "Task branch publication in progress");
  let pushed = false;
  try {
    // Explicit repository and refspec; never force, delete, or trust a configured push remote.
    localGit(["push", `https://github.com/${repo}.git`, `${head}:refs/heads/${branch}`]);
    pushed = true;
    status(head, "pending", "Validating published task branch");
    const after = branchState(branch, number);
    if (after.ref?.target.oid !== head || (!pulls.length && !matchingLink(after, branch)))
      throw new Error("PUBLISHED_BRANCH_READBACK_MISMATCH");
    taskIssue(readIssue(number), repo, number);
    const published = remoteCommits(head);
    if (!published.length) throw new Error("TASK_COMMITS_REQUIRED");
    for (const commit of published) validateCommit(commit.message, number);
    if (pulls.length) {
      const current = snapshot(String(pulls[0].number));
      if (current.pull.headRefOid !== head) throw new Error("PUBLISHED_PR_HEAD_MISMATCH");
      return checkedMetadata(current);
    }
    // Full PR metadata becomes required as soon as the PR exists.
    return { branch, head, linked: true, status: "pending", next: "create task PR" };
  } catch (error) {
    if (pushed || pulls.length)
      status(
        pushed ? head : beforePush.ref.target.oid,
        "failure",
        "Published task metadata requires reconciliation",
      );
    throw error;
  }
}

function main() {
  if (command === "help")
    return {
      help: `GitHub operations use the existing gh login; no token configuration.
  config | project-setup | queue
  status --issue N --status 'Ready'   Product Owner only for new scope
  claim --issue N --run RUN          Bound coordinator only
  evidence --pr N --run RUN --review-task TASK --verification-commit SHA --static-check-commit SHA --verification 'observed details or deferred reason'
  review --pr N                     Request cloud review once per PR
  publish --run RUN --issue N --branch task/N-description --baseline SHA
                                    Create/verify native issue-linked branch, then fast-forward push local HEAD
  validate --pr N                   Read-only current metadata validation
  validate --pr N --run RUN         Also refresh the required metadata status
  create --run RUN --branch task/N-description --title-file PATH --body-file PATH
  edit --run RUN --pr N --title-file PATH --body-file PATH
  merge --run RUN --pr N            Fresh metadata + exact-head local evidence + cloud completion
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
  if (
    ["publish", "create", "edit", "merge"].includes(command) ||
    (command === "validate" && values.run)
  )
    coordinator();
  if (command === "publish") return publish();
  if (command === "create") return createPull();
  const number = numeric(values.pr);
  if (command === "validate")
    return values.run ? refreshMetadata(number) : validateMetadata(snapshot(number));
  if (command === "edit") return editPull(number);
  const pull = pr(number);
  if (
    pull.state !== "OPEN" ||
    pull.isDraft ||
    pull.baseRefName !== "main" ||
    pull.headRepository?.nameWithOwner !== repo
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
      values["verification-commit"] !== reviewed ||
      values["static-check-commit"] !== reviewed
    )
      throw new Error("REVIEW_VERIFICATION_AND_STATIC_COMMIT_MISMATCH");
    if (!evidence(number, pull.headRefOid))
      post(
        number,
        `<!-- nina-evidence:${pull.headRefOid} -->\nLocal review: \`${values["review-task"]}\` in \`${values.run}\`.\n\nVerification at \`${reviewed}\`: ${values.verification}\n\n<!-- nina-local-static:${reviewed} -->\nCoordinator confirms local make check passed and all actionable local findings are resolved for this commit.`,
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
    const current = snapshot(number);
    if (current.pull.isDraft) throw new Error("ELIGIBLE_MAIN_PR_REQUIRED");
    if (current.pull.headRefOid !== pull.headRefOid) throw new Error("PR_HEAD_CHANGED");
    const metadata = checkedMetadata(current);
    const reread = snapshot(number);
    if (metadataDigest(reread) !== metadata.digest) {
      status(current.pull.headRefOid, "failure", "Metadata changed during merge preparation");
      throw new Error("PR_METADATA_CHANGED: restart merge checks");
    }
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
      commit.commit.message.trim() !== `${metadata.subject}\n\n${metadata.body}` ||
      issue.state !== "CLOSED" ||
      issue.parent?.number !== metadata.epic ||
      issue.parent?.state !== "OPEN"
    )
      throw new Error(
        "POST_MERGE_METADATA_MISMATCH: inspect squash message, task closure and open epic",
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
  console.log(
    JSON.stringify(["help", "config", "queue"].includes(command) ? main() : locked(main), null, 2),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
