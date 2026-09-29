import { exerciseEntryContextSchema } from "./exercise-launch.js";
import { generationProvenanceSchema, type GenerationProvenance } from "./generation-provenance.js";
import { materialDraftSchema, materialReferenceSchema } from "./material.js";
import { languageSchema, learningContextSchema, type Language } from "./learning-context.js";
import {
  flashcardGenerationCandidateSchema,
  generatedFlashcardSchema,
  practiceCountSchema,
} from "./flashcards.js";
import { courseReferenceSchema, courseTeachingContextSchema } from "./learning-path.js";
import {
  activityIdSchema,
  calendarDateSchema,
  correlationIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  mistakeIdSchema,
  modelRequestIdSchema,
  vocabularyIdSchema,
} from "./common.js";
import { callNinaErrorSchema } from "./errors.js";
import {
  boundaryUnion,
  strictBoundaryObject,
  toStructuredOutputJsonSchema,
  z,
} from "./schema-system.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const runtimeId = (maximum = 200) => text(maximum).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

export const generationKinds = [
  "writing-prompt",
  "voice-activity-draft",
  "writing-correction",
  "contextual-help",
  "flashcard-generation",
  "exercise-generation",
  "exercise-feedback",
] as const;
export const generationKindSchema = z.enum(generationKinds);

export const generationOutputSchemaIds = {
  "writing-prompt": "call-nina/writing-prompt@1",
  "voice-activity-draft": "call-nina/voice-activity-draft@1",
  "writing-correction": "call-nina/writing-correction@1",
  "contextual-help": "call-nina/contextual-help@1",
  "flashcard-generation": "call-nina/flashcard-generation@1",
  "exercise-generation": "call-nina/exercise-generation@1",
  "exercise-feedback": "call-nina/exercise-feedback@1",
} as const;
export const generationOutputSchemaIdSchema = z.enum(Object.values(generationOutputSchemaIds));

const outputUncertaintySchema = z.discriminatedUnion("level", [
  z.strictObject({ level: z.literal("none") }),
  z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(1_000) }),
]);
const outputCaveatsSchema = z.array(text(1_000)).max(12);

export const writingPromptCandidateSchema = strictBoundaryObject({
  title: text(160),
  format: z.enum([
    "short-message",
    "email",
    "note",
    "short-response",
    "practical-description",
    "essay",
  ]),
  situation: text(500),
  task: text(1_000),
  suggestedWordCount: z.int().min(20).max(300),
  helpfulVocabulary: z
    .array(
      z.strictObject({
        term: text(160),
        explanation: text(500),
      }),
    )
    .max(6),
  uncertainty: outputUncertaintySchema,
  caveats: outputCaveatsSchema,
});

export const voiceActivityDraftCandidateSchema = strictBoundaryObject({
  scenario: text(240),
  objectives: z.array(text(500)).min(1).max(8),
  script: text(2_400).nullable(),
  questions: z.array(text(500)).min(1).max(8),
  answerGuidance: z.array(text(500)).min(1).max(8),
});

