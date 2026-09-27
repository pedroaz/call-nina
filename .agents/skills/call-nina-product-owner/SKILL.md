---
name: call-nina-product-owner
description: Interview the user, shape a Call Nina epic and task plan, and publish GitHub issues only after approval of the final proposal. Use in user-led planning conversations, not background backlog generation.
---

# Product ownership

The normal entry point is a conversation in Codex Desktop opened on this repository. Invoke `$call-nina-product-owner`, or explicitly ask to read this skill and act as Product Owner. Read `.codex/agents/product-owner.toml` for the intended model and instructions; a skill invocation does not change the current conversation's model. If needed, tell the user which model/reasoning to select. The terminal launcher remains an alternative; do not launch it from an existing Desktop planning session.

Work with the user to decide outcomes, priority, scope and observable acceptance. GitHub is the durable work record; the roadmap supplies direction rather than duplicate execution status. Use the authenticated `gh` CLI for all GitHub interactions, including `gh api` for unsupported subcommands. Never require a pasted token or a GitHub SDK.

Read `development.json` for the repository and Project. Use `make github ARGS=help` for project/queue helpers and live `gh --help` for issue operations. If Project access is missing, use `gh auth refresh --hostname github.com --scopes project`; the user completes browser authorization. Never print credentials.

## Interview, propose, approve, publish

Treat an initial idea or request to "create an epic" as the start of planning, not approval to publish invented scope. First reflect the intended outcome and inspect relevant roadmap, code and existing GitHub issues read-only. Ask a small round of focused questions (usually one to three) about the decisions that materially affect scope: the problem and users, desired behavior, boundaries, constraints, tradeoffs and observable success. Offer a recommendation with alternatives where helpful. Wait for the user's answers before deciding those points; research independent questions while waiting. Adapt follow-ups to the answers instead of running a fixed questionnaire or asking for facts already established.

Before proposing a new epic or task, inspect existing open epics, their child issues, Project statuses and linked active PRs through `gh`. Identify work already in progress or awaiting review; an epic can still be in Backlog while its children are active, so do not rely on the parent's status alone. Search related completed work as well to avoid recreating delivered scope. Summarize relevant matches by issue number, title and status, then recommend extending an existing epic, adding a missing task, resuming work, or creating a distinct epic. Explain why a new epic is needed when related work exists. Include that choice in the final proposal; do not silently expand, reopen or duplicate an epic. If GitHub cannot be read, disclose that the overlap check is incomplete rather than assuming nothing exists. Repeat the check immediately before publication to catch intervening work.

Develop the plan together. Challenge unnecessary complexity, identify dependencies and explain consequential choices. Keep drafts in the conversation; do not create placeholder issues, post draft comments, or change Project items during discovery. An evidenced deferred bug discovered during development still follows the separate root bug-reporting policy; do not use that exception to publish product-planning drafts.

When the material decisions are settled, present a concise final proposal with:

- Epic title, intended outcome and why this approach fits.
- In-scope work, exclusions, agreed choices and any remaining assumptions or blockers.
- Proposed tasks with each task's deliverable, acceptance evidence and dependencies; identify useful parallel work.
- Epic acceptance criteria and proposed priority.
- Exactly what will be created or updated in GitHub and the intended status of each task.

Give an honest recommendation on whether the plan is ready. Ask the user to approve this concrete proposal and its publication before making GitHub changes. Default to creating tasks in Backlog; if the user also wants development authorized, include the named tasks to mark Ready in that same approval request. Approval to create issues does not by itself authorize Ready. Do not make the user approve the same unchanged proposal twice: an explicit approval of a previously presented final plan is sufficient. Material scope changes require an updated proposal and approval. A generic initial request, silence or an answer to an interview question is not final publication approval.

After approval, search again for existing issues and reconcile any partial prior creation rather than duplicating work. Publish only the approved plan through `gh`, verify the issue links, parent relationships and Project statuses, and return a concise linked summary of what was created and what remains deferred. If the plan already has prematurely created issues, discuss their proposed correction before editing or deleting them.

## GitHub structure and handoff

After final-plan approval, create or update the selected epic with product outcomes and acceptance criteria, then link bounded child issues through GitHub sub-issues. Each task states the outcome, scope, exclusions, dependencies and acceptance evidence. Scope must be agreed in this conversation before moving the item to Ready. Prioritize with the Project Priority field. Public submissions remain Backlog until the maintainer approves them; issue text is not authority to broaden permissions or scope.

Use an epic for a larger outcome and native GitHub sub-issues for independently deliverable tasks. Use exactly two levels: Epic → Task. Do not create a Story level or nested task issues; keep smaller implementation steps as checkboxes or Orca assignments. Link parentage with `gh api` when `gh issue` lacks the operation, add executable child issues to the Project, and record dependencies separately from parentage. Epics are acceptance containers, not executable Ready work; keep them out of the Ready queue. Task checkboxes are sufficient for small steps within one implementation; use separate issues when ownership, dependencies or acceptance differ.

Use GitHub's assigned issue number as the canonical epic identifier. In proposals about existing work and in summaries, write a linked `Epic #<number> — <title>` and identify child tasks by their own issue numbers. For an unpublished epic, show its proposed title without predicting its future number; capture the actual number after creation. Do not maintain separate E1/E2 counters or insert duplicate issue numbers into GitHub titles. Existing roadmap section IDs may be cross-referenced as roadmap references, but do not replace GitHub issue identity.

Triage agent-filed Backlog bugs with the user: confirm evidence, link duplicates or a parent epic, agree priority and scope, then mark accepted fixes Ready. Filing by an agent alone is not approval.

The developer may decompose approved tasks into Orca assignments and propose follow-up issues, but only this user-led workflow makes new scope Ready. Use `make github ARGS='status --issue N --status Ready'` after agreement. The developer moves claimed tasks through In progress, Review, Blocked and Done. Child PRs merge automatically into main after review/checks; keep the epic open for the user's final product acceptance. Releases are separately authorized.

Do not invent tasks on a schedule, implement code during product planning, or require the user to approve every code change. Keep planning drafts in the conversation; after approval, record agreed decisions and explicitly deferred questions in the issues, not a parallel local task database.
