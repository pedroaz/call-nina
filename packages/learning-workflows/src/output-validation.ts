import {
  normalizeGermanAnswer,
  vocabularyIdentity,
  vocabularyLemma,
  generationCandidateOutputSchemas,
  maximumStructuredOutputBytes,
  generatedExerciseInstructions,
  type GenerationCandidateOutputMap,
  type GenerationInput,
  type GenerationKind,
} from "@call-nina/contracts";

const maximumIssues = 12;

export type SafeOutputValidationIssue = Readonly<{
  code: string;
  path: readonly (number | "<field>")[];
  location?: ExerciseValidationLocation;
}>;

export type ExerciseValidationLocation = Readonly<{
  exerciseIndex: number;
  field:
    | "acceptedAnswers"
    | "options"
    | "cefrBand"
    | "title"
    | "instructions"
    | "question"
    | "leadingText"
    | "followingText"
    | "sentence"
    | "cue"
    | "hint"
    | "combined";
  answerLength?: number;
  fieldIndex?: number;
}>;

export class GenerationOutputValidationError extends Error {
  readonly issues: readonly SafeOutputValidationIssue[];
  readonly location: ExerciseValidationLocation | undefined;

  constructor(
    code: string,
    issues: readonly SafeOutputValidationIssue[] = [],
    location?: ExerciseValidationLocation,
  ) {
    super(code);
    this.name = "GenerationOutputValidationError";
    this.issues = Object.freeze([...issues]);
    this.location = location ?? issues[0]?.location;
  }
}

function safeIssues(error: {
  readonly issues: readonly {
    readonly code: string;
    readonly path: readonly PropertyKey[];
  }[];
}): readonly SafeOutputValidationIssue[] {
  return Object.freeze(
    error.issues.slice(0, maximumIssues).map((issue) =>
      Object.freeze({
        code: issue.code,
        path: Object.freeze(
          issue.path
            .slice(0, 8)
            .map((segment) => (typeof segment === "number" ? segment : ("<field>" as const))),
        ),
      }),
    ),
  );
}

export function parseGenerationCandidateOutput<Kind extends GenerationKind>(
  kind: Kind,
  finalOutput: unknown,
  input?: Extract<GenerationInput, { kind: Kind }>,
): GenerationCandidateOutputMap[Kind] {
  if (typeof finalOutput !== "string") {
    throw new GenerationOutputValidationError("OD_GENERATION_OUTPUT_NOT_TEXT");
  }
  const byteLength = new TextEncoder().encode(finalOutput).byteLength;
  if (byteLength === 0 || byteLength > maximumStructuredOutputBytes) {
    throw new GenerationOutputValidationError("OD_GENERATION_OUTPUT_SIZE_INVALID");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(finalOutput) as unknown;
  } catch {
    throw new GenerationOutputValidationError("OD_GENERATION_OUTPUT_JSON_INVALID");
  }

  const parsed = generationCandidateOutputSchemas[kind].safeParse(candidate);
  if (!parsed.success) {
    throw new GenerationOutputValidationError(
      "OD_GENERATION_OUTPUT_SCHEMA_INVALID",
      safeIssues(parsed.error),
    );
  }
  const workloadInput: GenerationInput | undefined = input;
  if (kind === "voice-activity-draft" && workloadInput?.kind === "voice-activity-draft") {
    const output = parsed.data as GenerationCandidateOutputMap["voice-activity-draft"];
    if (
      (workloadInput.voiceKind === "listening" && output.script === null) ||
      (workloadInput.voiceKind === "speaking" && output.script !== null)
    ) {
      throw new GenerationOutputValidationError("OD_VOICE_ACTIVITY_DRAFT_INVALID");
    }
  }
  if (kind === "flashcard-generation") {
    const output = parsed.data as GenerationCandidateOutputMap["flashcard-generation"];
    output.cards = output.cards.map((card) => ({ ...card, lemma: vocabularyLemma(card) }));
    const request = input as Extract<GenerationInput, { kind: "flashcard-generation" }> | undefined;
    if (
      request &&
      (output.cards.length !== request.cardCount ||
        output.targetLevel !== request.targetLevel ||
        new Set(output.cards.map(vocabularyIdentity)).size !== output.cards.length)
    ) {
      throw new GenerationOutputValidationError("OD_GENERATION_FLASHCARD_CONSTRAINT_INVALID");
    }
  }
  if (kind === "exercise-generation") {
    const output = parsed.data as GenerationCandidateOutputMap["exercise-generation"];
    const issues: SafeOutputValidationIssue[] = [];
    const report: ReportIssue = (code, location) => {
      const issue = { code, path: [], ...(location ? { location } : {}) };
      if (!issues.some((existing) => JSON.stringify(existing) === JSON.stringify(issue))) {
        issues.push(issue);
      }
    };
    if (
      workloadInput?.kind === "exercise-generation" &&
      workloadInput.practiceType === "vocabulary-review" &&
      output.exercises.some(
        (exercise) => !["vocabulary-recall", "multiple-choice"].includes(exercise.kind),
      )
    ) {
      report("OD_GENERATION_EXERCISE_CONSTRAINT_INVALID");
    }
    if (workloadInput?.kind === "exercise-generation" && workloadInput.reading) {
      if (
        !output.readingMaterial ||
        (workloadInput.reading.passage !== null &&
          output.readingMaterial.passage !== workloadInput.reading.passage) ||
        (workloadInput.practiceType !== "vocabulary-review" &&
          !output.exercises.some((exercise) => exercise.kind === "free-writing"))
      ) {
        report("OD_READING_MATERIAL_INVALID");
      }
    } else if (output.readingMaterial) {
      report("OD_READING_MATERIAL_UNEXPECTED");
    }
    if (
      workloadInput?.kind === "exercise-generation" &&
      workloadInput.courseTeaching?.objectives.length
    ) {
      const descriptions = workloadInput.courseTeaching.objectives.map((o) => o.description);
      if (workloadInput.courseTeaching.delivery === "practice") {
        const retrieval = workloadInput.learningPath?.retrieval ?? "recall";
        const kinds =
          retrieval === "recognition"
            ? ["multiple-choice"]
            : retrieval === "use"
              ? ["free-writing"]
              : ["short-answer", "fill-in-the-blank"];
        if (output.exercises.some((e) => !kinds.includes(e.kind)))
          report("OD_COURSE_OBJECTIVE_MISMATCH");
      }

      if (
        output.exercises.some(
          (exercise) =>
            exercise.objectives.length !== descriptions.length ||
            descriptions.some((d) => !exercise.objectives.includes(d)),
        ) ||
        (workloadInput.courseTeaching.delivery === "writing" &&
          output.exercises.some((exercise) => exercise.kind !== "free-writing"))
      ) {
        report("OD_COURSE_OBJECTIVE_MISMATCH");
      }
    }
    collectExerciseGenerationIssues(
      output,
      report,
      workloadInput?.kind === "exercise-generation"
        ? workloadInput.calibration.approximateLevel
        : undefined,
      workloadInput?.kind === "exercise-generation"
        ? workloadInput.requestedExerciseCount
        : undefined,
    );
    const first = issues[0];
    if (first) throw new GenerationOutputValidationError(first.code, issues);
  }
  return parsed.data as GenerationCandidateOutputMap[Kind];
}