export const writingCorrectionCandidateSchema = strictBoundaryObject({
  correctedText: text(12_000),
  summary: text(2_000),
  changes: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("replacement"),
          originalText: text(12_000),
          correctedText: text(12_000),
          category: z.enum([
            "grammar",
            "spelling",
            "punctuation",
            "word-choice",
            "word-order",
            "register",
            "idiom",
            "clarity",
          ]),
          severity: z.enum(["minor", "meaning-affecting"]),
          explanation: text(800),
          uncertainty: outputUncertaintySchema,
        }),
        z.strictObject({
          kind: z.literal("insertion"),
          originalText: z.literal(""),
          correctedText: text(12_000),
          category: z.enum([
            "grammar",
            "spelling",
            "punctuation",
            "word-choice",
            "word-order",
            "register",
            "idiom",
            "clarity",
          ]),
          severity: z.enum(["minor", "meaning-affecting"]),
          explanation: text(800),
          uncertainty: outputUncertaintySchema,
        }),
        z.strictObject({
          kind: z.literal("deletion"),
          originalText: text(12_000),
          correctedText: z.literal(""),
          category: z.enum([
            "grammar",
            "spelling",
            "punctuation",
            "word-choice",
            "word-order",
            "register",
            "idiom",
            "clarity",
          ]),
          severity: z.enum(["minor", "meaning-affecting"]),
          explanation: text(800),
          uncertainty: outputUncertaintySchema,
        }),
      ]),
    )
    .max(200),
  naturalAlternative: text(12_000).nullable(),
  vocabularyCandidates: z
    .array(
      z.strictObject({
        lemma: text(160),
        meaning: text(500),
        sourceExcerpt: text(500),
        rationale: text(800),
        uncertainty: outputUncertaintySchema,
      }),
    )
    .max(50),
  nextPracticeSuggestion: text(1_000).nullable(),
  overallUncertainty: outputUncertaintySchema,
  caveats: outputCaveatsSchema,
});

export const contextualHelpCandidateSchema = strictBoundaryObject({
  answer: text(4_000),
  examples: z.array(text(1_000)).max(8),
  alternatives: z.array(text(1_000)).max(8),
  translations: z
    .array(
      z.strictObject({
        sourceText: text(1_000),
        translatedText: text(1_000),
      }),
    )
    .max(8),
  miniExercises: z
    .array(
      z.strictObject({
        prompt: text(1_000),
        suggestedAnswer: text(1_000),
      }),
    )
    .max(4),
  followUpSuggestions: z.array(text(500)).max(5),
  uncertainty: outputUncertaintySchema,
  caveats: outputCaveatsSchema,
});

// Request-time wording is app-owned; persisted exercise payloads retain their task text.
export const generatedExerciseInstructions = {
  "en-US": {
    "short-answer": "Answer the question.",
    "fill-in-the-blank": "Fill in the blanks.",
    "sentence-correction": "Correct the sentence.",
    "multiple-choice": "Choose the answer.",
    "vocabulary-recall": "Give the meaning or target word.",
  },
  "pt-BR": {
    "short-answer": "Responda à pergunta.",
    "fill-in-the-blank": "Complete as lacunas.",
    "sentence-correction": "Corrija a frase.",
    "multiple-choice": "Escolha a resposta.",
    "vocabulary-recall": "Indique o significado ou a palavra no idioma de estudo.",
  },
  es: {
    "short-answer": "Responde a la pregunta.",
    "fill-in-the-blank": "Completa los espacios.",
    "sentence-correction": "Corrige la oración.",
    "multiple-choice": "Elige la respuesta.",
    "vocabulary-recall": "Indica el significado o la palabra en el idioma de estudio.",
  },
  de: {
    "short-answer": "Frage beantworten.",
    "fill-in-the-blank": "Lücken ergänzen.",
    "sentence-correction": "Satz korrigieren.",
    "multiple-choice": "Passende Antwort auswählen.",
    "vocabulary-recall": "Bedeutung oder Zielwort angeben.",
  },
} as const satisfies Record<Language, Record<string, string>>;

export function isGeneratedExerciseInstruction(kind: string, instructions: string): boolean {
  return Object.values(generatedExerciseInstructions).some((set) =>
    Object.entries(set).some(([key, text]) => key === kind && text === instructions),
  );
}

