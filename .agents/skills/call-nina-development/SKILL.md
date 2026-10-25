---
name: call-nina-development
description: Develop and maintain Call Nina, including repository workflow, package boundaries, persistence, diagnostics, and packaging. Use for implementation work, not German tutoring.
---

# Call Nina development

Work directly with the user as one agent. Read root and scoped `AGENTS.md`, inspect branch, worktrees and tracked/untracked status, and preserve concurrent work and learner data. A chat request or optional ticket supplies scope; no task status or external execution record is required. Use the user's model selection and ordinary Git isolation when useful. Current code and runtime observations establish implemented behavior.

## Find the owner

Paths below are relative to the repository root. Follow imports and callers rather than assuming a file is the whole feature.

- Commands and supported toolchain ranges: `Makefile`, `package.json`, `.node-version`, `toolchain.json`; lifecycle and logs: `scripts/dev/lifecycle.mjs`, `scripts/dev/lib/lifecycle.mjs`, `scripts/dev/lib/log-view.mjs`.
- Incremental builds: application TypeScript output and build metadata live under each app’s `build/`; Vite owns runtime bundles under `dist/`. Shared packages emit to their own `dist/`. Keep these owners separate and reserve cache removal for `make clean`, rather than forcing recompilation on ordinary starts.
- Desktop wiring: `apps/desktop/src/main/backend.ts` and its internal `services/` owners, `apps/desktop/src/preload/`, `apps/desktop/src/renderer/App.tsx` and the affected renderer component.
- Shared design values: `packages/design-system/src/index.ts` exports browser and native representations; regenerate browser CSS with `pnpm run design-tokens`. Local font CSS, binaries, brand art and license files live in the same package. Keep the source dependency-free; desktop metrics stay in the renderer.
- Shared browser controls: `packages/browser-ui/src/`, consumed by desktop and website. Desktop activity presentation, composer state, navigation, content rows and table layouts live in the renderer. Keep this React/CSS layer separate from portable design tokens and native components; it must not import desktop services, routing or feature state.
- Shared contracts: `packages/contracts/src/`; portable generation context, prompts, validation and bounded repair: `packages/learning-workflows/src/`; deterministic learner rules and runtime validation: `packages/domain/src/`.
- Storage: `packages/persistence/src/repository.ts` is the public façade; `repository-{settings,vocabulary,activities,exercises,history}.ts` own internal operations and `repository-support.ts` owns shared schemas/helpers. Storage also includes `migrations.ts`, `sqlite.ts`, `data-root-layout.ts`, `data-root-selection.ts`, and the feature's persistence module.
- Course format and loading: `packages/contracts/src/learning-path.ts`, `packages/persistence/src/learning-path.ts`; curriculum inventory and validation: `content/curriculum/` and `packages/domain/src/curriculum.ts`.
- Per-user install/update/removal: `install/`; platform filesystem ownership: `packages/platform/src/`. Keep install ownership separate from learner-root ownership.
- Packaging: `apps/desktop/electron-builder.yml`, `scripts/build/build-mcp-helper.mjs`; integrations: use [the Codex integration skill](../call-nina-codex-integration/SKILL.md).

## Structural decisions

- Electron main owns filesystem, processes, SQLite and provider transports; renderer stays browser-only behind narrow validated preload/IPC. Desktop and independently launched STDIO MCP reuse shared contracts, domain and persistence.
- SQLite owns mutable private learner state. Reusable curriculum is repository product data packaged read-only. Keep learner files, credentials and research scratch material out of Git. The selected data root is portable; no automatic backups or folder-copy workflow. Repository installs update only through the explicit installer command; there is no background updater.
- AI connection metadata and one active model choice belong to the portable learner root, independently of language profiles. Device config owns platform-encrypted keys; portable metadata contains only opaque references. Learning cleanup and exports never include key material or reset connection choices. Root switches preserve both roots; connection removal never removes learner records or provider authentication.
- Runtime-validate AI, IPC, MCP and persisted inputs. Preserve data-root generations, leases, idempotency and transactional migrations. Use one current contract; follow the learning-format policy below.
- Local onboarding and supported prepared practice depend on the learner data root, not provider authentication. Keep local learner identity, provider accounts/credentials and device capabilities separate; a provider plan confers no Nina entitlement.
- Keep learning activities self-paced and distinguish participation from skill evidence. Voice stays in Codex; Call Nina stores bounded structured results, not audio or transcripts. Model capabilities come from the connected runtime.
- Preserve imported material text through renderer, generation and storage boundaries; whitespace validation must not rewrite the source. Attempts retain their exact content/material revisions, while later feedback appends evidence without replacing the original answer or evaluation. Reusable material lifetime is separate from activity lifetime: deletion may remove explicitly owned inline material only when no edited revision or surviving reference needs it. Never infer ownership for existing material or collect unrelated orphans.

## Work and verify

Use documented Make commands and inspect the owning implementation. Diagnose bugs from bounded redacted logs, using `make logs`; resolve exact process ownership before stopping anything. Keep learner content and credentials out of logs.

