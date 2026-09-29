import { supportedLanguagePolicy } from "./language-policy.js";
import {
  activityIdSchema,
  parsePortableExerciseContent,
  type PortableExerciseContent,
  exerciseGenerationCandidateSchema,
  exerciseIdSchema,
  generatedExerciseInstructions,
  type z,
} from "@call-nina/contracts";

import {
  aiProvenanceSchema,
  defaultFeedbackModeForExerciseKind,
  exerciseDefinitionSchema,
  lessonDefinitionSchema,
  type AiProvenance,
  type ExerciseDefinition,
  type LessonDefinition,
} from "./exercise.js";

type Candidate = z.infer<typeof exerciseGenerationCandidateSchema>["exercises"][number];

function normalized(value: string): string {
  return supportedLanguagePolicy("de").normalize(value);
}

function containsCompleteAnswer(text: string, answer: string): boolean {
  const haystack = normalized(text);
  const needle = normalized(answer);
  if (needle.length < 3) return false;
  let position = haystack.indexOf(needle);
  while (position >= 0) {
    const before = haystack.slice(Math.max(0, position - 1), position);
    const after = haystack.slice(position + needle.length, position + needle.length + 1);
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
      return true;
    }
    position = haystack.indexOf(needle, position + 1);
  }
  return false;
}

function assertDistinct(values: readonly string[], code: string): void {
  const keys = values.map(normalized);
  if (new Set(keys).size !== keys.length) throw new Error(code);
}

function acceptedAnswers(candidate: Candidate): readonly string[] {
  if (
    candidate.kind === "short-answer" ||
    candidate.kind === "sentence-correction" ||
    candidate.kind === "vocabulary-recall"
  ) {
    return candidate.acceptedAnswers;
  }
  if (candidate.kind === "fill-in-the-blank") {
    return candidate.blanks.flatMap(({ acceptedAnswers: answers }) => answers);
  }
  if (candidate.kind === "multiple-choice") {
    return [candidate.options[candidate.correctOptionPosition] ?? ""];
  }
  return [];
}

function visibleCandidateText(candidate: Candidate): string {
  // Explanations appear after submission. App-owned wording does not disclose an answer.
  const shared = [candidate.title];
  if (
    candidate.kind === "free-writing" ||
    candidate.instructions !== generatedExerciseInstructions[candidate.kind]
  ) {
    shared.push(candidate.instructions);
  }
  if (candidate.kind === "free-writing") shared.push(candidate.prompt);
  else if (candidate.kind === "short-answer" || candidate.kind === "multiple-choice") {
    shared.push(candidate.question);
  } else if (candidate.kind === "fill-in-the-blank") {
    shared.push(
      candidate.leadingText,
      ...candidate.blanks.map(({ followingText }) => followingText),
    );
  } else if (candidate.kind === "sentence-correction") shared.push(candidate.sentence);
  else shared.push(candidate.cue);
  return normalized(shared.join(" "));
}

function assertCandidateQuality(candidate: Candidate): void {
  const answers = acceptedAnswers(candidate);
  if (candidate.kind === "fill-in-the-blank") {
    for (const blank of candidate.blanks) {
      assertDistinct(blank.acceptedAnswers, "OD_EXERCISE_DUPLICATE_ANSWER");
    }
  } else {
    assertDistinct(answers, "OD_EXERCISE_DUPLICATE_ANSWER");
  }
  if (candidate.kind === "multiple-choice") {
    assertDistinct(candidate.options, "OD_EXERCISE_DUPLICATE_OPTION");
  }
  const preSubmitText = normalized(
    `${visibleCandidateText(candidate)} ${candidate.hints.join(" ")}`,
  );
  if (answers.some((answer) => containsCompleteAnswer(preSubmitText, answer))) {
    throw new Error("OD_EXERCISE_ANSWER_LEAK");
  }
}

