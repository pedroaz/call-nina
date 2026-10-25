---
name: call-nina-managed-service
description: Maintain Call Nina's managed starter API, deployment configuration, Gateway funding, PostgreSQL budget ledger, and bounded real-service verification. Use for service work, not ordinary personal AI connections or automatic deployment.
---

# Call Nina managed service

Read the development skill for general repository and service-configuration policy. Inspect `apps/managed-service/{deployment.ts,desired.json,plan.ts,api/generate.ts}`, `packages/managed-generation/src/` and `packages/managed-generation/sql/001-budget.sql`. Desktop dispatch lives in `apps/desktop/src/main/backend.ts`. Current source and remote readback establish availability, not a plan or static catalog.

## Configuration and secrets

This is a separate service from the static website. `desired.json` currently disables preview and production; desktop defaults have no enabled endpoint/model. `make managed-service-plan` compiles source and prints desired changes and parameterized budget-row SQL; it does not provision, read secrets, apply SQL, deploy or call inference. Keep the starter unavailable until a selected deployment and model are verified; never fall back to personal keys or another route.

Keep desired configuration beside the integration. Pin the selected project/team, exact HTTPS origin, direct Vercel ingress, isolated Gateway funding, one model/provider, expiring authoritative cost evidence and numerical limits using the current schemas. Preview and production require separate database roles, budget epochs and Gateway funding/credentials. Local environments are unavailable. Review a concrete diff and read back remote settings under the user's deployment authorization; do not introduce approval tickets or infer permission from repository presence.

Required server-only secrets come from the maintainer through the selected environment's secret store:

| Name                             | Provision source                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `NINA_STARTER_GATEWAY_API_KEY`   | Dedicated service-owned Gateway scope, never a learner key or ambient developer credential                                  |
| `NINA_STARTER_DATABASE_URL`      | Selected PostgreSQL primary's restricted service role with explicit credentials and verified TLS; no query-string overrides |
| `NINA_STARTER_THROTTLE_HMAC_KEY` | Maintainer-generated random 32-byte secret, encoded as 64 lowercase hex characters and stable across instances              |

`NINA_STARTER_ENABLED=true` is the additional server switch. Expose Vercel's [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables) through the selected project's settings where necessary; `VERCEL`, `VERCEL_ENV` and `VERCEL_PROJECT_ID` must match configuration. Set non-secret `NINA_STARTER_TEAM_ID` explicitly; Vercel does not supply it. Record unavoidable dashboard settings in this skill, not a parallel runbook. Never commit secret values, linked-project state or database dumps. Disable body/query logging, SDK telemetry and raw provider exception logging throughout the service stack.

Use isolated Gateway system credits with no cached BYOK keys, fallback models or automatic funding top-ups. A scoped API key does not establish isolated billing; inspect actual remote routing, funding and logging. The source disables SDK retries and pins the provider, but cannot repair an incorrectly configured Gateway account. Consult [Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok) before changing assumptions.

## Admission and accounting

The structured endpoint accepts bounded Nina learning operations, not arbitrary prompts or credentials. Shared learning workflows own generation, validation and at most one repair. Read `protocol.ts` for enforced request/output/deadline limits. Cost evidence must bound every billed input, output/reasoning, overhead, minimum charge and upstream internal attempt at those limits; output-token pricing alone is insufficient. The ledger reserves twice `maximumAttemptMicroUsd`. Hosting, database and request-flood costs require separate controls; the inference ledger is not a total infrastructure spending cap.

Use a dedicated migration owner and a restricted runtime role with schema USAGE and EXECUTE on `reserve`, `permit`, `settle`, never table writes or owner privileges. Review the generated SQL against the selected primary and insert a disabled budget row before activation/readback. The code does not create or activate budgets. PostgreSQL connections require verified TLS, parameter binding, bounded connections/timeouts and suppressed notices.

Preserve these accounting invariants:

- `reserve` commits the worst-case two-attempt charge under the shared row lock before inference and enforces spend, concurrency, global admission and network limits across instances.
- `settle` refunds only undispatched attempts. Cancellation, refusal, timeout and unknown usage retain attempted charges; process loss or settlement failure retains the reservation. Lease expiry releases concurrency, never money.
- Repeated reservation IDs are refused; results are not replayed or persisted. Explicit client retries are new paid admissions, not automatic transport retries.
- Keep reservation IDs for their budget epoch. Disable the old epoch and drain admitted work before replacement. Do not reset a live ledger; overlapping epochs have independently funded caps. Epoch retirement requires an explicit accounting decision.
- Disable the durable budget row to stop new admissions and repairs across instances. An environment switch alone waits for old instances to drain; already admitted work may still bill.

The database stores budget/control state, random identifiers, charges, timestamps and rotating keyed throttle hashes, never profiles, prompts, output, raw IPs or personal credentials.

## Ingress, desktop and verification

Only the Vercel entrypoint extracts `x-vercel-forwarded-for`, after matching server-owned environment/project/team/origin. Require direct Vercel ingress without a custom trusted proxy or alternate origin bypass, and verify spoofed-header rejection against the actual deployment. Consult [Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for); do not transplant this assumption into a generic Node server.

IP throttling is abuse friction, not identity or per-person quotas. NATs share limits and rotating addresses can evade them. CORS, an install ID or a desktop-shipped secret does not authenticate anonymous native clients. Keep global durable limits and infrastructure flood controls, with honest unavailability when limits are reached.

Desktop `ManagedGenerationService` captures connection/root, preserves submissions, validates output locally, supports explicit retry/cancellation and never reads personal keys. A configured catalog is not a live probe. Verify deadlines, actual platform disconnect propagation, shutdown, exhaustion, concurrent admission, restarts, secret isolation and model quality through bounded real interactions; no automated application suites, fake services or learner database manipulation.

The user approved a narrow exception for the anonymous starter pilot: real calls may use its explicitly selected managed model/provider instead of direct ChatGPT GPT-6 Luna, only after model costs, deployment and a bounded verification allocation within the approved total budget are settled. This permits no other provider/model substitution. Use the Electron skill's ownership, settings restoration and session-record cleanup for desktop interactions. Inspect the controller before use: its current `prepare-ai` forces direct ChatGPT, so adapt the owned verification path explicitly before claiming managed-route verification. Never misreport the route used. Service-only checks must not mutate personal learner storage. Keep public activation and scheduled renewal out of documentation-only work.