Make the requested changes and necessary fixes, review the diff, and report actual results. No automated application tests or saved journeys. Run `make check` only when static checks are requested or preparing/updating a PR. Independent review is optional. Commit, push, publish issues, create PRs and merge only when specifically requested. Use authenticated `gh` for GitHub work, Conventional Commit titles and genuine optional issue references. Issues/Projects are optional; preserve their relationships and history. Report unrelated findings in chat.

When the user explicitly owns verification, do not run app sessions or checks on their behalf; report implementation separately from unverified acceptance. Otherwise verify behavior through the [Electron skill](../call-nina-electron-verification/SKILL.md) or [Android skill](../call-nina-android-verification/SKILL.md). Use ordinary app startup and available native UI tools for inspection; the Electron skill also supports the repository’s owned Playwright controller when native UI tools are unavailable. AI verification uses the real direct ChatGPT connection with GPT-6 Luna at runtime-default effort, without model substitution; only the managed-service skill defines the explicitly scoped starter-pilot exception. Preserve settings and records during interactive checks; report any unfinished cleanup. Do not stop a user-owned app without authorization.

Exploration and major refactors may batch behavior verification until integration. Report known breakage and deferred checks; do not launch or restore incomplete functionality after each edit solely to verify it. Perform consolidated interactive verification before claiming affected behavior works. Keep hosted CI/CD and automatic deployments disabled unless explicitly authorized.

Use the [UI skill](../call-nina-desktop-ui/SKILL.md) for renderer changes. No change in workflow waives validated boundaries, data preservation or cleanup ownership.

Keep skills concise: change a skill when a durable decision or workflow changes. Put each decision in one owning skill and link to it rather than repeating it. Do not add reference manuals, implementation summaries, runbooks or progress files. Put runtime details in their owning code. Legal notices and authored curriculum remain product files in `docs/` and `content/curriculum/`.

## Data and process boundaries

Keep Electron context isolation and sandboxing enabled, Node integration disabled, and never use `remote`. Main validates privileged IPC senders, denies unexpected renderer permissions/navigation, and opens only validated external/handoff URLs. Contracts perform no I/O; domain stays deterministic and browser-compatible; persistence owns SQLite and migrations; platform owns OS primitives. Define contracts before extending adapters, and preserve the dependency direction enforced by ESLint.

Do not add compatibility paths solely for superseded behavior, inputs or formats. Only explicitly approved versioned learning-format changes may reset incompatible learning data before current readers run. Preserve valid profile/preferences, credentials and unrelated files; show a durable dismissible notice. Never reset on corruption or an unknown newer schema. Keep the SQLite migration ledger. Branding changes must not reset, silently relocate, or rename existing learner roots.

## Build, install and surfaces

Use supported Node/pnpm ranges from `package.json` and `toolchain.json`; `.node-version` and the recorded package-manager version are bootstrap recommendations. `make setup` installs development dependencies; `pnpm run setup:build` installs the source-build closure. `make help` lists everyday desktop commands; `pnpm run` lists explicit maintenance commands. Use `pnpm run build:workspace` only for all surfaces. `development.json` holds optional executable overrides, not task bookkeeping.

Desktop main, preload, renderer and the MCP helper build separately. Inspect `apps/desktop/electron-builder.yml` and `scripts/build/build-mcp-helper.mjs` before changing packaged resources; keep immutable curriculum and helper resources separate from learner storage. Use `pnpm run package:inspect` for footprint budgets. `make clean` owns generated output, not learner records, dependencies or installer state.

Installers in `install/` own per-user installation inventories, launchers and activity links. Updates use an explicit fast-forward source update and build before replacement; they refuse running apps and preserve unknown/modified files. Uninstall keeps learner data by default; destructive options require established ownership and the installer's confirmation. Never work around an operation lock by guessing process ownership. Development and installed configuration are separate; existing learner folders are selected explicitly and opened in place.

The website is a static React/Vite landing page using shared browser controls/tokens. `pnpm --filter @call-nina/website run dev`, `pnpm --filter @call-nina/website run build` and `pnpm --filter @call-nina/website run preview` own local iteration. Inspect supported locales, keyboard interaction and narrow layouts in a real browser. `scripts/build/package-website.mjs` owns explicit static packaging and deployment help; unknown URLs must remain 404 and bundled font notices must remain available. Packaging is local; deployment is separately requested.

Mobile is an Expo/native design foundation, not a learning player. Its `app.json` owns native configuration; do not edit generated ignored Android/iOS projects. `pnpm --filter @call-nina/mobile run config` resolves configuration and `pnpm --filter @call-nina/mobile run build` exports JavaScript/Hermes bundles, not verified native applications. Native launches need an actual target and the Android verification skill (iOS requires a Mac). Preserve native design exports independently from browser CSS.

## Service configuration

Prefer native declarative configuration or an idempotent supported API/CLI reconciliation beside the integration. Prepare a concrete remote diff before applying it and verify readback; keep secret values and linked infrastructure state out of Git. Skills document required secret names, provision sources and unavoidable dashboard actions. For Clerk, the maintainer creates instances first; reconcile only explicitly selected instances, separately from users/memberships. Mentioning a service never authorizes provisioning it.

Use the [managed-service skill](../call-nina-managed-service/SKILL.md) for starter-service changes. `.github/pipeline-policy.json` and `vercel.json` own disabled automation policy; preserve unrelated repository protections. No source cleanup authorizes changing remote settings.
