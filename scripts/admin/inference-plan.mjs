import { policyDigest } from "@call-nina/managed-generation/server";
import desired from "../../apps/api/desired.json" with { type: "json" };
import { activeDeploymentSchema } from "../../apps/api/build/deployment.js";

// Prints desired changes only; never opens a socket, reads credentials, applies
// SQL, links a Vercel project or enables Git deployments. Review alongside SQL.
export function inferencePlan() {
  const environments = Object.entries(desired).map(([environment, candidate]) => {
    const parsed = activeDeploymentSchema.safeParse(candidate);
    if (!parsed.success) {
      if (!(candidate.enabled === false && Object.keys(candidate).length === 1))
        throw new Error("OD_MANAGED_PLAN_INVALID");
      return {
        environment,
        enabled: false,
        action: "none",
        prerequisites:
          "Maintainer-approved deployment, policy, credentials and budget state are absent.",
      };
    }
    const { policy, ...deployment } = parsed.data;
    if (policy.environment !== environment) throw new Error("OD_MANAGED_PLAN_INVALID");
    return {
      environment,
      deployment,
      policy,
      policyDigest: policyDigest(policy),
      databasePlan: {
        migration: "packages/managed-generation/sql/001-budget.sql",
        sql: "INSERT INTO nina_starter.budget(id,environment,policy_digest,enabled,starts_at,ends_at,cost_valid_until,limit_micro_usd,reservation_micro_usd,requests_per_minute,global_requests_per_minute,maximum_concurrent) VALUES($1::uuid,$2,$3,false,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7::bigint,$8::bigint,$9,$10,$11)",
        parameters: [
          policy.budgetId,
          policy.environment,
          policyDigest(policy),
          policy.startsAt,
          policy.endsAt,
          policy.model.costValidUntil,
          policy.budgetMicroUsd,
          policy.model.maximumAttemptMicroUsd * 2,
          policy.requestsPerMinute,
          policy.globalRequestsPerMinute,
          policy.maximumConcurrent,
        ],
        activation:
          "Separate approved transaction after inspection; never reset or upsert an existing budget epoch.",
      },
    };
  });
  return environments;
}
