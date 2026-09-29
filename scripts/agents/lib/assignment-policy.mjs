// Assignment risk selects the model; role defaults are only starting guidance.
// Keep this policy independent of Orca state so selection can be inspected safely.
export const assignmentPolicy = {
  bounded: {
    model: "gpt-6-luna",
    efforts: ["low", "medium"],
    roles: ["explorer", "runtime-engineer"],
  },
  routine: {
    model: "gpt-6-sol",
    efforts: ["medium"],
    roles: ["runtime-engineer", "ui-engineer", "reviewer", "verifier"],
  },
  consequential: {
    model: "gpt-6-astra",
    efforts: ["high"],
    roles: ["explorer", "runtime-engineer", "ui-engineer", "reviewer", "verifier"],
  },
  decision: {
    model: "gpt-6-astra",
    efforts: ["high", "xhigh"],
    roles: ["architect"],
  },
};

export function assignmentSettings(spec) {
  const execution = spec?.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution))
    throw new Error("ASSIGNMENT_EXECUTION_REQUIRED");
  if (
    Object.keys(execution).some(
      (key) => !["risk", "model", "effort", "rationale", "escalation"].includes(key),
    )
  )
    throw new Error("ASSIGNMENT_EXECUTION_FIELD_INVALID");
  const policy =
    typeof execution.risk === "string" && Object.hasOwn(assignmentPolicy, execution.risk)
      ? assignmentPolicy[execution.risk]
      : null;
  if (!policy || !policy.roles.includes(spec.role)) throw new Error("ASSIGNMENT_ROLE_RISK_INVALID");
  if (execution.model !== policy.model || !policy.efforts.includes(execution.effort))
    throw new Error("ASSIGNMENT_MODEL_EFFORT_INVALID");
  if (typeof execution.rationale !== "string" || !execution.rationale.trim())
    throw new Error("ASSIGNMENT_RATIONALE_REQUIRED");
  if (
    execution.escalation !== undefined &&
    (typeof execution.escalation !== "string" ||
      !execution.escalation.trim() ||
      !["consequential", "decision"].includes(execution.risk))
  )
    throw new Error("ASSIGNMENT_ESCALATION_INVALID");
  return { model: execution.model, model_reasoning_effort: execution.effort };
}

export function assertEffectiveSettings(result, config) {
  if (
    result?.launch?.effective?.model !== config.model ||
    result?.launch?.effective?.effort !== config.model_reasoning_effort
  )
    throw new Error("LAUNCH_PREFERENCES_UNCONFIRMED: reconcile saved receipt");
}
