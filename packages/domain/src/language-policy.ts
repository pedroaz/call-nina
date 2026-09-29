import { normalizeGermanAnswer, targetLanguageSchema } from "@call-nina/contracts";

function normalized(value: string): string {
  return normalizeGermanAnswer(value);
}

function normalizedSentence(value: string): string {
  return normalized(value)
    .replace(/[.!?]+$/u, "")
    .trimEnd();
}

function isAccepted(value: string, accepted: readonly string[]): boolean {
  const candidate = normalized(value);
  return accepted.some((answer) => normalized(answer) === candidate);
}

function isAcceptedSentence(value: string, accepted: readonly string[]): boolean {
  const candidate = normalizedSentence(value);
  return accepted.some((answer) => normalizedSentence(answer) === candidate);
}

function words(value: string): readonly string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function withoutDiacritics(value: string): string {
  return value.normalize("NFD").replaceAll(/\p{M}/gu, "");
}

function attemptsExpectedCorrection(
  candidate: string,
  original: string,
  expected: string,
): boolean {
  const candidateWords = words(candidate);
  const originalWords = words(original);
  const expectedWords = words(expected);
  if (
    candidateWords.length !== originalWords.length ||
    candidateWords.length !== expectedWords.length
  ) {
    return true;
  }
  const changedPositions = expectedWords.flatMap((word, position) =>
    word === originalWords[position] ? [] : [position],
  );
  return changedPositions.every(
    (position) =>
      withoutDiacritics(candidateWords[position] ?? "") ===
      withoutDiacritics(expectedWords[position] ?? ""),
  );
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, position) => position);
  for (let leftPosition = 1; leftPosition <= left.length; leftPosition += 1) {
    const current = [leftPosition];
    for (let rightPosition = 1; rightPosition <= right.length; rightPosition += 1) {
      current[rightPosition] = Math.min(
        (current[rightPosition - 1] ?? 0) + 1,
        (previous[rightPosition] ?? 0) + 1,
        (previous[rightPosition - 1] ?? 0) +
          (left[leftPosition - 1] === right[rightPosition - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function isAlmostAcceptedSentence(
  value: string,
  source: string,
  accepted: readonly string[],
): boolean {
  const candidate = normalizedSentence(value);
  const original = normalizedSentence(source);
  if (candidate === original) return false;
  return accepted.some((answer) => {
    const expected = normalizedSentence(answer);
    const maximumMinorEdits = Math.min(3, Math.max(1, Math.ceil(expected.length / 30)));
    if (Math.abs(candidate.length - expected.length) > maximumMinorEdits) return false;
    if (!attemptsExpectedCorrection(candidate, original, expected)) return false;
    const distanceFromExpected = editDistance(candidate, expected);
    const minimumDistanceFromOriginal = Math.abs(candidate.length - original.length);
    const distanceFromOriginal =
      minimumDistanceFromOriginal > distanceFromExpected
        ? minimumDistanceFromOriginal
        : editDistance(candidate, original);
    return distanceFromExpected <= maximumMinorEdits && distanceFromExpected < distanceFromOriginal;
  });
}

type PracticeRequestKind =
  "mistake" | "writing" | "reading" | "speaking" | "grammar" | "listening" | "lesson";

function germanPracticeRequest(
  kind: PracticeRequestKind,
  language: "en" | "de",
  topic: string,
  level: string,
): string {
  const de = language === "de";
  const requests = {
    mistake: de
      ? `Gib mir sechs kurze Übungen zu „${topic}“ auf Niveau ${level.toUpperCase()}.`
      : `Give me six short German exercises on “${topic}” at ${level.toUpperCase()} level.`,
    writing: de
      ? `Schreibe auf Deutsch 4–6 Sätze zum Thema „${topic}“. Bitte um eine Information und schlage einen nächsten Schritt vor.`
      : `Write 4–6 German sentences about ${topic}. Ask for information and suggest a next step.`,
    reading: de
      ? `Erstelle einen kurzen deutschen Text über „${topic}“ mit sechs Verständnisfragen.`
      : `Create a short German text about ${topic} with six comprehension questions.`,
    speaking: de
      ? "Übe ein Gespräch: Vereinbare einen Termin, frage nach der Uhrzeit und bitte bei Bedarf um Wiederholung."
      : "Practise a German conversation: arrange an appointment, check the time, and ask for repetition when needed.",
    grammar: de
      ? `Übe die deutsche Satzstellung mit sechs kurzen Aufgaben zum Thema „${topic}“.`
      : `Practise German word order with six short tasks about ${topic}.`,
    listening: de
      ? `Übe Hörverstehen mit einem kurzen deutschen Gespräch zum Thema „${topic}“.`
      : `Practise listening with a short German conversation about ${topic}.`,
    lesson: de
      ? `Hilf mir, deutsche Wörter zum Thema „${topic}“ in sechs kurzen Übungen anzuwenden.`
      : `Help me use German vocabulary about ${topic} in six short exercises.`,
  };
  return requests[kind];
}

const germanPolicy = Object.freeze({
  targetLanguage: "de" as const,
  normalize: normalized,
  practiceRequest: germanPracticeRequest,
  isAccepted,
  isAcceptedSentence,
  isAlmostAcceptedSentence,
});

/** Only German is implemented; never fall back for an unsupported language. */
export function supportedLanguagePolicy(language: unknown) {
  targetLanguageSchema.parse(language);
  return germanPolicy;
}