const candidateExerciseShape = {
  title: text(160),
  instructions: text(4_000),
  explanation: text(4_000)
    .describe(
      "Feedback shown only after submission. Explain the correct answer here; never put task requirements here.",
    )
    .nullable(),
  cefrBand: z.enum(["A1", "A2", "B1", "B2"]),
  objectives: z.array(text(500)).min(1).max(12),
  hints: z.array(text(1_000)).max(5),
} as const;
const generatedExerciseContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...candidateExerciseShape,
    kind: z.literal("free-writing"),
    prompt: text(12_000),
    maximumCharacters: z.int().min(1).max(10_000),
  }),
  z.strictObject({
    ...candidateExerciseShape,
    kind: z.literal("short-answer"),
    hints: z.array(text(1_000)).min(2).max(5),
    question: text(12_000),
    acceptedAnswers: z.array(text(500)).min(1).max(20),
  }),
  z.strictObject({
    ...candidateExerciseShape,
    kind: z.literal("fill-in-the-blank"),
    leadingText: z.string().max(4_000),
    blanks: z
      .array(
        z.strictObject({
          acceptedAnswers: z.array(text(500)).min(1).max(20),
          followingText: z.string().max(4_000),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.strictObject({
    ...candidateExerciseShape,
    kind: z.literal("sentence-correction"),
    sentence: text(12_000),
    acceptedAnswers: z.array(text(500)).min(1).max(20),
  }),
  z.strictObject({
    ...candidateExerciseShape,
    kind: z.literal("multiple-choice"),
    question: text(12_000),
    options: z.tuple([text(500), text(500), text(500), text(500)]),
    correctOptionPosition: z
      .int()
      .min(0)
      .max(3)
      .describe(
        "Zero-based index: 0 = first option, 1 = second option, 2 = third option, 3 = fourth option. Select the grammatical answer that meets the question and objective.",
      ),
  }),
  z.strictObject({
    ...candidateExerciseShape,
    kind: z.literal("vocabulary-recall"),
    cue: text(12_000),
    direction: z.enum(["recognition", "production"]),
    acceptedAnswers: z.array(text(500)).min(1).max(20),
  }),
]);

export const exerciseGenerationCandidateSchema = strictBoundaryObject({
  readingMaterial: z
    .strictObject({ title: text(160), passage: text(12_000) })
    .nullable()
    .default(null),
  lesson: z
    .strictObject({
      title: text(160),
      explanation: text(4_000),
      sections: z
        .array(z.strictObject({ heading: text(160), content: text(12_000) }))
        .min(1)
        .max(20),
      vocabularyFoundations: z
        .array(
          z.strictObject({
            term: text(160),
            explanation: text(500),
            example: text(1_000),
          }),
        )
        .max(20),
    })
    .nullable()
    .default(null),
  exercises: z.array(generatedExerciseContentSchema).min(1).max(30),
  uncertainty: outputUncertaintySchema,
  caveats: outputCaveatsSchema,
});

export const exerciseFeedbackCandidateSchema = strictBoundaryObject({
  outcome: z.enum(["demonstrated", "developing", "not-demonstrated"]),
  summary: text(4_000),
  strengths: z.array(text(1_000)).max(20),
  improvements: z.array(text(1_000)).max(20),
  objectiveEvaluations: z
    .array(
      z.strictObject({
        outcome: z.enum(["demonstrated", "developing", "not-demonstrated", "not-evaluated"]),
        evidence: text(1_000),
        uncertainty: outputUncertaintySchema,
      }),
    )
    .min(1)
    .max(12),
  suggestedAnswer: text(12_000).nullable(),
  nextStep: text(1_000).nullable(),
  overallUncertainty: outputUncertaintySchema,
  caveats: outputCaveatsSchema,
});

export const generationCandidateOutputSchemas = Object.freeze({
  "writing-prompt": writingPromptCandidateSchema,
  "voice-activity-draft": voiceActivityDraftCandidateSchema,
  "writing-correction": writingCorrectionCandidateSchema,
  "contextual-help": contextualHelpCandidateSchema,
  "flashcard-generation": flashcardGenerationCandidateSchema,
  "exercise-generation": exerciseGenerationCandidateSchema,
  "exercise-feedback": exerciseFeedbackCandidateSchema,
});

export const generationCandidateOutputJsonSchemas = Object.freeze({
  "writing-prompt": toStructuredOutputJsonSchema(writingPromptCandidateSchema),
  "voice-activity-draft": toStructuredOutputJsonSchema(voiceActivityDraftCandidateSchema),
  "writing-correction": toStructuredOutputJsonSchema(writingCorrectionCandidateSchema),
  "contextual-help": toStructuredOutputJsonSchema(contextualHelpCandidateSchema),
  "flashcard-generation": toStructuredOutputJsonSchema(flashcardGenerationCandidateSchema),
  "exercise-generation": toStructuredOutputJsonSchema(exerciseGenerationCandidateSchema),
  "exercise-feedback": toStructuredOutputJsonSchema(exerciseFeedbackCandidateSchema),
});

/** Bind model generation to the same request constraints checked after generation. */
export function generationOutputJsonSchemaForInput(input: GenerationInput): unknown {
  if (input.kind === "flashcard-generation") {
    return toStructuredOutputJsonSchema(
      strictBoundaryObject({
        ...flashcardGenerationCandidateSchema.shape,
        targetLevel: z.literal(input.targetLevel),
        cards: z.array(generatedFlashcardSchema).length(input.cardCount),
      }),
    );
  }
  if (input.kind === "voice-activity-draft") {
    return toStructuredOutputJsonSchema(
      strictBoundaryObject({
        ...voiceActivityDraftCandidateSchema.shape,
        script: input.voiceKind === "speaking" ? z.null() : text(2_400),
      }),
    );
  }
  if (input.kind !== "exercise-generation") {
    return generationCandidateOutputJsonSchemas[input.kind];
  }
  const exercises = generatedExerciseContentSchema.options.map((schema) =>
    schema.extend({
      cefrBand: z.literal(input.calibration.approximateLevel),
      ...(schema.shape.kind.value === "free-writing"
        ? {}
        : {
            instructions: z.literal(
              generatedExerciseInstructions[input.learningContext.explanationLanguage][
                schema.shape.kind.value
              ],
            ),
          }),
      ...(input.courseTeaching?.objectives.length
        ? {
            objectives: z
              .array(
                z.enum(
                  input.courseTeaching.objectives.map((o) => o.description) as [
                    string,
                    ...string[],
                  ],
                ),
              )
              .length(input.courseTeaching.objectives.length),
          }
        : {}),
    }),
  );
  return toStructuredOutputJsonSchema(
    strictBoundaryObject({
      ...exerciseGenerationCandidateSchema.shape,
      exercises: z.array(z.union(exercises)).length(input.requestedExerciseCount),
    }),
  );
}

const resolvedModelSelectionSchema = z.strictObject({
  model: z.discriminatedUnion("selection", [
    z.strictObject({ selection: z.literal("runtime-default") }),
    z.strictObject({ selection: z.literal("exact"), modelId: runtimeId() }),
  ]),
  effort: z.discriminatedUnion("selection", [
    z.strictObject({ selection: z.literal("runtime-default") }),
    z.strictObject({ selection: z.literal("exact"), effortId: runtimeId(100) }),
  ]),
});

const learnerCalibrationSchema = z.strictObject({
  approximateLevel: z.enum(["A1", "A2", "B1", "B2"]),
  explanationLanguage: languageSchema,
  teachingProfile: z.enum(["conversation-partner", "strict-corrector"]),
});

const correctionMistakeSampleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("grammar"),
    categoryKey: runtimeId(120),
    occurrenceCount: z.int().min(2).max(100),
    lastObservedOn: calendarDateSchema,
  }),
  z.strictObject({
    kind: z.literal("vocabulary"),
    categoryKey: runtimeId(120),
    lemma: text(160),
    occurrenceCount: z.int().min(2).max(100),
    lastObservedOn: calendarDateSchema,
  }),
]);

