---
name: call-nina-manual
description: Default user-led local Call Nina development and verification, without Orca or automatic publication. Use unless the user explicitly selects orchestrated delivery.
---

# Manual

Manual is the default for user-led local development. `$call-nina-manual` explicitly selects it; invoking another technical skill does not switch modes. Use Orca only for an explicitly requested coordinated batch or delivery. Existing orchestration resources remain owned by their original Run.

## Local work

- Inspect branch, worktrees and tracked/untracked status before editing. Honor the selected safe checkout, preserve concurrent work and use ordinary Git isolation when needed. No issue, Ready status, claim, worker or Project bookkeeping is required for local changes.
- Read the relevant technical skill and owning code. Preserve learner data, credentials, validated boundaries and exact process ownership. Never reset data to make a feature appear working.
- Implement the requested scope and necessary fixes, run focused checks and report actual results. No automated application tests, fixtures or saved journeys. Run `make check` only on request or for PR delivery.
- Visual inspection of an open app needs no managed verification session. Follow the [Electron skill](../call-nina-electron-verification/SKILL.md) for observation and controlled interactions. A blocked managed session does not block unrelated development.
- Do not automatically commit, push, open/merge PRs, publish issues, launch Orca or clean up another Run. Return control after local work; report unrelated findings in chat.

## Verification recovery

`make verify-session-status` separates reservations, process artifacts and cleanup history. `make verify-stop` releases a Manual reservation after proven process exit even when cleanup is pending; it preserves the journal and reports the unfinished work.

A user request to resume or repair abandoned Manual verification authorizes `make verify-manual-recover ARGS="--run <reported-run>"`. It requires exact stop evidence and archives the previous ownership before release. It never adopts active processes or Orca resources. Enter the desired checkout with `make verify-manual-enter`; a compatible pending journal directs the new chat to `make verify-resume` with the current build. Do not fabricate the old chat identity or edit state files.

For incompatible or deliberately retired automation, inspect its journal and use `make verify-manual-quarantine ARGS="--journal-sha <reported-fingerprint>"` only under a user-authorized recovery/cleanup request. This retains a private unresolved record and leaves learner data untouched. Quarantine is not successful restoration or verification acceptance; uncertain records must never be deleted merely to settle the journal. Retained history remains visible in status.

## Delivery

Explicit commit, push or PR requests authorize only that scope and remain Manual. Use ordinary Git and authenticated `gh`, Conventional Commit titles and truthful issue references. PRs require independent exact-head local review, fixes for actionable findings and passing local `make check`; record deferred behavior checks. A PR request does not authorize merge, deployment or release. Report an unavailable gate without silently starting Orca or blocking unrelated local work.
