import { attemptEvidenceSchema, externalAttemptFeedbackSchema } from "../attempt-evidence.js";
import {
  activityIdSchema,
  attemptIdSchema,
  calendarDateSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  historyEntryIdSchema,
  mistakeIdSchema,
  modelRequestIdSchema,
  utcInstantSchema,
} from "../common.js";
import { maximumExerciseHistoryPromptCharacters } from "../content-limits.js";
import { contentReferenceSchema } from "../content-reference.js";
import { generationProvenanceSchema } from "../generation-provenance.js";
import { generationCandidateOutputSchemas } from "../generation.js";
import { languageSchema } from "../learning-context.js";
import { z } from "../schema-system.js";
import { listeningResultSchema } from "../voice.js";
import { request, response, text } from "./envelope.js";
import { exerciseSessionAnswerSchema } from "./exercises.js";
import { placementResultShape } from "./learner.js";

export const historyActivityTypeSchema = z.enum([
  "writing",
  "grammar",
  "vocabulary-review",
  "reading",
  "codex-listening",
  "voice-speaking",
  "placement",
  "custom-lesson",
]);

export const historyReadRequest = request(
  "history/read",
  z.strictObject({
    historyEntryIds: z.array(historyEntryIdSchema).min(1).max(100).optional(),
    search: text(160).optional(),
    activityId: activityIdSchema.optional(),
    correctionId: correctionIdSchema.optional(),
    cursor: z
      .strictObject({ occurredAt: utcInstantSchema, historyEntryId: historyEntryIdSchema })
      .optional(),
    skill: z.enum(["writing", "reading", "listening", "speaking"]).optional(),
    activityType: historyActivityTypeSchema.optional(),
    fromDate: calendarDateSchema.optional(),
    toDate: calendarDateSchema.optional(),
    curriculumTopicId: curriculumTopicIdSchema.optional(),
    mistakeCategory: text(120).optional(),
    maximum: z.int().min(1).max(200).optional(),
  }),
);

export const historyDeleteRequest = request(
  "history/delete",
  z.strictObject({ historyEntryId: historyEntryIdSchema }),
);

export const historyMistakeAmendCategorySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("grammar"),
    categoryKey: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u),
    curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
  }),
  z.strictObject({
    kind: z.literal("vocabulary"),
    categoryKey: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u),
    lemma: text(160),
  }),
]);

export const historyMistakeAmendRequest = request(
  "history/mistake-amend",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    mistakeId: mistakeIdSchema,
    effectiveCategory: historyMistakeAmendCategorySchema,
    note: text(500).optional(),
  }),
);

export const historyDetailSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("reference") }),
  z.strictObject({
    kind: z.literal("attempt-feedback"),
    feedback: externalAttemptFeedbackSchema,
    later: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("exercise-attempt"),
    readingMaterial: generationCandidateOutputSchemas["exercise-generation"].shape.readingMaterial,
    activityId: activityIdSchema,
    translation: z
      .strictObject({
        content: contentReferenceSchema,
        position: z.int().min(0).max(29),
        attemptId: attemptIdSchema,
        fields: z.strictObject({
          summary: z.boolean(),
          strengths: z.array(z.int().min(0).max(19)).max(20),
          improvements: z.array(z.int().min(0).max(19)).max(20),
        }),
      })
      .optional(),
    answerLanguage: languageSchema.nullable(),
    exerciseKind: z.enum([
      "free-writing",
      "short-answer",
      "fill-in-the-blank",
      "sentence-correction",
      "multiple-choice",
      "vocabulary-recall",
    ]),
    instructions: text(4_000),
    prompt: text(maximumExerciseHistoryPromptCharacters),
    answer: exerciseSessionAnswerSchema,
    objectiveEvaluations: z
      .array(
        z.strictObject({
          outcome: z.enum(["demonstrated", "developing", "not-demonstrated", "not-evaluated"]),
          evidence: text(1_000),
        }),
      )
      .min(1)
      .max(12),
    feedback: z.strictObject({
      summary: text(4_000),
      strengths: z.array(text(1_000)).max(20),
      improvements: z.array(text(1_000)).max(20),
      nextStep: text(1_000).optional(),
    }),
    acceptedAnswerReveal: z.array(text(500)).max(20),
    feedbackProvenance: generationProvenanceSchema.nullable(),
    suggestedAnswer: text(12_000).nullable(),
  }),
  z.strictObject({
    kind: z.literal("writing-correction"),
    learnerText: text(10_000),
    correctedText: text(12_000),
    feedback: z.strictObject({
      summary: text(4_000),
      strengths: z.array(text(1_000)).max(20),
      improvements: z.array(text(1_000)).max(20),
      nextStep: text(1_000).optional(),
      overallUncertainty: z.discriminatedUnion("level", [
        z.strictObject({ level: z.literal("none") }),
        z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(1_000) }),
      ]),
    }),
    provenance: z.discriminatedUnion("availability", [
      z.strictObject({
        availability: z.literal("reported"),
        modelRequestId: modelRequestIdSchema,
        generatedAt: utcInstantSchema,
        modelId: text(128),
        effortId: text(128),
      }),
      z.strictObject({
        availability: z.literal("not-reported"),
        modelRequestId: modelRequestIdSchema,
        generatedAt: utcInstantSchema,
      }),
    ]),
    vocabularyCandidates: z
      .array(
        z.strictObject({
          lemma: text(160),
          meaning: text(500),
          sourceExcerpt: text(500),
          rationale: text(1_000),
          uncertainty: z.discriminatedUnion("level", [
            z.strictObject({ level: z.literal("none") }),
            z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(1_000) }),
          ]),
        }),
      )
      .max(50),
    changes: z.array(z.strictObject({ category: text(80), explanation: text(800) })).max(500),
  }),
  z.strictObject({ kind: z.literal("placement"), ...placementResultShape }),
  z.strictObject({ kind: z.literal("listening"), ...listeningResultSchema.shape }),
  z.strictObject({
    kind: z.literal("voice-summary"),
    scenario: z.strictObject({
      title: text(160),
      topic: text(500),
      targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
      speakingGoals: z.array(text(500)).min(1).max(12),
    }),
    duration: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("not-reported") }),
      z.strictObject({
        status: z.literal("known"),
        milliseconds: z.int().positive().max(Number.MAX_SAFE_INTEGER),
      }),
    ]),
    observedIssues: z
      .array(
        z.strictObject({
          category: z.enum([
            "pronunciation",
            "grammar",
            "vocabulary",
            "fluency",
            "comprehension",
            "register",
          ]),
          observation: text(500),
          evidenceSummary: text(500),
          feedback: text(800),
          uncertainty: z.discriminatedUnion("level", [
            z.strictObject({ level: z.literal("none") }),
            z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(1_000) }),
          ]),
        }),
      )
      .max(50),
    vocabulary: z
      .array(
        z.strictObject({
          lemma: text(160),
          meaning: text(500),
          contextSummary: text(500),
        }),
      )
      .max(50),
    feedback: z.strictObject({
      summary: text(1_000),
      strengths: z.array(text(500)).max(12),
      priorities: z.array(text(500)).max(12),
      uncertainty: z.discriminatedUnion("level", [
        z.strictObject({ level: z.literal("none") }),
        z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(1_000) }),
      ]),
    }),
    nextSteps: z
      .array(
        z.strictObject({
          title: text(160),
          rationale: text(500),
          naturalRequest: text(1_000),
        }),
      )
      .min(1)
      .max(12),
  }),
]);

