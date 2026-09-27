# MCP boundaries

Follow root `AGENTS.md` and [the Codex integration skill](../../.agents/skills/call-nina-codex-integration/SKILL.md).

- STDOUT is protocol-only; diagnostics go to redacted STDERR. Never print learner text, credentials, raw messages, or private paths.
- Keep transport local STDIO. Runtime-validate tool inputs and outputs using the shared catalog; synchronize names, descriptions, schemas, and safe error contracts with the plugin.
- Reuse domain/persistence services, selected-root generations, leases, and idempotency. Never expose arbitrary SQL, filesystem, process, network, or generic prompt tools.
- Do not add automated MCP tests, fake servers, fixtures, or saved journeys. Inspect relevant real behavior interactively within the requested scope.
