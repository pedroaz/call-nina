# Desktop boundaries

Follow root `AGENTS.md` and [the desktop UI skill](../../.agents/skills/call-nina-desktop-ui/SKILL.md).

- Keep main, preload, and renderer TypeScript projects separate. Renderer is browser-only; main owns filesystem, processes, SQLite, App Server, and plugins.
- Keep context isolation and sandboxing enabled and Node integration disabled. Never use Electron `remote`. Preload/IPC stays narrow, typed, and runtime-validated in both directions.
- Follow the root exploration/refactor deferral policy: intermediate changes need not build or run, and behavior verification may wait for a consolidated round after integration. When verifying, use [the interactive Electron skill](../../.agents/skills/call-nina-electron-verification/SKILL.md), real services, and GPT-6 Luna for AI calls. No automated tests or saved journeys.
- Session screenshots/UI snapshots are allowed; learner content, paths, credentials, and raw protocols never enter application logs or diagnostic errors. Restore settings and clean up only the session's newly created records through the UI.
