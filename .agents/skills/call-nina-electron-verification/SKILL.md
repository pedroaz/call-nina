---
name: call-nina-electron-verification
description: Inspect Call Nina's real Electron UI and perform bounded interactive behavior checks. Supports direct visual inspection and owned Playwright sessions; no automated application tests.
---

# Interactive Electron verification

Choose the smallest useful check. Visual evidence, behavior acceptance, process exit and cleanup completion are distinct results. Do not turn a problem in one into a blanket development blocker. No application test suites, saved journeys, fixtures, mocks or screenshot regression suites.

## Visual inspection

Inspect an already-open user app with available screenshot/UI tools for layout, typography, color, icons and text density. No reservation, frozen checkout, Orca or historical recovery is required. Identify the app window first, preserve visible drafts and active exercises, and keep screenshots out of Git and diagnostic logs. Focusing or observing a window does not transfer lifecycle ownership.

Do not stop the user's app, change persisted settings, run AI or create/delete learner records through this observation path. Use an owned controlled session for persistent effects. Report the screens and sizes actually observed; do not claim behavior acceptance from a screenshot.

## Controlled Manual session

1. Inspect `make verify-session-status` and `make status`. Build with `make build-desktop`, enter with `make verify-manual-enter`, then follow its `verify-start` or `verify-resume` instruction. Never kill another app to acquire a session. Manual entry needs no Orca or committed source.
2. The reservation binds the current chat and desktop/runtime/controller inputs. Unrelated documentation and website edits do not invalidate it. Keep relevant source unchanged while running; stop before rebuilding. A stopped session can enter under a new chat and current source with its compatible journal preserved. Historical observations retain their original build identity.
3. Observe with `make verify-inspect` or `make verify-shot`. Send one bounded JSON action on stdin to `make verify-do`, inspect the result, then decide the next action. Read request validation in `scripts/dev/verify.mjs` for available actions; never inject JavaScript or edit the database to simulate user behavior.
4. Before live generation, run `prepare-ai`: use Nina’s real direct ChatGPT connection, GPT-6 Luna and runtime-default effort. Never substitute another model/provider. Settings baselines are recorded before mutations, and cleanup must not overwrite later user changes.
5. Before creating an activity/material, run `begin-records` with the library kind; track the ID observed after creation. Capture/track edited material revisions too. Cleanup removes only proven session-owned records through UI, including dependent session-owned history. No broad personal-data cleanup. Unknown effects stay unresolved.
6. Finish with `make verify-stop`. It restores session changes where supported, stops only exact-owned processes and releases the Manual reservation after proven exit. Cleanup failure remains a private recovery item and a failed cleanup result, not a live process claim. `make verify-manual-leave` is idempotent after release. `verify-suspend` deliberately retains the reservation for a short same-session restart.

Stopping never needs another permission request for this session's exact-owned processes. Graceful shutdown is bounded; escalation requires recorded process identity, not names, groups or guessed PIDs. A timeout does not establish whether an action ran. Inspect receipts before retrying an uncertain mutation.

## Recovery and interruption

Use `verify-session-status` to see what is blocked and the supported next action. For user-authorized recovery of a stopped Manual session, use `verify-manual-recover` with its exact reported run. It archives ownership and cleanup evidence, checks exact stop proof and releases exclusion without declaring cleanup complete. Enter the original checkout and resume with corrected source when needed. Active processes and Orca ownership are never transferred by this command.

Incompatible journals can be explicitly quarantined by their reported SHA through `verify-manual-quarantine` under a recovery/cleanup request. The full original is retained privately with unresolved status; learner records and preferences are untouched. Do not translate obsolete settings by guesswork or delete uncertain records. Do not keep retrying the same rejected operation. Source work, builds and visual inspection remain available.

Restoration uses current persisted-state readback, not the permanent presence of a Save button. Already-correct settings need no write. Values different from both the original and the session's observed result are a conflict: preserve them, retain the obligation and report it. Unknown interrupted effects require evidence; do not treat a successful screenshot as proof of no mutation.

## Explicitly orchestrated sessions

Only an explicitly selected Orca workflow requires a coordinator reservation, dedicated fixed-commit checkout and worker handoff. Its active ownership must be resolved by the authenticated coordinator. Manual recovery never adopts Orca resources.

Use the implemented recovery contracts in `scripts/dev/lib/verification-recovery.mjs`, `verification-client.mjs` and `scripts/agents/lib/orchestration.mjs` for immutable-checkout controller recovery, source advancement and historical-effect reconciliation. These commands require exact Run, revision, journal and process evidence; do not invent proofs or remove guards. Keep controller provenance separate from app provenance. Reuse successful evidence for unchanged behavior; perform consolidated verification after a refactor, not after every intermediate edit.

## Evidence

Inspect bounded redacted diagnostics with `make logs-once ARGS="--component desktop"`. Never publish learner text, prompts, credentials, raw protocols or private paths. Report changed-source checks, observed UI/behavior, live AI use, process state and pending cleanup separately. Missing behavior evidence blocks only the dependent acceptance claim; it does not prohibit unrelated authorized development.
