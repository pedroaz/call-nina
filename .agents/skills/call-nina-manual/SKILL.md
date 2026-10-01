---
name: call-nina-manual
description: Direct user-led Call Nina feature development outside Orca, only when the user explicitly invokes Manual or $call-nina-manual. Default to local edits and return control without automatic delivery.
---

# Manual

Use only on explicit user invocation. A request to create, edit or discuss this skill does not activate it. The requested feature scope authorizes local implementation under the root `AGENTS.md` Manual exception; no GitHub task, Ready status, claim, Run, Dispatch, worker or orchestrated resource bookkeeping is required. Do not start Orca or invoke its delivery cycle implicitly.

Read root/scoped `AGENTS.md` and relevant technical skills, then inspect the owning code and callers. Preserve their data, security and component boundaries; their orchestration defaults do not override Manual routing.

- Before editing, inspect branch, worktrees and tracked/untracked status read-only. Honor the user's explicitly selected checkout when safe; use an owned branch/worktree through ordinary Git when isolation is needed. Do not require an issue number or Orca workspace. Preserve concurrent edits and never take another agent's active checkout, fixed verification worktree or app/browser session. Uncertain ownership requires a different safe checkout or a concrete ownership clarification.
- Implement the requested scope directly, including small fixes needed to build or verify it. Preserve learner data, credentials, validated IPC/MCP/AI/persistence boundaries and exact process ownership. Do not reset data or weaken validation to make a feature appear working.
- Use focused checks and proportionate interactive verification. No automated application tests, saved journeys, fixtures or mocks. Use the relevant platform skill when interacting with the app and preserve its data, model, cleanup and session safety rules. If a verification command requires unavailable coordinator authority or an occupied session, report that limitation; do not start Orca, bypass a guard or take over the session. Local edits require neither a full independent review cycle nor `make check` unless requested; PR delivery retains both gates.
- Return concise changes, checks actually performed and remaining limitations, then return control to the user. Local implementation is not full acceptance or release readiness. Report unrelated findings here without automatically filing issues or reconciling Projects. Do not automatically commit, push, open/merge PRs, or perform orchestration cleanup.

Later explicit commit, push or PR requests authorize only the requested delivery scope and do not silently restart Orca. Use ordinary Git and authenticated `gh` as applicable, Conventional Commit titles and truthful issue references when associated; do not invent tasks or issue metadata. Before preparing/updating a PR, obtain independent exact-head local review, fix actionable findings, run local `make check` and record the commit, results and deferred behavior checks. Honor remote protections and report any unavailable gate rather than bypassing it. A PR request does not authorize merge, deployment or release. Only an explicit mode change opts into orchestration, and Manual never settles or transfers another session's existing obligations or resources.
