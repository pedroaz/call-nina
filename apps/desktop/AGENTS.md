# Desktop boundaries

Read root `AGENTS.md` and the [development skill](../../.agents/skills/call-nina-development/SKILL.md). Keep main, preload, and renderer projects separate; renderer stays browser-only behind validated IPC.

Use the [desktop UI skill](../../.agents/skills/call-nina-desktop-ui/SKILL.md) for renderer work, [integration skill](../../.agents/skills/call-nina-codex-integration/SKILL.md) for provider/plugin changes, and [Electron verification](../../.agents/skills/call-nina-electron-verification/SKILL.md) for real app checks.

Shared browser controls belong in `packages/browser-ui/src/`; desktop composition and navigation belong in the renderer. Follow the UI skill for variants and visual roles rather than adding page-specific control styles.
