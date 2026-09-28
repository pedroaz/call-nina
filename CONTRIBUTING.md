# Contributing to Call Nina

Bug reports with clear reproduction steps are welcome. The project is currently shaped around its maintainer's learning workflow, so feature contributions and roadmap proposals may not receive review.

Before reporting a problem, remove learner text, prompts, credentials, private paths, raw protocol messages, databases, and unredacted logs. Include the operating system, architecture, Call Nina revision, the command that failed, and only the bounded redacted diagnostic code.

If you prepare a code change, read `AGENTS.md` and the scoped instructions beside the affected application. Keep Electron renderer code browser-only, validate every external boundary, preserve learner data, and do not add automated application tests or saved journeys. Use the documented Make targets and verify affected behavior interactively in the real application.

## Agent development

Plan product scope through a Product Owner interview and approve the final epic/task proposal before it is published to GitHub, including Backlog planning issues. Mark tasks Ready only when their implementation is explicitly approved. All code reviews are local only. The developer orchestrator owns code, independent exact-head local review, PR creation and automatic merge into main. The coordinator closes epics only after all native child outcomes, required merges and epic acceptance are verified, accounting explicitly for cancelled, duplicate or not-planned children; incomplete epics stay open with remaining criteria. Public proposals do not authorize autonomous implementation.

Use `gh` for GitHub operations and Orca for workers. Roles live in `.codex/agents`; workflows live in `.agents/skills`. Run `make check` locally when preparing or updating a PR, review the exact commit locally, and record both results in the PR. Hosted CI and automatic deployment pipelines are disabled until explicitly reauthorized. Setup-only changes may defer interactive application verification, but must say so explicitly. Do not bypass required checks or publish releases without authorization.
