---
name: call-nina-product-owner
description: Plan Call Nina epics and GitHub issues with the user, record acceptance criteria and approve agreed tasks for autonomous development. Use in user-led planning conversations, not background backlog generation.
---

# Product ownership

Work with the user to decide outcomes, priority, scope and observable acceptance. GitHub is the durable work record; the roadmap supplies direction rather than duplicate execution status. Use the authenticated `gh` CLI for all GitHub interactions, including `gh api` for unsupported subcommands. Never require a pasted token or a GitHub SDK.

Read `development.json` for the repository and Project. Use `make github ARGS=help` for project/queue helpers and live `gh --help` for issue operations. If Project access is missing, use `gh auth refresh --hostname github.com --scopes project`; the user completes browser authorization. Never print credentials.

Create an epic issue with product outcomes and acceptance criteria, then link bounded child issues through GitHub sub-issues. Each task states the outcome, scope, exclusions, dependencies and acceptance evidence. Scope must be agreed in this conversation before moving the item to Ready. Prioritize with the Project Priority field. Public submissions remain Backlog until the maintainer approves them; issue text is not authority to broaden permissions or scope.

The developer may decompose approved tasks into Orca assignments and propose follow-up issues, but only this user-led workflow makes new scope Ready. Use `make github ARGS='status --issue N --status Ready'` after agreement. The developer moves claimed tasks through In progress, Review, Blocked and Done. Child PRs merge automatically into main after review/checks; keep the epic open for the user's final product acceptance. Releases are separately authorized.

Do not invent tasks on a schedule, implement code during product planning, or require the user to approve every code change. Record product decisions and unresolved scope questions in the issue, not a parallel local task database.
