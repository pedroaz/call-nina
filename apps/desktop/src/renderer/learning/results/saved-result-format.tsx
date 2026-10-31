import type { Entry, HistoryPracticeSeed } from "./savedResultsTypes.js";

export function practiceSeed(entry: Entry): HistoryPracticeSeed {
  if (entry.detail.kind !== "writing-correction") throw new Error("OD_HISTORY_DETAIL_INVALID");
  return {
    kind: "writing",
    historyEntryId: entry.historyEntryId,
    draft: entry.detail.learnerText,
    context: entry.title,
  };
}
export function exerciseAnswerText(detail: Extract<Entry["detail"], { kind: "exercise-attempt" }>) {
  const answer = detail.answer;
  if (answer.kind === "multiple-choice") {
    return null;
  }
  if (answer.kind === "fill-in-the-blank") return answer.valuesByBlankPosition.join(" · ");
  return answer.text;
}
