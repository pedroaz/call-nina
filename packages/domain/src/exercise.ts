import {
  activityIdSchema,
  boundaryUnion,
  curriculumTopicIdSchema,
  exerciseIdSchema,
  modelRequestIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
} from "@call-nina/contracts";

import { cefrBandSchema } from "./learner-profile.js";
import { runtimeEffortIdSchema, runtimeModelIdSchema } from "./model-preference.js";

function boundedNonblankString(maximumLength: number) {
  return z.string().min(1).max(maximumLength).regex(/\S/u);
}

const titleSchema = boundedNonblankString(160);
const instructionalTextSchema = boundedNonblankString(4_000);
const contentTextSchema = boundedNonblankString(12_000);
const shortTokenSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const feedbackModes = ["immediate"] as const;
export const feedbackModeSchema = z.enum(feedbackModes);

export const exerciseKinds = [
  "free-writing",
  "short-answer",
  "fill-in-the-blank",
  "sentence-correction",
  "multiple-choice",
  "vocabulary-recall",
] as const;
export const exerciseKindSchema = z.enum(exerciseKinds);

export const lessonKinds = ["custom", "curriculum-topic", "vocabulary-set"] as const;
export const lessonKindSchema = z.enum(lessonKinds);

const reportedModelSelectionSchema = z.strictObject({
  availability: z.literal("reported"),
  modelId: runtimeModelIdSchema,
  effortId: runtimeEffortIdSchema,
});

export const aiProvenanceSchema = z.discriminatedUnion("producer", [
  z.strictObject({
    source: z.literal("ai"),
    producer: z.literal("desktop-app-server"),
    modelRequestId: modelRequestIdSchema,
    generatedAt: utcInstantSchema,
    modelSelection: reportedModelSelectionSchema,
  }),
  z.strictObject({
    source: z.literal("ai"),
    producer: z.literal("codex-host"),
    modelRequestId: modelRequestIdSchema,
    generatedAt: utcInstantSchema,
    modelSelection: z.discriminatedUnion("availability", [
      reportedModelSelectionSchema,
      z.strictObject({ availability: z.literal("not-reported") }),
    ]),
  }),
]);

export const learningObjectiveSchema = z.strictObject({
  key: shortTokenSchema,
  description: boundedNonblankString(500),
});

export const hintSchema = z.strictObject({
  text: boundedNonblankString(1_000),
});

const acceptedAnswersSchema = z.array(boundedNonblankString(500)).min(1).max(20);
const multipleChoiceOptionSchema = z.strictObject({ label: boundedNonblankString(500) });

const fourOptionsSchema = z.tuple([
  multipleChoiceOptionSchema,
  multipleChoiceOptionSchema,
  multipleChoiceOptionSchema,
  multipleChoiceOptionSchema,
]);
const choiceContent = <const Position extends 0 | 1 | 2 | 3>(position: Position) =>
  z.strictObject({
    question: contentTextSchema,
    options: fourOptionsSchema,
    correctOptionPosition: z.literal(position),
  });
const multipleChoiceContentSchema = z.union([
  choiceContent(0),
  choiceContent(1),
  choiceContent(2),
  choiceContent(3),
]);

export const vocabularySetLinkSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("generated-activity"),
    activityId: activityIdSchema,
  }),
  z.strictObject({
    source: z.literal("curriculum"),
    setKey: shortTokenSchema,
  }),
]);

const sharedExerciseShape = {
  exerciseId: exerciseIdSchema,
  aiProvenance: aiProvenanceSchema,
  cefrBand: cefrBandSchema,
  objectives: z.array(learningObjectiveSchema).min(1).max(12),
  instructions: instructionalTextSchema,
  explanation: instructionalTextSchema.optional(),
  hints: z.array(hintSchema).max(5),
  feedbackMode: feedbackModeSchema,
  curriculumTopicIds: z.array(curriculumTopicIdSchema).max(20),
  vocabularySetLinks: z.array(vocabularySetLinkSchema).max(20),
} as const;