const learningContextFields = {
  relevantMistakes: z.array(correctionMistakeSampleSchema).max(6).default([]),
  vocabularyToReview: z
    .array(
      z.strictObject({
        vocabularyId: vocabularyIdSchema,
        lemma: text(160),
        meaning: text(500),
        example: text(500).optional(),
      }),
    )
    .max(12)
    .default([]),
} as const;

export const generationInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    learningContext: learningContextSchema,
    kind: z.literal("flashcard-generation"),
    topic: text(2_000),
    cardCount: practiceCountSchema,
    targetLevel: z.enum(["A1", "A2", "B1", "B2"]),
  }),
  z.strictObject({
    learningContext: learningContextSchema,
    kind: z.literal("writing-prompt"),
    naturalRequest: text(1_000).optional(),
    calibration: learnerCalibrationSchema,
  }),
  z.strictObject({
    learningContext: learningContextSchema,
    kind: z.literal("voice-activity-draft"),
    voiceKind: z.enum(["listening", "speaking"]),
    naturalRequest: text(2_000),
    targetLevel: z.enum(["A1", "A2", "B1", "B2"]),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]),
    correctionTiming: z.enum(["during", "after-each", "end"]),
    speakingPace: z.enum(["slow", "normal", "fast"]).optional(),
    calibration: learnerCalibrationSchema,
  }),
  z.strictObject({
    learningContext: learningContextSchema,
    kind: z.literal("writing-correction"),
    learnerText: text(12_000),
    activityGoal: text(1_000),
    calibration: learnerCalibrationSchema,
    feedback: z.strictObject({
      coverage: z.enum(["all-meaningful", "priority-only"]),
      showConciseExplanation: z.boolean(),
      showNaturalAlternative: z.boolean(),
    }),
    relevantMistakes: z.array(correctionMistakeSampleSchema).max(6),
  }),
  z.strictObject({
    learningContext: learningContextSchema,
    kind: z.literal("contextual-help"),
    activityId: activityIdSchema,
    intent: z.enum(["chat", "translate"]),
    selectedText: text(4_000),
    containingSentence: text(4_000),
    question: text(1_000),
    activeResultSummary: text(2_000).optional(),
    calibration: learnerCalibrationSchema,
    relevantMistakes: z.array(correctionMistakeSampleSchema).max(4),
    priorTurns: z
      .array(
        z.strictObject({
          question: text(1_000),
          answer: text(4_000),
        }),
      )
      .max(6),
  }),
  z.strictObject({
    learningContext: learningContextSchema,
    kind: z.literal("exercise-generation"),
    entry: exerciseEntryContextSchema,
    material: materialDraftSchema.optional(),
    materialReference: materialReferenceSchema.optional(),
    practiceType: z.enum(["grammar", "vocabulary-review"]).optional(),
    learningPath: courseReferenceSchema.optional(),
    courseTeaching: courseTeachingContextSchema.optional(),
    ...learningContextFields,
    naturalRequest: text(2_000),
    requestedExerciseCount: z.int().min(1).max(30),
    reading: z.strictObject({ passage: text(12_000).nullable() }).optional(),
    calibration: learnerCalibrationSchema,
    curriculumTopicIds: z.array(curriculumTopicIdSchema).max(20),
    relevantMistakeIds: z.array(mistakeIdSchema).max(12),
    relevantVocabularyIds: z.array(vocabularyIdSchema).max(24),
    targetedMistakePattern: z
      .strictObject({
        category: z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("grammar"),
            categoryKey: text(120),
            curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
          }),
          z.strictObject({
            kind: z.literal("vocabulary"),
            categoryKey: text(120),
            lemma: text(160),
          }),
        ]),
        evidence: z
          .array(
            z.strictObject({
              beforeContext: z.string().max(500),
              evidenceText: text(1_000),
              afterContext: z.string().max(500),
              explanation: text(800),
            }),
          )
          .min(1)
          .max(6),
      })
      .optional(),
  }),
  z.strictObject({
    learningContext: learningContextSchema,
    kind: z.literal("exercise-feedback"),
    courseCriterion: text(4000).optional(),
    readingPassage: text(12_000).optional(),
    exercise: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("free-writing"),
        instructions: text(4_000),
        prompt: text(12_000),
        objectives: z.array(text(500)).min(1).max(12),
        learnerAnswer: text(10_000),
      }),
      z.strictObject({
        kind: z.literal("short-answer"),
        instructions: text(4_000),
        question: text(12_000),
        objectives: z.array(text(500)).min(1).max(12),
        acceptedAnswers: z.array(text(500)).min(1).max(20),
        learnerAnswer: text(12_000),
      }),
      z.strictObject({
        kind: z.literal("sentence-correction"),
        instructions: text(4_000),
        sentence: text(12_000),
        objectives: z.array(text(500)).min(1).max(12),
        acceptedAnswers: z.array(text(500)).min(1).max(20),
        learnerAnswer: text(12_000),
      }),
    ]),
    calibration: learnerCalibrationSchema,
  }),
]);

