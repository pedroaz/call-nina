import { supportedLanguagePolicy } from "./language-policy.js";
import {
  activityIdSchema,
  parsePortableExerciseContent,
  type PortableExerciseContent,
  exerciseGenerationCandidateSchema,
  exerciseIdSchema,
  isGeneratedExerciseInstruction,
  type Language,
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

function qualityPolicy(language: Language) {
  const normalized = supportedLanguagePolicy(language).normalize;

  function containsCompleteAnswer(text: string, answer: string, caseSensitive = false): boolean {
    const normalize = caseSensitive
      ? (value: string) => value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ")
      : normalized;
    const haystack = normalize(text);
    const needle = normalize(answer);
    if (needle.length === 0) return false;
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
      !isGeneratedExerciseInstruction(candidate.kind, candidate.instructions)
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
    return shared.join(" ");
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
    const preSubmitText = `${visibleCandidateText(candidate)} ${candidate.hints.join(" ")}`;
    if (
      answers.some((answer) =>
        containsCompleteAnswer(preSubmitText, answer, candidate.kind === "sentence-correction"),
      )
    ) {
      throw new Error("OD_EXERCISE_ANSWER_LEAK");
    }
  }

  return { assertCandidateQuality, assertDistinct };
}

function materializeExercise(
  candidateValue: Candidate,
  options: {
    exerciseId: string;
    aiProvenance: AiProvenance;
    targetLanguage: Language;
    curriculumTopicIds?: readonly string[];
  },
  validateQuality: boolean,
): ExerciseDefinition {
  const candidate = exerciseGenerationCandidateSchema.shape.exercises.element.parse(candidateValue);
  if (validateQuality) qualityPolicy(options.targetLanguage).assertCandidateQuality(candidate);
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

export function materializeGeneratedExercise(
  candidate: Candidate,
  options: Parameters<typeof materializeExercise>[1],
): ExerciseDefinition {
  return materializeExercise(candidate, options, true);
}

export function materializeGeneratedExerciseSet(
  outputValue: z.infer<typeof exerciseGenerationCandidateSchema>,
  options: {
    exerciseIds: readonly string[];
    aiProvenance: AiProvenance;
    targetLanguage: Language;
    curriculumTopicIds?: readonly string[];
  },
): readonly ExerciseDefinition[] {
  const output = exerciseGenerationCandidateSchema.parse(outputValue);
  if (output.exercises.length !== options.exerciseIds.length) {
    throw new Error("OD_EXERCISE_ID_COUNT_INVALID");
  }
  qualityPolicy(options.targetLanguage).assertDistinct(
    output.exercises.map(({ title }) => title),
    "OD_EXERCISE_DUPLICATE_CONTENT",
  );
  return Object.freeze(
    output.exercises.map((candidate, position) =>
      materializeGeneratedExercise(candidate, {
        exerciseId: options.exerciseIds[position] ?? "",
        targetLanguage: options.targetLanguage,
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
    targetLanguage: Language;
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
        heading: item.term,
        content: `${item.explanation} — ${item.example}`,
      })),
    ],
    exercises,
  });
}

/** Materialize a stored revision, preserving its identity across practice attempts. */
export function materializeContentExercises(
  contentValue: PortableExerciseContent,
  options: Omit<Parameters<typeof materializeGeneratedExerciseSet>[1], "targetLanguage">,
): readonly ExerciseDefinition[] {
  const content = parsePortableExerciseContent(contentValue);
  // Reopening an immutable revision validates its contract, not today's generation-quality policy.
  // Old accepted drafts keep their exact instructions/answers even as generation rules improve.
  if (content.payload.exercises.length !== options.exerciseIds.length)
    throw new Error("OD_EXERCISE_ID_COUNT_INVALID");
  return content.payload.exercises
    .map((candidate, position) =>
      materializeExercise(
        candidate,
        {
          exerciseId: options.exerciseIds[position] ?? "",
          aiProvenance: options.aiProvenance,
          targetLanguage: content.language,
          curriculumTopicIds: content.goal.curriculumTopicIds,
        },
        false,
      ),
    )
    .map((exercise, position) =>
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
