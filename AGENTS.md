# Call Nina

Local-first language learning: Electron/React desktop, validated preload/IPC, SQLite, direct ChatGPT and provider adapters, and a separate local STDIO MCP plugin. Source and runtime observations establish implemented behavior.

## Working boundaries

- Work directly with the user as one agent using their selected model and effort; delegate only when asked. Inspect branch, worktrees, and tracked/untracked changes before editing. Preserve concurrent source work; development app data is disposable for verification.
- Implement requested scope and necessary small fixes; report unrelated findings. Keep delivery local unless the user requests commits, pushes, issues, PRs, merges, deployment, or release. One action does not authorize the others.
- Do not add unsolicited explanatory, reassurance, implementation, or diagnostic text to the app. Add such UI copy only when the user explicitly requests it; otherwise use credential-free logs. Keep requested controls and essential status/error feedback concise.
- No automated application tests, fixtures, mocks, saved journeys, or regression suites. Verify real behavior interactively unless the user explicitly takes ownership of verification; in that case leave checks to them and report unverified behavior. Run `make check` only when static verification is requested or preparing/updating a PR. Independent review is optional.
- Release builds and publication use manually dispatched GitHub Actions. Keep push/PR/tag/schedule publishing and automatic Vercel Git deployments disabled; setup does not authorize running a release. Keep learner content, credentials, raw protocols, and private paths out of logs and Git.
- Test directly in the running development app by default; no separate owned session, reservation or additional permission is required. Agents may change settings, run AI, create/edit/delete existing user data, reset development app state, and stop/restart the development app as needed for the task. Restoration of development data/settings is optional unless requested. Identify the correct app, data root and processes first; this authorization excludes production/hosted data, unrelated applications and concurrent source work. A running app does not block source edits; observations apply only to the source/build inspected. Use the verification skills for tool-specific workflows.
- Keep durable technical guidance in skills, legal notices in `docs/`, and curriculum product data in `content/curriculum/`. Do not add parallel manuals or progress files.

## Skill routing

- [Development](.agents/skills/call-nina-development/SKILL.md): repository workflow, package boundaries, data preservation, installation, service configuration, and build commands. Read for repository implementation work.
- [Desktop UI](.agents/skills/call-nina-desktop-ui/SKILL.md): renderer design, accessibility, and localization.
- [Codex integration](.agents/skills/call-nina-codex-integration/SKILL.md): direct ChatGPT/provider connections, Codex handoff, MCP, and plugin contracts.
- [Hosted API and administration](.agents/skills/call-nina-hosted-admin/SKILL.md): hosted runtime, authentication, accounting, and combined hosting.
- [Nina admin](.agents/skills/nina-admin/SKILL.md): agent-driven accounts, allowances, credentials, infrastructure setup, and explicit deployment.
- [Electron verification](.agents/skills/call-nina-electron-verification/SKILL.md) / [Android verification](.agents/skills/call-nina-android-verification/SKILL.md): real app inspection and controlled interactions.
- [Curriculum research](plugins/call-nina/skills/curriculum-research/SKILL.md): reusable curriculum authoring. [Language teaching](plugins/call-nina/skills/german-teacher/SKILL.md): learner practice, not development.
