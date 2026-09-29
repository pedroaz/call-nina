---
name: call-nina-development
description: Develop and maintain Call Nina, including repository workflow, package boundaries, persistence, diagnostics, and packaging. Use for implementation work, not German tutoring.
---

# Call Nina development

Read root and scoped `AGENTS.md`, inspect branch, worktree and `git status --short`, and preserve concurrent work and learner data. Every Codex CLI/Desktop session must inspect read-only, map to an existing approved task or propose missing scope, and create/select its owned isolated task worktree before the first repository edit, including small docs/skills and ad-hoc fixes. Work from that worktree’s repository root; main may host coordination but is not an implementation scratch checkout. Dirty-main transfer is recovery only. Current code, schemas, and runtime observations establish what is implemented; inspect them before changing behavior. Skills hold durable decisions and workflow, not feature inventories or parallel implementation documentation.

## Find the owner

Paths below are relative to the repository root. Follow imports and callers rather than assuming a file is the whole feature.

- Commands and supported toolchain ranges: `Makefile`, `package.json`, `.node-version`, `toolchain.json`; lifecycle and logs: `scripts/dev/lifecycle.mjs`, `scripts/dev/lib/lifecycle.mjs`, `scripts/dev/lib/log-view.mjs`.
- Incremental builds: application TypeScript output and build metadata live under each app’s `build/`; Vite owns runtime bundles under `dist/`. Shared packages emit to their own `dist/`. Keep these owners separate and reserve cache removal for `make clean`, rather than forcing recompilation on ordinary starts.
- Desktop wiring: `apps/desktop/src/main/backend.ts`, `apps/desktop/src/preload/`, `apps/desktop/src/renderer/App.tsx` and the affected renderer component.
- Shared design primitives: `packages/design-system/src/index.ts`; regenerate its explicit browser CSS resource with `make design-tokens`. Keep the root dependency-free and platform-neutral; browser CSS is a separate export, and desktop-specific styles stay in the renderer.
- Shared contracts: `packages/contracts/src/`; portable generation context, prompts, validation and bounded repair: `packages/learning-workflows/src/`; deterministic learner rules and runtime validation: `packages/domain/src/`.
- Storage: `packages/persistence/src/repository.ts`, `migrations.ts`, `sqlite.ts`, `data-root-layout.ts`, `data-root-selection.ts`, and the feature's persistence module.
- Course format and loading: `packages/contracts/src/learning-path.ts`, `packages/persistence/src/learning-path.ts`; curriculum inventory and validation: `content/curriculum/` and `packages/domain/src/curriculum.ts`.
- Per-user install/update/removal: `install/`; platform filesystem ownership: `packages/platform/src/`. Keep install ownership separate from learner-root ownership.
- Packaging: `apps/desktop/electron-builder.yml`, `scripts/build/build-mcp-helper.mjs`; integrations: use [the Codex integration skill](../call-nina-codex-integration/SKILL.md).

## Structural decisions

- Electron main owns filesystem, processes, SQLite and App Server; renderer stays browser-only behind narrow validated preload/IPC. Desktop and independently launched STDIO MCP reuse shared contracts, domain and persistence.
- SQLite owns mutable private learner state. Reusable curriculum is repository product data packaged read-only. Keep learner files, credentials and research scratch material out of Git. The selected data root is portable; no automatic backups or folder-copy workflow. Repository installs update only through the explicit installer command; there is no background updater.
- Runtime-validate AI, IPC, MCP and persisted inputs. Preserve data-root generations, leases, idempotency and transactional migrations. Use one current contract; follow the root development-reset policy for incompatible learning formats.
- Keep learning activities self-paced and distinguish participation from skill evidence. Voice stays in Codex; Call Nina stores bounded structured results, not audio or transcripts. Model capabilities come from the connected runtime.

## Task history

Use `task/<issue>-<short-kebab-description>` and an ownership suffix for separate worker branches. Commit with a Conventional Commit header and a real `Refs: #<task>` footer; do not lint or rewrite old history. The pure contract owner is `scripts/agents/lib/task-metadata.mjs`; GitHub publication and merge boundaries are in `scripts/agents/github.mjs`. Preserve both `!` and complete multiline `BREAKING CHANGE:` / `BREAKING-CHANGE:` signals. Copy every distinct source breaking footer into the PR body; a source `!` needs either a PR-title `!` or an explicitly authored breaking footer. Do not invent migration explanations.

## Work and verify

Do not create, enable or expand CI/CD workflows, hosted checks, deployment pipelines or release automation without explicit user authorization. All code reviews are local only; preserve independent exact-head local review and passing local `make check` under the repository policy.

Use `make help` and inspect its target implementation for command details. Inspect relevant redacted logs before bug fixes (`make logs-once`); resolve lifecycle ownership before stopping a process. Add only bounded diagnostics when evidence is missing.

For ordinary changes, verify affected behavior through [interactive Electron verification](../call-nina-electron-verification/SKILL.md). During exploration and major refactors, follow the root deferral policy: the app need not build or work at each intermediate step, and behavior checks may be batched across tasks without asking again. Use only the focused prototype checks that help answer the current exploration question; label unproven assumptions accordingly. Do not spend time restoring an intentionally incomplete app merely to run verification. Report known breakage and deferred checks in the task response and, for roadmap work, the existing roadmap; do not create a separate checklist. Complete a consolidated interactive round after integration before claiming the affected work is functional or release-ready.

Use [the UI skill](../call-nina-desktop-ui/SKILL.md) for renderer work. Deferral does not waive data preservation or security boundaries. No automated application tests or saved journeys. Run `make check` only on request or when preparing a PR. Review the exact change and report actual observations and limitations. Approved Ready work authorizes scoped worker commits and coordinator pushes/PRs/merges. Worker completion is not delivery: the coordinator continues authorized runnable work through required gates, verified merge and task closure, then Project/epic reconciliation and safe cleanup without a user resume. Block only dependent work when a gate is unavailable; track nonblocking upstream bugs separately. Follow [the orchestration skill](../call-nina-orchestration/SKILL.md) for reconciliation before new work and final response/detach, receipt/liveness investigation and durable budget handoffs. Releases require explicit authorization.

Keep skills concise: change a skill when a durable decision or workflow changes. Do not add reference manuals, implementation summaries, runbooks or progress files. Put runtime details in their owning code. Legal notices and authored curriculum remain product files in `docs/` and `content/curriculum/`.