export const generationOperationStartSchema = strictBoundaryObject({
  operationId: correlationIdSchema,
  submissionId: correlationIdSchema,
  dataRootGeneration: dataRootGenerationSchema,
  modelSelection: resolvedModelSelectionSchema,
  input: generationInputSchema,
});

const retainedSubmissionShape = {
  operationId: correlationIdSchema,
  submissionId: correlationIdSchema,
  kind: generationKindSchema,
  submission: z.literal("retained"),
} as const;
const nonterminalOperationStates = [
  "accepted",
  "queued",
  "starting",
  "running",
  "validating",
  "cancelling",
] as const;
const generationNonterminalOperationStateSchemas = nonterminalOperationStates.map((status) =>
  strictBoundaryObject({ ...retainedSubmissionShape, status: z.literal(status) }),
);
const generationValidatedOperationStateSchemas = generationKinds.map((kind) =>
  strictBoundaryObject({
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    kind: z.literal(kind),
    submission: z.literal("retained"),
    status: z.literal("validated"),
    modelRequestId: modelRequestIdSchema,
    outputSchemaId: z.literal(generationOutputSchemaIds[kind]),
    provenance: generationProvenanceSchema,
    output: generationCandidateOutputSchemas[kind],
  }),
);

const generationOperationStateSchemas = [
  ...generationNonterminalOperationStateSchemas,
  ...generationValidatedOperationStateSchemas,
  strictBoundaryObject({
    ...retainedSubmissionShape,
    status: z.literal("rate-limited"),
    reached: z.enum(["primary", "secondary", "both", "unknown"]),
    retryAt: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  }),
  strictBoundaryObject({ ...retainedSubmissionShape, status: z.literal("cancelled") }),
  strictBoundaryObject({
    ...retainedSubmissionShape,
    status: z.literal("failed"),
    error: callNinaErrorSchema,
  }),
] as const;
export const generationOperationStateSchema = boundaryUnion(
  generationOperationStateSchemas as unknown as [
    (typeof generationOperationStateSchemas)[number],
    (typeof generationOperationStateSchemas)[number],
    ...(typeof generationOperationStateSchemas)[number][],
  ],
);

