import {
  attemptIdSchema,
  boundaryUnion,
  durationMillisecondsSchema,
  mistakeIdSchema,
  modelRequestIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  vocabularyIdSchema,
  z,
} from "@call-nina/contracts";
import {
  fillInTheBlankExerciseSchema,
  freeWritingExerciseSchema,
  learningObjectiveSchema,
  multipleChoiceExerciseSchema,
  sentenceCorrectionExerciseSchema,
  shortAnswerExerciseSchema,
  vocabularyRecallExerciseSchema,
} from "./exercise.js";

const text = (max: number) => z.string().min(1).max(max).regex(/\S/u);
const free = z.strictObject({ kind: z.literal("free-writing"), text: text(10_000) });
const short = z.strictObject({ kind: z.literal("short-answer"), text: text(12_000) });
const blanks = z.strictObject({
  kind: z.literal("fill-in-the-blank"),
  valuesByBlankPosition: z.array(text(500)).min(1).max(20),
});
const correction = z.strictObject({ kind: z.literal("sentence-correction"), text: text(12_000) });
const choice = z.strictObject({
  kind: z.literal("multiple-choice"),
  selectedOptionPosition: z.int().nonnegative().max(3),
});
const recall = z.strictObject({ kind: z.literal("vocabulary-recall"), text: text(12_000) });
export const exerciseAnswerSchema = z.discriminatedUnion("kind", [
  free,
  short,
  blanks,
  correction,
  choice,
  recall,
]);

const submitted = <Answer extends z.ZodType>(answer: Answer) =>
  z.strictObject({
    submittedAfterPreviousEventMilliseconds: durationMillisecondsSchema,
    answer,
  });
export const attemptInteractionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("free-writing"),
    exercise: freeWritingExerciseSchema,
    answers: z.array(submitted(free)).max(100),
  }),
  z.strictObject({
    kind: z.literal("short-answer"),
    exercise: shortAnswerExerciseSchema,
    answers: z.array(submitted(short)).max(100),
  }),
  z.strictObject({
    kind: z.literal("fill-in-the-blank"),
    exercise: fillInTheBlankExerciseSchema,
    answers: z.array(submitted(blanks)).max(100),
  }),
  z.strictObject({
    kind: z.literal("sentence-correction"),
    exercise: sentenceCorrectionExerciseSchema,
    answers: z.array(submitted(correction)).max(100),
  }),
  z.strictObject({
    kind: z.literal("multiple-choice"),
    exercise: multipleChoiceExerciseSchema,
    answers: z.array(submitted(choice)).max(100),
  }),
  z.strictObject({
    kind: z.literal("vocabulary-recall"),
    exercise: vocabularyRecallExerciseSchema,
    answers: z.array(submitted(recall)).max(100),
  }),
]);
export const feedbackUncertaintySchema = z.discriminatedUnion("level", [
  z.strictObject({ level: z.literal("none") }),
  z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(1_000) }),
]);
export const objectiveOutcomeSchema = z.enum([
  "demonstrated",
  "developing",
  "not-demonstrated",
  "not-evaluated",
]);
export const objectiveEvaluationSchema = z.strictObject({
  outcome: objectiveOutcomeSchema,
  evidence: text(1_000),
  uncertainty: feedbackUncertaintySchema,
});
const evaluatedObjectiveSchema = learningObjectiveSchema.extend({
  evaluation: objectiveEvaluationSchema,
});
const evaluatedObjectivesSchema = z.array(evaluatedObjectiveSchema).min(1).max(12);
const completedAttemptInteractionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("free-writing"),
    exercise: freeWritingExerciseSchema.extend({ objectives: evaluatedObjectivesSchema }),
    answers: z.array(submitted(free)).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("short-answer"),
    exercise: shortAnswerExerciseSchema.extend({ objectives: evaluatedObjectivesSchema }),
    answers: z.array(submitted(short)).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("fill-in-the-blank"),
    exercise: fillInTheBlankExerciseSchema.extend({ objectives: evaluatedObjectivesSchema }),
    answers: z.array(submitted(blanks)).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("sentence-correction"),
    exercise: sentenceCorrectionExerciseSchema.extend({ objectives: evaluatedObjectivesSchema }),
    answers: z.array(submitted(correction)).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("multiple-choice"),
    exercise: multipleChoiceExerciseSchema.extend({ objectives: evaluatedObjectivesSchema }),
    answers: z.array(submitted(choice)).min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("vocabulary-recall"),
    exercise: vocabularyRecallExerciseSchema.extend({ objectives: evaluatedObjectivesSchema }),
    answers: z.array(submitted(recall)).min(1).max(100),
  }),
]);
export const feedbackSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deterministic") }),
  z.strictObject({ kind: z.literal("ai"), modelRequestId: modelRequestIdSchema }),
]);
export const attemptFeedbackSchema = z.strictObject({
  source: feedbackSourceSchema,
  summary: text(4_000),
  strengths: z.array(text(1_000)).max(20),
  improvements: z.array(text(1_000)).max(20),
  nextStep: text(1_000).optional(),
  overallUncertainty: feedbackUncertaintySchema,
  mistakeIds: z.array(mistakeIdSchema).max(100),
  vocabularyCandidateIds: z.array(vocabularyIdSchema).max(100),
});
const identity = {
  schemaVersion: z.literal(1),
  attemptId: attemptIdSchema,
  startedAt: utcInstantSchema,
} as const;
export const inProgressAttemptSchema = strictBoundaryObject({
  ...identity,
  interaction: attemptInteractionSchema,
  status: z.literal("in-progress"),
  activeAfterPreviousEventMilliseconds: durationMillisecondsSchema,
});
export const completedAttemptSchema = strictBoundaryObject({
  ...identity,
  interaction: completedAttemptInteractionSchema,
  status: z.literal("completed"),
  completedAfterPreviousEventMilliseconds: durationMillisecondsSchema,
  feedback: attemptFeedbackSchema,
});
export const abandonedAttemptSchema = strictBoundaryObject({
  ...identity,
  interaction: attemptInteractionSchema,
  status: z.literal("abandoned"),
  abandonedAfterPreviousEventMilliseconds: durationMillisecondsSchema,
});
export const attemptSchema = boundaryUnion([
  inProgressAttemptSchema,
  completedAttemptSchema,
  abandonedAttemptSchema,
]);

export type ExerciseAnswer = z.infer<typeof exerciseAnswerSchema>;
export type AttemptInteraction = z.infer<typeof attemptInteractionSchema>;
export type FeedbackUncertainty = z.infer<typeof feedbackUncertaintySchema>;
export type ObjectiveEvaluation = z.infer<typeof objectiveEvaluationSchema>;
export type AttemptFeedback = z.infer<typeof attemptFeedbackSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
