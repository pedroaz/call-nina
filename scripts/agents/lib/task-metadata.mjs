import { createHash } from "node:crypto";

export const metadataContext = "nina/task-metadata";
const headerPattern =
  /^(feat|fix|docs|refactor|perf|build|ci|chore|style|revert)(?:\([^\s()]+\))?(!)?: \S[^\r\n]*$/;

export function taskBranch(branch, expected) {
  const match = /^task\/([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(branch ?? "");
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new Error("TASK_BRANCH_REQUIRED: task/<issue>-<short-kebab-description>");
  const number = Number(match[1]);
  if (expected !== undefined && number !== Number(expected))
    throw new Error("BRANCH_TASK_MISMATCH");
  return number;
}

export function conventionalHeader(header) {
  const match = headerPattern.exec(header ?? "");
  if (!match || header !== header.trim())
    throw new Error(
      "CONVENTIONAL_HEADER_REQUIRED: type(scope): description (optional scope and !)",
    );
  return { breaking: Boolean(match[2]) };
}

// Keep line positions, but never accept examples or hidden comments as active metadata.
export function activeMarkdown(text) {
  let fence;
  const visible = text
    .replace(/<(pre|code)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, (part) => part.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?(?:-->|$)/g, (part) => part.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          /^ {0,3}(?:`+|~+)\s*$/.test(line)
        )
          fence = undefined;
        return "";
      }
      if (marker) {
        fence = marker[1];
        return "";
      }
      if (/^(?: {4}|\t| {0,3}>)/.test(line)) return "";
      return line;
    })
    .join("\n");
  // Code spans can cross lines; a closing run must have the opening run's exact length.
  const runs = [...visible.matchAll(/`+/g)];
  // Use UTF-16 offsets like matchAll (rather than code point indices).
  const masked = visible.split("");
  for (let i = 0; i < runs.length; i++) {
    const end = runs.findIndex((run, j) => j > i && run[0].length === runs[i][0].length);
    if (end < 0) continue;
    for (let j = runs[i].index; j < runs[end].index + runs[end][0].length; j++)
      if (masked[j] !== "\n") masked[j] = " ";
    i = end;
  }
  return masked.join("");
}

export function footers(message) {
  const raw = message.replace(/\r\n/g, "\n").split("\n");
  const active = activeMarkdown(message.replace(/\r\n/g, "\n")).split("\n");
  const token = /^(BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][A-Za-z0-9-]*): /;
  const start = active.findIndex((line, i) => token.test(line) && i > 0 && !raw[i - 1].trim());
  if (start < 0) return [];
  const result = [];
  for (let i = start; i < raw.length; i++) {
    const match = token.exec(active[i]);
    if (match) {
      if (!raw[i].slice(match[0].length).trim()) throw new Error("FOOTER_DESCRIPTION_REQUIRED");
      result.push({ token: match[1], lines: [raw[i]] });
    } else result.at(-1).lines.push(raw[i]);
  }
  return result.map(({ token, lines }) => ({
    token,
    block: lines.join("\n").trimEnd(),
    value: lines
      .join("\n")
      .slice(token.length + 2)
      .trimEnd(),
  }));
}

export function breakingBlocks(message) {
  return footers(message)
    .filter((item) => ["BREAKING CHANGE", "BREAKING-CHANGE"].includes(item.token))
    .map((item) => item.block);
}

export function validateCommit(message, task) {
  const header = conventionalHeader(message.split(/\r?\n/)[0]);
  const refs = footers(message).filter((item) => item.token === "Refs");
  if (refs.length !== 1 || refs[0].value !== `#${task}`)
    throw new Error(`TASK_REFS_FOOTER_REQUIRED: Refs: #${task}`);
  return { ...header, blocks: breakingBlocks(message) };
}

export function taskIssue(issue, repo, number) {
  if (
    issue?.number !== number ||
    issue.repository?.nameWithOwner !== repo ||
    issue.state !== "OPEN"
  )
    throw new Error("OPEN_REPOSITORY_TASK_REQUIRED");
  if (
    !issue.parent ||
    issue.parent.number === number ||
    issue.parent.repository?.nameWithOwner !== repo ||
    issue.parent.state !== "OPEN"
  )
    throw new Error("OPEN_NATIVE_PARENT_EPIC_REQUIRED");
}

export function validateMetadata(snapshot, { candidate = false } = {}) {
  const { repo, pull, issue, commits } = snapshot;
  if (
    pull.headRepository?.nameWithOwner !== repo ||
    pull.baseRefName !== "main" ||
    pull.state !== "OPEN"
  )
    throw new Error("SAME_REPOSITORY_OPEN_MAIN_PR_REQUIRED");
  const number = taskBranch(pull.headRefName);
  taskIssue(issue, repo, number);
  const title = conventionalHeader(pull.title);
  if (!commits.length) throw new Error("TASK_COMMITS_REQUIRED");
  const parsed = commits.map(({ message, oid }) => {
    try {
      return validateCommit(message, number);
    } catch (error) {
      throw new Error(`${oid}: ${error.message}`);
    }
  });
  const active = activeMarkdown(pull.body);
  if (!new RegExp(`^Closes #${number}\\s*$`, "m").test(active))
    throw new Error(`TASK_CLOSURE_REQUIRED: Closes #${number}`);
  // The outgoing squash commit is raw text, including its title, examples and
  // comments. Markdown visibility only determines required PR metadata above;
  // it must never exempt text from the commit's closing-keyword safety check.
  const squashMessage = `${pull.title}\n\n${pull.body.trim()}`;
  const closures = [
    ...squashMessage.matchAll(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/|([\w.-]+\/[\w.-]+)?#)([1-9]\d*)\b/gi,
    ),
  ];
  if (
    closures.some(
      (match) =>
        Number(match[3]) !== number ||
        ((match[1] || match[2]) && (match[1] || match[2]).toLowerCase() !== repo.toLowerCase()),
    )
  )
    throw new Error("ONLY_TASK_MAY_BE_CLOSED");
  const epic = `https://github.com/${repo}/issues/${issue.parent.number}`;
  if (!new RegExp(`${epic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s)\\]<>?#])`).test(active))
    throw new Error(`PARENT_EPIC_LINK_REQUIRED: ${epic}`);
  if (
    !candidate &&
    (snapshot.closingIssues.length !== 1 ||
      snapshot.closingIssues[0].number !== number ||
      snapshot.closingIssues[0].repository?.nameWithOwner !== repo)
  )
    throw new Error("GITHUB_TASK_CLOSURE_MISMATCH");
  const bodyRefs = footers(pull.body).filter((item) => item.token === "Refs");
  if (bodyRefs.length !== 1 || bodyRefs[0].value !== `#${number}`)
    throw new Error(`PR_REFS_FOOTER_REQUIRED: Refs: #${number}`);
  const blocks = [...new Set(parsed.flatMap((commit) => commit.blocks))];
  const bodyBlocks = breakingBlocks(pull.body);
  if (blocks.some((block) => !bodyBlocks.includes(block)))
    throw new Error(
      "PR_BREAKING_FOOTERS_REQUIRED: preserve every distinct source breaking block verbatim",
    );
  if (parsed.some((commit) => commit.breaking) && !title.breaking && !bodyBlocks.length)
    throw new Error("PR_BREAKING_SIGNAL_REQUIRED: ! title or explicit breaking footer");
  return {
    task: number,
    epic: issue.parent.number,
    subject: pull.title,
    body: pull.body.trim(),
    digest: metadataDigest(snapshot),
  };
}

export function metadataDigest(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
