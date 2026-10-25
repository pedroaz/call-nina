---
name: call-nina-electron-verification
description: Inspect the real Call Nina Electron UI with available computer-use tools or manual user verification. No custom controller or automated application tests.
---

# Interactive Electron verification

Use the ordinary app: `make dev` for development, or `make build` followed by `make start` for the built desktop. Inspect `make status` first; reuse an existing user app for observation. Do not stop user-owned processes without authorization. Stop a session you launched with `make stop`.

Inspect the actual Electron window using available native computer-use or screenshot tools. Browser tabs alone do not establish Electron behavior. If native tools are unavailable, ask the user to perform the specific UI check and report it as unverified until they do. Do not recreate a Playwright controller, verification server, chat-bound reservation, journal/recovery workflow, saved journey or test suite.

Visual evidence, behavior acceptance and process exit are separate results. Identify the app window and source/build observed. A running app does not block source edits; earlier observations do not verify later edits. Stop an owned session before rebuilding its running artifacts.

Preserve drafts, exercises, learner records and settings. Observation does not authorize AI calls or persisted changes. For an authorized behavior check, perform one bounded UI action, inspect its result, then decide the next action. Record original settings before changing them; restore only your changes if no later user edit conflicts. Remove only proven session-created records through UI. Never edit SQLite to simulate behavior or delete uncertain records. Report unfinished cleanup directly; it never reserves or blocks startup.

Live AI checks use the real direct ChatGPT connection with GPT-6 Luna at runtime-default effort; the managed-service skill owns its explicit starter-pilot exception. Confirm the selected route and model in the UI before generation. Report actual calls and unexercised behavior.

Use `make logs ARGS="--component desktop"` for bounded redacted diagnostics, adding `--follow` only when needed. Keep learner text, credentials, raw protocols and screenshots out of Git and logs. No automated application tests. Run static checks only when requested or preparing a PR.