export const historyMistakeCategorySchema = z.discriminatedUnion("kind", [
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
]);

export const historyMistakeOccurrenceSchema = z.strictObject({
  mistakeId: mistakeIdSchema,
  observedOn: calendarDateSchema,
  evidence: z.strictObject({
    beforeContext: z.string().max(500),
    evidenceText: text(1_000),
    afterContext: z.string().max(500),
  }),
  explanation: text(800),
  classificationSource: z.enum(["inferred", "learner-amended"]),
});

export const historyTargetedPracticeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-created") }),
  z.strictObject({
    status: z.literal("created"),
    activityId: activityIdSchema,
    createdAt: utcInstantSchema,
  }),
]);

export const historyMistakePatternSchema = z.discriminatedUnion("status", [
  z.strictObject({
    category: historyMistakeCategorySchema,
    status: z.literal("single-occurrence"),
    occurrenceCount: z.literal(1),
    classificationSource: z.enum(["inferred", "learner-amended"]),
    occurrences: z.array(historyMistakeOccurrenceSchema).length(1),
    targetedPractice: historyTargetedPracticeSchema,
  }),
  z.strictObject({
    category: historyMistakeCategorySchema,
    status: z.literal("recurring"),
    occurrenceCount: z.int().min(2).max(Number.MAX_SAFE_INTEGER),
    classificationSource: z.enum(["inferred", "learner-amended", "mixed"]),
    occurrences: z.array(historyMistakeOccurrenceSchema).min(2).max(100),
    targetedPractice: historyTargetedPracticeSchema,
  }),
]);

export const historyReadResponse = response(
  "history/read",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    nextCursor: z
      .strictObject({ occurredAt: utcInstantSchema, historyEntryId: historyEntryIdSchema })
      .nullable(),
    allTimeSkillTotals: z.strictObject({
      writing: z.int().nonnegative(),
      reading: z.int().nonnegative(),
      listening: z.int().nonnegative(),
      speaking: z.int().nonnegative(),
    }),
    mistakePatterns: z.array(historyMistakePatternSchema).max(50),
    entries: z
      .array(
        z.strictObject({
          historyEntryId: historyEntryIdSchema,
          targetLanguage: languageSchema,
          activityAvailable: z.boolean(),
          evidence: attemptEvidenceSchema.nullable(),
          entityKind: z.enum([
            "attempt",
            "correction",
            "vocabulary-review",
            "voice-summary",
            "placement",
          ]),
          skill: z.enum(["writing", "reading", "listening", "speaking"]),
          activityType: historyActivityTypeSchema,
          title: text(160),
          occurredAt: utcInstantSchema,
          curriculumTopicIds: z.array(curriculumTopicIdSchema).max(50),
          mistakeCategories: z.array(text(120)).max(50),
          detail: historyDetailSchema,
        }),
      )
      .max(200),
  }),
);

export const historyDeleteResponse = response(
  "history/delete",
  z.strictObject({ historyEntryId: historyEntryIdSchema, status: z.literal("deleted") }),
);

export const historyMistakeAmendResponse = response(
  "history/mistake-amend",
  z.strictObject({
    mistakeId: mistakeIdSchema,
    rootGeneration: dataRootGenerationSchema,
    status: z.literal("amended"),
  }),
);

export const historyRequests = [
  historyReadRequest,
  historyMistakeAmendRequest,
  historyDeleteRequest,
] as const;

export const historyResponses = [
  historyReadResponse,
  historyMistakeAmendResponse,
  historyDeleteResponse,
] as const;
