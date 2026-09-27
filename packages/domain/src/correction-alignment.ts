export type CorrectionChangeCandidate = {
  readonly kind: "replacement" | "insertion" | "deletion";
  readonly originalText: string;
  readonly correctedText: string;
};

export type PresentedCorrectionSegment =
  | { readonly kind: "unchanged"; readonly text: string }
  | {
      readonly kind: "replacement" | "insertion" | "deletion";
      readonly changeId: string;
      readonly originalText: string;
      readonly correctedText: string;
      readonly candidateIndex: number | null;
    };

type DiffAtom = {
  kind: "unchanged" | "insertion" | "deletion";
  text: string;
};

const maximumLcsCells = 250_000;
const tokenPattern = /\s+|[\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}\s]/gu;

function tokenize(text: string): string[] {
  return text.match(tokenPattern) ?? [];
}

function appendAtom(atoms: DiffAtom[], kind: DiffAtom["kind"], text: string): void {
  if (!text) return;
  const previous = atoms.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else atoms.push({ kind, text });
}

function appendBacktrackedAtom(atoms: DiffAtom[], kind: DiffAtom["kind"], text: string): void {
  if (!text) return;
  const previous = atoms.at(-1);
  if (previous?.kind === kind) previous.text = text + previous.text;
  else atoms.push({ kind, text });
}

function boundedTokenDiff(originalText: string, correctedText: string): DiffAtom[] | undefined {
  const original = tokenize(originalText);
  const corrected = tokenize(correctedText);
  const width = corrected.length + 1;
  if ((original.length + 1) * width > maximumLcsCells) return undefined;

  const lengths = new Uint32Array((original.length + 1) * width);
  for (let originalIndex = 1; originalIndex <= original.length; originalIndex += 1) {
    for (let correctedIndex = 1; correctedIndex <= corrected.length; correctedIndex += 1) {
      const offset = originalIndex * width + correctedIndex;
      lengths[offset] =
        original[originalIndex - 1] === corrected[correctedIndex - 1]
          ? (lengths[(originalIndex - 1) * width + correctedIndex - 1] ?? 0) + 1
          : Math.max(
              lengths[(originalIndex - 1) * width + correctedIndex] ?? 0,
              lengths[originalIndex * width + correctedIndex - 1] ?? 0,
            );
    }
  }

  const reversed: DiffAtom[] = [];
  let originalIndex = original.length;
  let correctedIndex = corrected.length;
  while (originalIndex > 0 || correctedIndex > 0) {
    if (
      originalIndex > 0 &&
      correctedIndex > 0 &&
      original[originalIndex - 1] === corrected[correctedIndex - 1]
    ) {
      appendBacktrackedAtom(reversed, "unchanged", original[originalIndex - 1] ?? "");
      originalIndex -= 1;
      correctedIndex -= 1;
    } else if (
      correctedIndex > 0 &&
      (originalIndex === 0 ||
        (lengths[originalIndex * width + correctedIndex - 1] ?? 0) >
          (lengths[(originalIndex - 1) * width + correctedIndex] ?? 0))
    ) {
      appendBacktrackedAtom(reversed, "insertion", corrected[correctedIndex - 1] ?? "");
      correctedIndex -= 1;
    } else {
      appendBacktrackedAtom(reversed, "deletion", original[originalIndex - 1] ?? "");
      originalIndex -= 1;
    }
  }

  return reversed.reverse();
}

function prefixSuffixDiff(originalText: string, correctedText: string): DiffAtom[] {
  const original = Array.from(originalText);
  const corrected = Array.from(correctedText);
  let prefix = 0;
  while (prefix < original.length && original[prefix] === corrected[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < corrected.length - prefix &&
    original[original.length - suffix - 1] === corrected[corrected.length - suffix - 1]
  )
    suffix += 1;

  const atoms: DiffAtom[] = [];
  appendAtom(atoms, "unchanged", original.slice(0, prefix).join(""));
  appendAtom(atoms, "deletion", original.slice(prefix, original.length - suffix).join(""));
  appendAtom(atoms, "insertion", corrected.slice(prefix, corrected.length - suffix).join(""));
  appendAtom(atoms, "unchanged", original.slice(original.length - suffix).join(""));
  return atoms;
}

function candidateScore(
  segment: {
    kind: "replacement" | "insertion" | "deletion";
    originalText: string;
    correctedText: string;
  },
  candidate: CorrectionChangeCandidate,
): number {
  let score = segment.kind === candidate.kind ? 1 : 0;
  if (segment.originalText === candidate.originalText) score += 8;
  else if (
    segment.originalText &&
    candidate.originalText &&
    (segment.originalText.includes(candidate.originalText) ||
      candidate.originalText.includes(segment.originalText))
  )
    score += 3;
  if (segment.correctedText === candidate.correctedText) score += 8;
  else if (
    segment.correctedText &&
    candidate.correctedText &&
    (segment.correctedText.includes(candidate.correctedText) ||
      candidate.correctedText.includes(segment.correctedText))
  )
    score += 3;
  return score;
}

export function alignCorrectionTexts(
  originalText: string,
  correctedText: string,
  candidates: readonly CorrectionChangeCandidate[] = [],
): PresentedCorrectionSegment[] {
  if (originalText === correctedText) {
    return originalText ? [{ kind: "unchanged", text: originalText }] : [];
  }
  const atoms =
    boundedTokenDiff(originalText, correctedText) ?? prefixSuffixDiff(originalText, correctedText);
  const segments: PresentedCorrectionSegment[] = [];
  let changeNumber = 0;
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (!atom) continue;
    if (atom.kind === "unchanged") {
      segments.push({ kind: "unchanged", text: atom.text });
      continue;
    }
    const next = atoms[index + 1];
    const paired = next && next.kind !== "unchanged" && next.kind !== atom.kind ? next : undefined;
    if (paired) index += 1;
    const original =
      atom.kind === "deletion" ? atom.text : paired?.kind === "deletion" ? paired.text : "";
    const corrected =
      atom.kind === "insertion" ? atom.text : paired?.kind === "insertion" ? paired.text : "";
    const kind = original && corrected ? "replacement" : original ? "deletion" : "insertion";
    const shape = { kind, originalText: original, correctedText: corrected } as const;
    changeNumber += 1;
    segments.push({
      ...shape,
      changeId: `change-${String(changeNumber)}`,
      candidateIndex: null,
    });
  }
  const assignments = new Map<number, number>();
  const claimedSegments = new Set<number>();
  candidates.forEach((candidate, candidateIndex) => {
    let bestSegment = -1;
    let bestScore = 1;
    segments.forEach((segment, segmentIndex) => {
      if (segment.kind === "unchanged" || claimedSegments.has(segmentIndex)) return;
      const score = candidateScore(segment, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestSegment = segmentIndex;
      }
    });
    if (bestSegment >= 0) {
      claimedSegments.add(bestSegment);
      assignments.set(bestSegment, candidateIndex);
    }
  });
  return segments.map((segment, segmentIndex) =>
    segment.kind === "unchanged"
      ? segment
      : { ...segment, candidateIndex: assignments.get(segmentIndex) ?? null },
  );
}

export function originalTextFromPresentedAlignment(
  alignment: readonly PresentedCorrectionSegment[],
): string {
  return alignment
    .map((segment) => (segment.kind === "unchanged" ? segment.text : segment.originalText))
    .join("");
}

export function correctedTextFromPresentedAlignment(
  alignment: readonly PresentedCorrectionSegment[],
): string {
  return alignment
    .map((segment) => (segment.kind === "unchanged" ? segment.text : segment.correctedText))
    .join("");
}
