import { strictBoundaryObject, z } from "@call-nina/contracts";

import { exerciseAnswerSchema, type ExerciseAnswer } from "./attempt.js";
import {
  exerciseDefinitionSchema,
  exerciseKindSchema,
  type ExerciseDefinition,
} from "./exercise.js";

export const exerciseEvaluationSchema = strictBoundaryObject({
  exerciseKind: exerciseKindSchema,
  answer: exerciseAnswerSchema,
  status: z.enum(["correct", "almost-correct", "incorrect", "requires-ai"]),
  acceptedAnswerReveal: z.array(z.string().min(1).max(500)).max(20),
});

export type ExerciseEvaluation = z.infer<typeof exerciseEvaluationSchema>;

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("de-DE");
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

export function evaluateExerciseAnswer(
  definitionValue: ExerciseDefinition,
  answerValue: ExerciseAnswer,
): ExerciseEvaluation {
  const definition = exerciseDefinitionSchema.parse(definitionValue);
  const answer = exerciseAnswerSchema.parse(answerValue);
  if (definition.kind !== answer.kind) throw new Error("OD_EXERCISE_ANSWER_KIND_INVALID");

  if (definition.kind === "free-writing" && answer.kind === "free-writing") {
    if (answer.text.length > definition.answerContract.maximumCharacters) {
      throw new Error("OD_EXERCISE_ANSWER_TOO_LONG");
    }
    return exerciseEvaluationSchema.parse({
      exerciseKind: definition.kind,
      answer,
      status: "requires-ai",
      acceptedAnswerReveal: [],
    });
  }
  if (definition.kind === "short-answer" && answer.kind === "short-answer") {
    return exerciseEvaluationSchema.parse({
      exerciseKind: definition.kind,
      answer,
      status: isAccepted(answer.text, definition.answerContract.acceptedAnswers)
        ? "correct"
        : "requires-ai",
      acceptedAnswerReveal: definition.answerContract.acceptedAnswers,
    });
  }
  if (definition.kind === "fill-in-the-blank" && answer.kind === "fill-in-the-blank") {
    if (answer.valuesByBlankPosition.length !== definition.content.blanks.length) {
      throw new Error("OD_EXERCISE_BLANK_COUNT_INVALID");
    }
    const correct = definition.content.blanks.every((blank, position) =>
      isAccepted(answer.valuesByBlankPosition[position] ?? "", blank.acceptedAnswers),
    );
    return exerciseEvaluationSchema.parse({
      exerciseKind: definition.kind,
      answer,
      status: correct ? "correct" : "incorrect",
      acceptedAnswerReveal: definition.content.blanks.flatMap(({ acceptedAnswers }) =>
        acceptedAnswers.slice(0, 1),
      ),
    });
  }
  if (definition.kind === "sentence-correction" && answer.kind === "sentence-correction") {
    const status = isAcceptedSentence(answer.text, definition.answerContract.acceptedAnswers)
      ? "correct"
      : isAlmostAcceptedSentence(
            answer.text,
            definition.content.sentence,
            definition.answerContract.acceptedAnswers,
          )
        ? "almost-correct"
        : "incorrect";
    return exerciseEvaluationSchema.parse({
      exerciseKind: definition.kind,
      answer,
      status,
      acceptedAnswerReveal: definition.answerContract.acceptedAnswers,
    });
  }
  if (definition.kind === "multiple-choice" && answer.kind === "multiple-choice") {
    return exerciseEvaluationSchema.parse({
      exerciseKind: definition.kind,
      answer,
      status:
        answer.selectedOptionPosition === definition.content.correctOptionPosition
          ? "correct"
          : "incorrect",
      acceptedAnswerReveal: [
        definition.content.options[definition.content.correctOptionPosition].label,
      ],
    });
  }
  if (definition.kind === "vocabulary-recall" && answer.kind === "vocabulary-recall") {
    return exerciseEvaluationSchema.parse({
      exerciseKind: definition.kind,
      answer,
      status: isAccepted(answer.text, definition.answerContract.acceptedAnswers)
        ? "correct"
        : "incorrect",
      acceptedAnswerReveal: definition.answerContract.acceptedAnswers,
    });
  }
  throw new Error("OD_EXERCISE_ANSWER_KIND_INVALID");
}