export const exerciseDefinitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...sharedExerciseShape,
    kind: z.literal("free-writing"),
    content: z.strictObject({ prompt: contentTextSchema }),
    answerContract: z.strictObject({
      kind: z.literal("free-text"),
      maximumCharacters: z.int().min(1).max(10_000),
      evaluation: z.literal("ai"),
    }),
  }),
  z.strictObject({
    ...sharedExerciseShape,
    kind: z.literal("short-answer"),
    content: z.strictObject({ question: contentTextSchema }),
    answerContract: z.strictObject({
      kind: z.literal("short-text"),
      acceptedAnswers: acceptedAnswersSchema,
      evaluation: z.literal("accepted-answer-or-ai"),
    }),
  }),
  z.strictObject({
    ...sharedExerciseShape,
    kind: z.literal("fill-in-the-blank"),
    content: z.strictObject({
      leadingText: z.string().max(4_000),
      blanks: z
        .array(
          z.strictObject({
            acceptedAnswers: acceptedAnswersSchema,
            followingText: z.string().max(4_000),
          }),
        )
        .min(1)
        .max(20),
    }),
    answerContract: z.strictObject({
      kind: z.literal("blank-values"),
      addressing: z.literal("zero-based-index"),
    }),
  }),
  z.strictObject({
    ...sharedExerciseShape,
    kind: z.literal("sentence-correction"),
    content: z.strictObject({ sentence: contentTextSchema }),
    answerContract: z.strictObject({
      kind: z.literal("corrected-sentence"),
      acceptedAnswers: acceptedAnswersSchema,
      evaluation: z.literal("accepted-answer"),
    }),
  }),
  z.strictObject({
    ...sharedExerciseShape,
    kind: z.literal("multiple-choice"),
    content: multipleChoiceContentSchema,
    answerContract: z.strictObject({
      kind: z.literal("single-option"),
      addressing: z.literal("zero-based-index"),
    }),
  }),
  z.strictObject({
    ...sharedExerciseShape,
    kind: z.literal("vocabulary-recall"),
    content: z.strictObject({
      cue: contentTextSchema,
      direction: z.enum(["recognition", "production"]),
    }),
    answerContract: z.strictObject({
      kind: z.literal("recalled-text"),
      acceptedAnswers: acceptedAnswersSchema,
    }),
  }),
]);

export const [
  freeWritingExerciseSchema,
  shortAnswerExerciseSchema,
  fillInTheBlankExerciseSchema,
  sentenceCorrectionExerciseSchema,
  multipleChoiceExerciseSchema,
  vocabularyRecallExerciseSchema,
] = exerciseDefinitionSchema.options;

const lessonReferenceShape = {
  curriculumTopicIds: z.array(curriculumTopicIdSchema).max(20),
  vocabularySetLinks: z.array(vocabularySetLinkSchema).max(20),
} as const;

export const lessonIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("custom"),
    naturalRequest: boundedNonblankString(2_000),
    ...lessonReferenceShape,
  }),
  z.strictObject({
    kind: z.literal("curriculum-topic"),
    curriculumTopicIds: z.array(curriculumTopicIdSchema).min(1).max(20),
    vocabularySetLinks: lessonReferenceShape.vocabularySetLinks,
  }),
  z.strictObject({
    kind: z.literal("vocabulary-set"),
    curriculumTopicIds: lessonReferenceShape.curriculumTopicIds,
    vocabularySetLinks: z.array(vocabularySetLinkSchema).min(1).max(20),
  }),
]);

export const lessonSectionSchema = z.strictObject({
  heading: titleSchema,
  content: contentTextSchema,
});

export const lessonDefinitionSchema = z.strictObject({
  activityId: activityIdSchema,
  intent: lessonIntentSchema,
  aiProvenance: aiProvenanceSchema,
  cefrBand: cefrBandSchema,
  title: titleSchema,
  objectives: z.array(learningObjectiveSchema).min(1).max(12),
  explanation: instructionalTextSchema,
  content: z.array(lessonSectionSchema).min(1).max(20),
  exercises: z.array(exerciseDefinitionSchema).min(1).max(30),
});

export const generatedExerciseSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  lifecycle: z.literal("generated"),
  exercise: exerciseDefinitionSchema,
});

export const startedExerciseSnapshotSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  lifecycle: z.literal("started"),
  startedAt: utcInstantSchema,
  exercise: exerciseDefinitionSchema,
});

export const exerciseArtifactSchema = boundaryUnion([
  generatedExerciseSchema,
  startedExerciseSnapshotSchema,
]);

export const generatedLessonSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  lifecycle: z.literal("generated"),
  lesson: lessonDefinitionSchema,
});

export const startedLessonSnapshotSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  lifecycle: z.literal("started"),
  startedAt: utcInstantSchema,
  lesson: lessonDefinitionSchema,
});

export const lessonArtifactSchema = boundaryUnion([
  generatedLessonSchema,
  startedLessonSnapshotSchema,
]);

export function defaultFeedbackModeForExerciseKind(): z.infer<typeof feedbackModeSchema> {
  return "immediate";
}

export type AiProvenance = z.infer<typeof aiProvenanceSchema>;
export type ExerciseKind = z.infer<typeof exerciseKindSchema>;
export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>;
export type ExerciseArtifact = z.infer<typeof exerciseArtifactSchema>;
export type StartedExerciseSnapshot = z.infer<typeof startedExerciseSnapshotSchema>;
export type LessonKind = z.infer<typeof lessonKindSchema>;
export type LessonDefinition = z.infer<typeof lessonDefinitionSchema>;
export type LessonArtifact = z.infer<typeof lessonArtifactSchema>;
export type StartedLessonSnapshot = z.infer<typeof startedLessonSnapshotSchema>;
