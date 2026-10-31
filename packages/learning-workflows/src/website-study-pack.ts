import type { UploadLearningItem } from "@call-nina/contracts";

// Index whitespace-normalized text without changing the captured source. Matches
// are restored to source slices so anything displayed as evidence is verbatim.
function sourceMatcher(source: string) {
  let searchable = "";
  const offsets: number[] = [];
  for (const run of source.matchAll(/\s+|\S+/gu)) {
    const value = /^\s/u.test(run[0]) ? " " : run[0];
    searchable += value;
    for (let index = 0; index < value.length; index++) offsets.push(run.index + index);
  }
  return (candidate: string | null, limit: number): string | null => {
    if (!candidate) return null;
    if (source.includes(candidate)) return candidate;
    const normalized = candidate.trim().replace(/\s+/gu, " ");
    if (!normalized) return null;
    const start = searchable.indexOf(normalized);
    if (start < 0) return null;
    const exact = source.slice(offsets[start], offsets[start + normalized.length - 1]! + 1);
    return exact.length <= limit ? exact : null;
  };
}

export function groundWebsiteStudyItems(
  items: readonly UploadLearningItem[],
  source: string,
): UploadLearningItem[] {
  const match = sourceMatcher(source);
  return items.map((item) => {
    let excerpt = item.origin === "page" ? match(item.excerpt, 500) : null;
    if (item.origin === "page") {
      const forms = [item.lemma];
      if (item.lexeme.partOfSpeech === "noun" && item.lexeme.plural.status === "form")
        forms.push(item.lexeme.plural.form);
      const pattern = forms
        .map((form) =>
          form
            .trim()
            .split(/\s+/u)
            .map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
            .join("\\s+"),
        )
        .join("|");
      const occurrence = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, "iu");
      if (!excerpt || !occurrence.test(excerpt)) {
        // A real but unrelated excerpt is not evidence for this word. Recover
        // an exact occurrence, or conservatively present it as a suggestion.
        const found = occurrence.exec(source);
        if (found) {
          const previousBreak = source.lastIndexOf("\n\n", found.index);
          const start = previousBreak < 0 ? 0 : previousBreak + 2;
          const nextBreak = source.indexOf("\n\n", found.index + found[0].length);
          const paragraph = source.slice(start, nextBreak < 0 ? source.length : nextBreak);
          excerpt = paragraph.length <= 500 ? paragraph : found[0];
        } else excerpt = null;
      }
    }
    return {
      ...item,
      // Unverified vocabulary may still be a useful topic suggestion, but it
      // must never retain a page attribution or fabricated evidence.
      origin: excerpt === null ? "suggestion" : "page",
      excerpt,
      examples: item.examples.map((example) => {
        if (example.origin === "generated") return example;
        const quotation = match(example.text, 1_000);
        return quotation === null
          ? { ...example, origin: "generated" }
          : { ...example, text: quotation };
      }),
    };
  });
}
