import { createHash } from "node:crypto";
import { z } from "@call-nina/contracts";
import { limits } from "./protocol.js";

// No runtime model discovery or caller-supplied rates. This policy is approved
// deployment input; shipped environments contain no model or monetary defaults.
export const servicePolicySchema = z
  .strictObject({
    enabled: z.literal(true),
    environment: z.enum(["preview", "production"]),
    budgetId: z.uuid(),
    budgetMicroUsd: z.int().positive().max(1_000_000_000_000),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    model: z.strictObject({
      id: z
        .string()
        .regex(/^[a-z0-9-]+\/[a-zA-Z0-9._:-]+$/u)
        .max(200),
      provider: z
        .string()
        .regex(/^[a-z0-9-]+$/u)
        .max(80),
      // Must upper-bound ALL billed input, reasoning/output, Gateway overhead and
      // any minimum charge for one maximum-sized request. No usage-based refund.
      maximumAttemptMicroUsd: z.int().positive().max(500_000_000_000),
      costEvidenceUrl: z.url().startsWith("https://"),
      costReviewedAt: z.iso.datetime(),
      costValidUntil: z.iso.datetime(),
    }),
    requestsPerMinute: z.int().min(1).max(100),
    globalRequestsPerMinute: z.int().min(1).max(1000),
    maximumConcurrent: z.int().min(1).max(100),
  })
  .superRefine((policy, context) => {
    if (
      Date.parse(policy.endsAt) <= Date.parse(policy.startsAt) ||
      Date.parse(policy.model.costValidUntil) <= Date.parse(policy.model.costReviewedAt) ||
      policy.model.maximumAttemptMicroUsd * 2 > policy.budgetMicroUsd
    )
      context.addIssue({ code: "custom", message: "OD_MANAGED_POLICY_INVALID" });
  });
export type ServicePolicy = z.infer<typeof servicePolicySchema>;
export function policyDigest(policy: ServicePolicy): string {
  return createHash("sha256").update(JSON.stringify({ policy, limits })).digest("hex");
}
export function policyIsCurrent(policy: ServicePolicy): boolean {
  const now = Date.now();
  return (
    now >= Date.parse(policy.startsAt) &&
    now < Date.parse(policy.endsAt) &&
    now >= Date.parse(policy.model.costReviewedAt) &&
    now < Date.parse(policy.model.costValidUntil)
  );
}
