---
name: call-nina-electron-verification
description: Open and operate the real Call Nina Electron app to inspect and verify changed behavior during development, using persistent Playwright controls, screenshots, and redacted logs. This is interactive verification, not automated tests or saved journeys.
---

# Interactive Electron verification

Give the development agent a live app it can observe, operate, and reason about one action at a time. Do not create or run automated application tests, saved scenarios, test runners, mocks, fixtures, coverage gates, or unattended checks.

This skill describes how to verify, not a requirement to launch the app after every change. Under the root exploration/refactor policy, skip or defer this loop while the app is intentionally incomplete; a broken intermediate build is not a reason to stop implementation. Report what remains unverified and run a consolidated interactive round once the refactor is integrated, before claiming working or release-ready behavior. An explicit verification request still takes precedence. When a session is run, all data, model, ownership and cleanup rules below apply.

Run commands from the repository root. Inspect `Makefile`, `scripts/dev/verify.mjs`, `scripts/dev/lib/verification-client.mjs` and `scripts/dev/lib/verification-session.mjs` for accepted action fields, limits and recovery behavior. The controller uses Playwright's Electron API without a test runner. Read the current dispatcher before constructing an unfamiliar action; do not maintain a duplicate command/API manual.

## Development loop

1. Identify the behavior changed and the smallest useful interaction. Inspect relevant redacted logs first when reproducing a bug.
2. Have the coordinator reserve the dedicated worktree at a clean commit with `verify-enter`, then run `make verify-start` there. It builds once and opens the real Electron app, using the current learner dataset and connected Codex account. For installer work, `make verify-start ARGS="--executable /absolute/app --config-dir /absolute/config"` selects the installed app and an explicit configuration directory. Startup inspection also accepts onboarding screens. Refuse conflicting/unsafe process ownership; never kill another app to obtain a session. Stop/restart after source changes so observations match the new build.
3. Use `make verify-inspect` or `make verify-shot` to observe the screen. Send a single bounded JSON action on stdin to `make verify-do`, inspect the result, and choose the next action. Do not pass JavaScript evaluation or bypass preload/IPC/persistence with database edits.
4. Before any generation, call `prepare-ai`. It selects runtime-reported `gpt-6-luna` and default reasoning through Settings, saves prior preferences, and verifies the saved choice. If unavailable, stop that AI check and report it; do not substitute another model. Local UI checks need no generation. Do not change model preferences while exercising AI behavior.
5. Before creating an activity, call `begin-records` for its library. After creation, use `openedActivityId` from inspection and call `track`. Delete only this session's records through `cleanup` or `verify-stop`. Restore other settings you change through the UI; record an unresolved side effect with `note` rather than hiding it.
6. Run `make verify-stop` when done. It restores model preferences/language, cleans up tracked activities through the UI, and closes the owned process. Inspect its cleanup result. Leave ambiguous records intact and report recovery requirements.

Send one action as JSON on stdin, for example:

```sh
make verify-do <<'JSON'
{"action":"click","target":{"role":"button","name":"Practice"}}
JSON
```

Use accessible roles and labels from the current UI snapshot. Check the controller for other target forms. For a stopped session with unresolved recovery state, use `make verify-resume` to retain its tracked records and original preferences, then resolve them through the UI. Inspect exact record/process references and restore through the UI; never delete ambiguous records or ownership files just to unblock startup.

## Evidence and failures

Use `make logs-once ARGS="--component desktop"` with explicit filters for bounded redacted evidence. During a long action, request `status`; `VERIFY_BUSY` means the session is still executing, not permission to retry generation. Inspect the first failure before deciding whether a retry is useful.

Screenshots and visible UI snapshots may be shown in the agent session. Do not copy learner content into logs, Git, persistent trace/video archives, or reports. The screenshot is deleted on graceful stop. Native OS dialogs and external Codex Voice are outside this controller's scope.

Report the behavior actually observed, whether a real Luna generation ran, settings/record cleanup, and what remains unverified. A successful launch or source review does not establish that the changed behavior works. Do not add a saved test as a substitute for completing an interactive check.