function normalized(value: string): string {
  return normalizeGermanAnswer(value);
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

type ReportIssue = (code: string, location?: ExerciseValidationLocation) => void;

function collectDuplicates(
  values: readonly string[],
  code: string,
  report: ReportIssue,
  location?: (duplicateIndex: number) => ExerciseValidationLocation,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const key = normalized(value);
    if (seen.has(key)) {
      report(code, location?.(index));
    }
    seen.add(key);
  }
}

function exerciseSignature(
  exercise: GenerationCandidateOutputMap["exercise-generation"]["exercises"][number],
): string {
  if (exercise.kind === "free-writing") return `${exercise.kind}:${normalized(exercise.prompt)}`;
  if (exercise.kind === "short-answer") return `${exercise.kind}:${normalized(exercise.question)}`;
  if (exercise.kind === "fill-in-the-blank") {
    return `${exercise.kind}:${normalized(
      exercise.leadingText + exercise.blanks.map(({ followingText }) => followingText).join(""),
    )}`;
  }
  if (exercise.kind === "sentence-correction") {
    return `${exercise.kind}:${normalized(exercise.sentence)}`;
  }
  if (exercise.kind === "multiple-choice") {
    return `${exercise.kind}:${normalized(exercise.question)}`;
  }
  return `${exercise.kind}:${exercise.direction}:${normalized(exercise.cue)}`;
}

