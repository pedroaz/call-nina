# Call Nina

Local-first language learning: Electron/React desktop, validated preload/IPC, SQLite, direct ChatGPT and provider adapters, and a separate local STDIO MCP plugin. Source and runtime observations establish implemented behavior.

## Working boundaries

- Work directly with the user as one agent using their selected model and effort; delegate only when asked. Inspect branch, worktrees, and tracked/untracked changes before editing. Preserve concurrent work and learner data.
- Implement requested scope and necessary small fixes; report unrelated findings. Keep delivery local unless the user requests commits, pushes, issues, PRs, merges, deployment, or release. One action does not authorize the others.
- No automated application tests, fixtures, mocks, saved journeys, or regression suites. Verify real behavior interactively unless the user explicitly takes ownership of verification; in that case leave checks to them and report unverified behavior. Run `make check` only when static verification is requested or preparing/updating a PR. Independent review is optional.
- Keep hosted CI/CD and automatic deployments disabled unless explicitly authorized. Keep learner content, credentials, raw protocols, and private paths out of logs and Git.
- Do not stop user-owned processes. A running verification session does not block source edits; prior observations apply only to the source/build they inspected. Controlled sessions must preserve exact ownership and learner data; use the verification skills.
- Keep durable technical guidance in skills, legal notices in `docs/`, and curriculum product data in `content/curriculum/`. Do not add parallel manuals or progress files. The explicitly requested root `missing_features.md` is a temporary planning artifact, not standing implementation authority.

## Skill routing

- [Development](.agents/skills/call-nina-development/SKILL.md): repository workflow, package boundaries, data preservation, installation, service configuration, and build commands. Read for repository implementation work.
- [Desktop UI](.agents/skills/call-nina-desktop-ui/SKILL.md): renderer design, accessibility, and localization.
- [Codex integration](.agents/skills/call-nina-codex-integration/SKILL.md): direct ChatGPT/provider connections, Codex handoff, MCP, and plugin contracts.
- [Managed service](.agents/skills/call-nina-managed-service/SKILL.md): starter-service configuration, secrets, accounting, and deployment boundaries.
- [Electron verification](.agents/skills/call-nina-electron-verification/SKILL.md) / [Android verification](.agents/skills/call-nina-android-verification/SKILL.md): real app inspection and controlled interactions.
- [Curriculum research](plugins/call-nina/skills/curriculum-research/SKILL.md): reusable curriculum authoring. [Language teaching](plugins/call-nina/skills/german-teacher/SKILL.md): learner practice, not development.
