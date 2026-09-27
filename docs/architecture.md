# Call Nina architecture

Call Nina is a local-first Electron application. The renderer is treated as an unprivileged browser surface; Electron main owns operating-system access, SQLite, Codex processes, plugin staging, and packaged resources. The independently launched MCP server reuses the same contracts, domain rules, and persistence implementation.

## Dependency direction

```text
renderer -> preload -> validated IPC -> desktop main
                                      |-> domain
                                      |-> persistence -> platform
                                      `-> codex-client -> platform

MCP STDIO -> contracts + domain + persistence
```

The repository ESLint rules enforce these package and process boundaries. New imports should follow the existing direction rather than creating a circular or cross-process shortcut.

## Owners

- `packages/contracts` owns runtime-validated IPC, MCP, persisted-data, and AI-output schemas. It performs no I/O.
- `packages/domain` owns deterministic learning rules. It depends only on contracts and browser-compatible libraries.
- `packages/platform` owns low-level filesystem ownership, permissions, and process-independent OS primitives. It contains no learning rules.
- `packages/persistence` owns SQLite, migrations, selected-root generations, leases, idempotency, and repository adapters.
- `packages/codex-client` owns Codex runtime discovery, App Server transport, bounded workloads, output validation, and scoped plugin staging.
- `apps/desktop/src/main` composes the application and owns Electron APIs.
- `apps/desktop/src/preload` exposes the narrow typed desktop bridge.
- `apps/desktop/src/renderer` is browser-only and uses the bridge rather than Node.js or Electron APIs.
- `apps/mcp-server` owns STDIO transport and bounded MCP tool registration; stdout remains protocol-only.

## Trust boundaries

IPC, MCP, App Server responses, deep links, persisted records, curriculum files, and AI output are untrusted until validated by the owning contract. Main validates the sender frame of privileged IPC, denies renderer permissions and unexpected navigation, and opens only validated HTTPS or Call Nina Codex handoff URLs.

Learner state is mutable private data in the selected SQLite root. Curriculum and plugin files are immutable product resources in a packaged build. Operational logs are redacted and must never contain learner text, prompts, credentials, raw protocols, or private paths.

## Build and package layout

The renderer, preload, Electron main process, and MCP server are bundled separately. The packaged desktop application has no runtime npm dependency tree: `app.asar` contains only the three desktop bundles and its manifest. The MCP helper contains a launcher and one self-contained server bundle. Curriculum is packaged once in application resources and copied into an owned plugin runtime only when the scoped plugin is staged.

Use `make setup` for full development, `make setup-build` for the filtered source-build dependency profile, and `make package-inspect` to inspect the enforced local footprint budgets. Generated output is removed with `make clean`; learner data, logs, dependencies, and installer state are outside that target.

## Adding a feature

Define or extend the runtime contract first, implement deterministic rules in domain code, then add persistence or Codex adapters only where the feature requires them. Compose the operation in desktop main or the MCP server and expose the smallest renderer capability needed. Keep migrations append-only and preserve the migration ledger.
