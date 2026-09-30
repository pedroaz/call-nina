import { z } from "@call-nina/contracts";
import { ManagedFailure } from "./protocol.js";
import { policyDigest, type ServicePolicy } from "./policy.js";

/** The deployment supplies a maintained PostgreSQL driver using a dedicated
 * restricted role, TLS, parameter binding and bounded connection/query timeouts.
 * Queries must commit before resolving; replicas/caches are forbidden here. */
export interface BudgetSql {
  query(text: string, values: readonly (string | number)[]): Promise<{ rows: unknown[] }>;
}
const admissionSchema = z.strictObject({
  outcome: z.enum(["reserved", "unavailable", "shutdown", "exhausted", "throttled", "conflict"]),
});
export class PostgresBudget {
  constructor(
    private readonly sql: BudgetSql,
    private readonly policy: ServicePolicy,
  ) {}
  async reserve(requestId: string, networkHash: string): Promise<void> {
    const result = await this.sql.query(
      "select nina_starter.reserve($1::uuid,$2::uuid,$3,$4,$5::bigint) as outcome",
      [
        this.policy.budgetId,
        requestId,
        networkHash,
        policyDigest(this.policy),
        this.policy.model.maximumAttemptMicroUsd * 2,
      ],
    );
    const parsed = admissionSchema.parse(result.rows[0]);
    if (parsed.outcome !== "reserved") throw new ManagedFailure(parsed.outcome);
  }
  async assertEnabled(requestId: string): Promise<void> {
    const result = await this.sql.query(
      "select nina_starter.permit($1::uuid,$2::uuid,$3) as permitted",
      [this.policy.budgetId, requestId, policyDigest(this.policy)],
    );
    if (!z.strictObject({ permitted: z.boolean() }).parse(result.rows[0]).permitted)
      throw new ManagedFailure("shutdown");
  }
  async settle(requestId: string, attempted: number): Promise<void> {
    // An attempted upstream dispatch is conservatively charged in full even if
    // cancelled, timed out, rejected, or returned without reliable usage.
    const result = await this.sql.query(
      "select nina_starter.settle($1::uuid,$2::uuid,$3::bigint) as settled",
      [this.policy.budgetId, requestId, attempted * this.policy.model.maximumAttemptMicroUsd],
    );
    if (!z.strictObject({ settled: z.boolean() }).parse(result.rows[0]).settled)
      throw new ManagedFailure("unavailable");
  }
}