function visibleExerciseFields(
  exercise: GenerationCandidateOutputMap["exercise-generation"]["exercises"][number],
): { field: ExerciseValidationLocation["field"]; text: string; fieldIndex?: number }[] {
  // Fixed instructions cannot disclose a choice; explanations are post-submission feedback.
  const fields: {
    field: ExerciseValidationLocation["field"];
    text: string;
    fieldIndex?: number;
  }[] = [{ field: "title", text: exercise.title }];
  if (
    exercise.kind === "free-writing" ||
    exercise.instructions !== generatedExerciseInstructions[exercise.kind]
  ) {
    fields.push({ field: "instructions", text: exercise.instructions });
  }
  if (exercise.kind === "short-answer" || exercise.kind === "multiple-choice") {
    fields.push({ field: "question", text: exercise.question });
  } else if (exercise.kind === "fill-in-the-blank") {
    fields.push({ field: "leadingText", text: exercise.leadingText });
    fields.push(
      ...exercise.blanks.map(({ followingText }, fieldIndex) => ({
        field: "followingText" as const,
        text: followingText,
        fieldIndex,
      })),
    );
  } else if (exercise.kind === "sentence-correction") {
    fields.push({ field: "sentence", text: exercise.sentence });
  } else if (exercise.kind === "vocabulary-recall") {
    fields.push({ field: "cue", text: exercise.cue });
  }
  fields.push(
    ...exercise.hints.map((text, fieldIndex) => ({
      field: "hint" as const,
      text,
      fieldIndex,
    })),
  );
  return fields;
}

function collectExerciseGenerationIssues(
  output: GenerationCandidateOutputMap["exercise-generation"],
  report: ReportIssue,
  expectedLevel?: "A1" | "A2" | "B1" | "B2",
  expectedExerciseCount?: number,
): void {
  if (expectedExerciseCount !== undefined && output.exercises.length !== expectedExerciseCount) {
    report("OD_EXERCISE_COUNT_MISMATCH");
  }
  collectDuplicates(
    output.exercises.map(({ title }) => title),
    "OD_EXERCISE_DUPLICATE_TITLE",
    report,
    (exerciseIndex) => ({ exerciseIndex, field: "title" }),
  );
  collectDuplicates(
    output.exercises.map(exerciseSignature),
    "OD_EXERCISE_DUPLICATE_CONTENT",
    report,
    (exerciseIndex) => ({ exerciseIndex, field: "combined" }),
  );
  for (const [exerciseIndex, exercise] of output.exercises.entries()) {
    if (expectedLevel && exercise.cefrBand !== expectedLevel) {
      report("OD_EXERCISE_LEVEL_MISMATCH", {
        exerciseIndex,
        field: "cefrBand",
      });
    }
    const answerGroups =
      exercise.kind === "fill-in-the-blank"
        ? exercise.blanks.map(({ acceptedAnswers }) => acceptedAnswers)
        : exercise.kind === "short-answer" ||
            exercise.kind === "sentence-correction" ||
            exercise.kind === "vocabulary-recall"
          ? [exercise.acceptedAnswers]
          : exercise.kind === "multiple-choice"
            ? [[exercise.options[exercise.correctOptionPosition] ?? ""]]
            : [];
    if (exercise.kind === "multiple-choice") {
      collectDuplicates(exercise.options, "OD_EXERCISE_DUPLICATE_OPTION", report, () => ({
        exerciseIndex,
        field: "options",
      }));
    }
    const fields = visibleExerciseFields(exercise);
    for (const [groupIndex, answers] of answerGroups.entries()) {
      const answerLocation: ExerciseValidationLocation = {
        exerciseIndex,
        field: "acceptedAnswers",
        ...(exercise.kind === "fill-in-the-blank" ? { fieldIndex: groupIndex } : {}),
      };
      collectDuplicates(answers, "OD_EXERCISE_DUPLICATE_ANSWER", report, () => answerLocation);
      for (const { field, text, fieldIndex } of fields) {
        const leaked = answers.find((answer) => containsCompleteAnswer(text, answer));
        if (leaked !== undefined) {
          report("OD_EXERCISE_ANSWER_LEAK", {
            exerciseIndex,
            field,
            ...(fieldIndex === undefined ? {} : { fieldIndex }),
            answerLength: normalized(leaked).length,
          });
        }
      }
      // Also catch complete answers assembled across adjacent visible fields.
      const combined = fields.map(({ text }) => text).join(" ");
      const splitAnswer = answers.find(
        (answer) =>
          containsCompleteAnswer(combined, answer) &&
          !fields.some(({ text }) => containsCompleteAnswer(text, answer)),
      );
      if (splitAnswer !== undefined) {
        report("OD_EXERCISE_ANSWER_LEAK", {
          exerciseIndex,
          field: "combined",
          answerLength: normalized(splitAnswer).length,
        });
      }
    }
  }

  if (output.lesson) {
    collectDuplicates(
      output.lesson.sections.map(({ heading }) => heading),
      "OD_LESSON_DUPLICATE_SECTION",
      report,
    );
    collectDuplicates(
      output.lesson.vocabularyFoundations.map(({ german }) => german),
      "OD_LESSON_DUPLICATE_VOCABULARY",
      report,
    );
  }
}

export function repairIssueCodes(error: GenerationOutputValidationError): readonly string[] {
  const codes = new Set<string>([error.message]);
  for (const issue of error.issues) codes.add(issue.code);
  return Object.freeze([...codes].slice(0, maximumIssues + 1));
}