const operationFinishedEvents = generationKinds.map((kind) =>
  strictBoundaryObject({
    event: z.literal("operation-finished"),
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    kind: z.literal(kind),
    outcome: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("validated"),
        modelRequestId: modelRequestIdSchema,
        outputSchemaId: z.literal(generationOutputSchemaIds[kind]),
      }),
      z.strictObject({ status: z.literal("cancelled") }),
      z.strictObject({
        status: z.literal("rate-limited"),
        reached: z.enum(["primary", "secondary", "both", "unknown"]),
        retryAt: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
      }),
      z.strictObject({ status: z.literal("failed"), error: callNinaErrorSchema }),
    ]),
  }),
);

export const generationEventSchema = boundaryUnion([
  strictBoundaryObject({
    event: z.literal("operation-state-changed"),
    state: generationOperationStateSchema,
  }),
  strictBoundaryObject({
    event: z.literal("operation-progress"),
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    kind: generationKindSchema,
    stage: z.enum(["queued", "starting", "running", "validating", "cancelling"]),
    attempt: z.union([z.literal(1), z.literal(2)]),
  }),
  ...operationFinishedEvents,
]);
export type GenerationKind = z.infer<typeof generationKindSchema>;
export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GenerationOperationStart = z.infer<typeof generationOperationStartSchema>;
export type GenerationOperationState = z.infer<typeof generationOperationStateSchema>;
export type GenerationCandidateOutputMap = {
  readonly "writing-prompt": z.infer<typeof writingPromptCandidateSchema>;
  readonly "voice-activity-draft": z.infer<typeof voiceActivityDraftCandidateSchema>;
  readonly "writing-correction": z.infer<typeof writingCorrectionCandidateSchema>;
  readonly "contextual-help": z.infer<typeof contextualHelpCandidateSchema>;
  readonly "flashcard-generation": z.infer<typeof flashcardGenerationCandidateSchema>;
  readonly "exercise-generation": z.infer<typeof exerciseGenerationCandidateSchema>;
  readonly "exercise-feedback": z.infer<typeof exerciseFeedbackCandidateSchema>;
};
export type GenerationOutputMap = GenerationCandidateOutputMap;
export type GenerationOperationFor<Kind extends GenerationKind> = Omit<
  GenerationOperationStart,
  "input"