export function materializeGeneratedExercise(
  candidateValue: Candidate,
  options: {
    exerciseId: string;
    aiProvenance: AiProvenance;
    curriculumTopicIds?: readonly string[];
  },
): ExerciseDefinition {
  const candidate = exerciseGenerationCandidateSchema.shape.exercises.element.parse(candidateValue);
  assertCandidateQuality(candidate);
  const shared = {
    exerciseId: exerciseIdSchema.parse(options.exerciseId),
    aiProvenance: aiProvenanceSchema.parse(options.aiProvenance),
    cefrBand: candidate.cefrBand.toLowerCase(),
    objectives: candidate.objectives.map((description, position) => ({
      key: `objective-${String(position + 1)}`,
      description,
    })),
    instructions: candidate.instructions,
    ...(candidate.explanation === null ? {} : { explanation: candidate.explanation }),
    hints: candidate.hints.map((text) => ({ text })),
    feedbackMode: defaultFeedbackModeForExerciseKind(),
    curriculumTopicIds: options.curriculumTopicIds ?? [],
    vocabularySetLinks: [],
  };
  if (candidate.kind === "free-writing") {
    return exerciseDefinitionSchema.parse({
      ...shared,
      kind: candidate.kind,
      content: { prompt: candidate.prompt },
      answerContract: {
        kind: "free-text",
        maximumCharacters: candidate.maximumCharacters,
        evaluation: "ai",
      },
    });
  }
  if (candidate.kind === "short-answer") {
    return exerciseDefinitionSchema.parse({
      ...shared,
      kind: candidate.kind,
      content: { question: candidate.question },
      answerContract: {
        kind: "short-text",
        acceptedAnswers: candidate.acceptedAnswers,
        evaluation: "accepted-answer-or-ai",
      },
    });
  }
  if (candidate.kind === "fill-in-the-blank") {
    return exerciseDefinitionSchema.parse({
      ...shared,
      kind: candidate.kind,
      content: { leadingText: candidate.leadingText, blanks: candidate.blanks },
      answerContract: { kind: "blank-values", addressing: "zero-based-index" },
    });
  }
  if (candidate.kind === "sentence-correction") {
    return exerciseDefinitionSchema.parse({
      ...shared,
      kind: candidate.kind,
      content: { sentence: candidate.sentence },
      answerContract: {
        kind: "corrected-sentence",
        acceptedAnswers: candidate.acceptedAnswers,
        evaluation: "accepted-answer",
      },
    });
  }
  if (candidate.kind === "multiple-choice") {
    return exerciseDefinitionSchema.parse({
      ...shared,
      kind: candidate.kind,
      content: {
        question: candidate.question,
        options: candidate.options.map((label) => ({ label })),
        correctOptionPosition: candidate.correctOptionPosition,
      },
      answerContract: { kind: "single-option", addressing: "zero-based-index" },
    });
  }
  return exerciseDefinitionSchema.parse({
    ...shared,
    kind: candidate.kind,
    content: { cue: candidate.cue, direction: candidate.direction },
    answerContract: { kind: "recalled-text", acceptedAnswers: candidate.acceptedAnswers },
  });
}

export function materializeGeneratedExerciseSet(
  outputValue: z.infer<typeof exerciseGenerationCandidateSchema>,
  options: {
    exerciseIds: readonly string[];
    aiProvenance: AiProvenance;
    curriculumTopicIds?: readonly string[];
  },
): readonly ExerciseDefinition[] {
  const output = exerciseGenerationCandidateSchema.parse(outputValue);
  if (output.exercises.length !== options.exerciseIds.length) {
    throw new Error("OD_EXERCISE_ID_COUNT_INVALID");
  }
  assertDistinct(
    output.exercises.map(({ title }) => title),
    "OD_EXERCISE_DUPLICATE_CONTENT",
  );
  return Object.freeze(
    output.exercises.map((candidate, position) =>
      materializeGeneratedExercise(candidate, {
        exerciseId: options.exerciseIds[position] ?? "",
        aiProvenance: options.aiProvenance,
        ...(options.curriculumTopicIds ? { curriculumTopicIds: options.curriculumTopicIds } : {}),
      }),
    ),
  );
}

export function materializeGeneratedLesson(
  outputValue: z.infer<typeof exerciseGenerationCandidateSchema>,
  options: {
    activityId: string;
    naturalRequest: string;
    exerciseIds: readonly string[];
    aiProvenance: AiProvenance;
    curriculumTopicIds?: readonly string[];
  },
): LessonDefinition | undefined {
  const output = exerciseGenerationCandidateSchema.parse(outputValue);
  if (!output.lesson) return undefined;
  const exercises = materializeGeneratedExerciseSet(output, options);
  const objectiveDescriptions = [
    ...new Set(
      exercises.flatMap(({ objectives }) => objectives.map(({ description }) => description)),
    ),
  ].slice(0, 12);
  return lessonDefinitionSchema.parse({
    activityId: activityIdSchema.parse(options.activityId),
    intent: {
      kind: "custom",
      naturalRequest: options.naturalRequest,
      curriculumTopicIds: options.curriculumTopicIds ?? [],
      vocabularySetLinks: [],
    },
    aiProvenance: options.aiProvenance,
    cefrBand: exercises[0]?.cefrBand,
    title: output.lesson.title,
    objectives: objectiveDescriptions.map((description, position) => ({
      key: `objective-${String(position + 1)}`,
      description,
    })),
    explanation: output.lesson.explanation,
    content: [
      ...output.lesson.sections,
      ...output.lesson.vocabularyFoundations.map((item) => ({
        heading: item.german,
        content: `${item.explanation} — ${item.example}`,
      })),
    ],
    exercises,
  });
}

/** Materialize a stored revision, preserving its identity across practice attempts. */
export function materializeContentExercises(
  contentValue: PortableExerciseContent,
  options: Parameters<typeof materializeGeneratedExerciseSet>[1],
): readonly ExerciseDefinition[] {
  const content = parsePortableExerciseContent(contentValue);
  return materializeGeneratedExerciseSet(content.payload, {
    ...options,
    curriculumTopicIds: content.goal.curriculumTopicIds,
  }).map((exercise, position) =>
    exerciseDefinitionSchema.parse({
      ...exercise,
      contentReference: {
        contentId: content.contentId,
        revisionId: content.revisionId,
        exercise: content.exercises[position],
        materials: content.materials.map(({ materialId, revisionId }) => ({
          materialId,
          revisionId,
        })),
      },
    }),
  );
}
