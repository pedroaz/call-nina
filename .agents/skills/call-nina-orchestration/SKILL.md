---
name: call-nina-orchestration
description: Develop approved Call Nina GitHub issues through Orca workers, isolated branches, independent review and automatic PR merging. Use for Ready work and explicit development batches.
---

# Autonomous development

GitHub owns product scope, Orca owns execution, and Git owns integration. Read root/scoped rules and relevant development skills. All GitHub operations use authenticated `gh`; use `gh api` for gaps. Settings are explicit in `development.json`. Never use separate token configuration, a GitHub SDK or connector.

## Pick up and coordinate

Use `make github ARGS=queue` to inspect approved Ready work and existing claims. Recurring intake is disabled until the committed baseline is published, Project permissions work and supervised startup has been demonstrated. One scheduled wake-up runs every 15 minutes; it resumes existing work before claiming anything, stays quiet without actionable change, and does not create another coordinator when one owns the repository. Do not add another scheduler.

Read `make orchestrate ARGS=help` and the installed Orca CLI orchestration skill. Use the explicit resolved IDE executable; Linux `/usr/bin/orca` is unrelated. Read version-matched receipt/recovery guidance rather than retaining a command manual here. Bind the Run using its proven coordinator handle. After interruption, reconcile Run/Task/Dispatch and GitHub issue/PR state before any launch. Unknown outcomes never authorize duplicate dispatch.

The coordinator decides parallel issues or subtasks by actual interface dependencies and ownership. At most three workers and two writers. Every assignment names the outcome, owned paths, exclusions, dependencies, relevant skills and acceptance evidence. Role files own model/effort; the launcher verifies effective settings. Workers never create workers. Inconclusive explorer results return to the coordinator; escalate a hard problem once to the architect, then report a concrete blocker.

## Discovered bugs

Follow the root bug policy. Workers report findings through Orca; the coordinator searches GitHub before creating one bug issue, adds it to the configured Project as Backlog, and returns the issue link to the worker and originating task. Use `.github/ISSUE_TEMPLATE/bug.yml` as the issue-body guide when authoring through `gh`. Record whether it blocks acceptance and whether its owned files/contracts permit independent work. For an already-approved fix, attach a separate Orca task to the current Run and honor dependencies and writer limits. Unrelated bugs remain Backlog for Product Owner triage, even if they would be easy to parallelize. If filing fails, retain the finding in the Run and report the failure; do not claim an issue exists.

## Branches and integration

Create separate Orca writer worktrees from an explicit committed baseline. Never copy or automatically commit an unrelated dirty checkout. Run `make setup` per new worktree; do not share dependencies, output or runtime data. Workers commit scoped changes on their own branches and never push or merge.

The coordinator alone integrates settled worker commits with normal Git. Check changed paths against assignments, inspect conflicts and preserve concurrent edits. Freeze only the verification checkout, never all unrelated writers. Keep worktrees until their commits are accounted for. Do not reset, clean or force-delete as recovery.

Process entire Orca message deliveries before acknowledging them. Reply to questions, validate completion against the active Dispatch and release only settled owned workers through Orca. Timeouts are checkpoints. Follow exact recovery receipts; never retry an uncertain mutation blindly.

## Review and merge

Run independent local review on the integrated commit using applicable Code Review Rules. Reviewer and verifier assignments require an explicit `commit`; launch them at that same baseline. Include the reviewed SHA in completion evidence. Corrections require a new review task bound to the corrected commit; never reuse a completed review to attest another SHA. Route findings to an implementation owner. Prepare PRs with `make check` (static only), acceptance evidence and explicit verification limitations.

For behavior changes, reserve a clean dedicated verification worktree at the integrated commit using `verify-enter`. The verifier uses interactive Electron controls and application Luna at runtime-default effort. No automated application tests or saved journeys. Stop the session and inspect cleanup before the coordinator calls `verify-leave`. Preserve earlier recovery journals; setup-only work does not launch the app.

Create PRs through gh with `Closes #N`. Record exact-head local review and verification evidence using the GitHub helper (`--verification-commit` must match the review assignment and PR head), then request cloud review once with its review command. Do not enable overlapping automatic review triggers. Missing completion blocks merging. Resolve cloud findings, locally re-review corrections and repeat only affected verification; do not request another cloud pass. Use the helper merge command to check exact-head evidence, passing static checks, cloud completion and resolved discussions before squash merging. Treat release publication separately.

Update task status through the Project helper. Keep epics open for user acceptance. Detach settled Runs with `finish`; retain receipts for recovery. Follow-up product scope stays Backlog until agreed with the Product Owner.
