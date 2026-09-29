import type { AttemptEvidence, AttemptEvent, AttemptOwnership } from "@call-nina/contracts";

/** Evidence eligibility is separate from a correct answer or a completed activity. */
export function attemptEvidenceBasis(
  ownership: AttemptOwnership,
  events: AttemptEvent[],
): AttemptEvidence["basis"] {
  if (events.some((event) => event.detail.kind === "self-assessment")) return "self-assessment";
  if (!events.some((event) => event.detail.kind === "submitted-answer")) return "participation";
  if (events.some((event) => event.detail.kind === "assistance")) return "supported";
  if (
    ownership.originatingDeviceId === null ||
    (ownership.source.kind === "exercise" && ownership.source.content === null)
  )
    return "unknown";
  return events.some(
    (event) =>
      event.detail.kind === "local-evaluation" ||
      (event.detail.kind === "feedback" && event.detail.source === "ai"),
  )
    ? "independent"
    : "participation";
}