> & {
  readonly input: Extract<GenerationInput, { kind: Kind }>;
};
export type GenerationResult<Kind extends GenerationKind, Outputs extends GenerationOutputMap> = {
  readonly operationId: z.output<typeof correlationIdSchema>;
  readonly submissionId: z.output<typeof correlationIdSchema>;
  readonly kind: Kind;
  readonly modelRequestId: z.output<typeof modelRequestIdSchema>;
  readonly outputSchemaId: (typeof generationOutputSchemaIds)[Kind];
  readonly provenance: GenerationProvenance;
  readonly output: Outputs[Kind];
};

export type GenerationEvent = z.infer<typeof generationEventSchema>;
export const generationCapabilitiesSchema = z.strictObject({
  providerId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
  operations: z.array(generationKindSchema),
  structuredOutput: z.literal(true),
  cancellation: z.literal(true),
});
export type GenerationCapabilities = z.infer<typeof generationCapabilitiesSchema>;
export interface GenerationService<Outputs extends GenerationOutputMap = GenerationOutputMap> {
  readonly generationCapabilities: GenerationCapabilities;
  runOperation<Kind extends GenerationKind>(
    operation: GenerationOperationFor<Kind>,
  ): Promise<GenerationResult<Kind, Outputs>>;
  retryOperation<Kind extends GenerationKind>(options: {
    previousOperationId: z.output<typeof correlationIdSchema>;
    operationId: z.output<typeof correlationIdSchema>;
    submissionId: z.output<typeof correlationIdSchema>;
  }): Promise<GenerationResult<Kind, Outputs>>;
  cancelOperation(operationId: z.output<typeof correlationIdSchema>): Promise<void>;
  releaseOperation(operationId: z.output<typeof correlationIdSchema>): void;
  subscribeGeneration(listener: (event: GenerationEvent) => void): () => void;
}
export const generationDeadlineMilliseconds = Object.freeze({
  "writing-prompt": 60_000,
  "voice-activity-draft": 60_000,
  "writing-correction": 60_000,
  "contextual-help": 30_000,
  "flashcard-generation": 120_000,
  "exercise-generation": 120_000,
  "exercise-feedback": 60_000,
});
