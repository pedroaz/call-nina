import {
  learningScopeSchema,
  explanationLanguageSchema,
  learningContextSchema,
} from "./learning-context.js";
import {
  externalAttemptFeedbackSchema,
  attemptEventIdSchema,
  attemptEvidenceSchema,
} from "./attempt-evidence.js";
import {
  courseReferenceSchema,
  courseTeachingContextSchema,
  courseEvidenceSchema,
} from "./learning-path.js";
import {
  activityIdSchema,
  attemptIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  historyEntryIdSchema,
  mistakeIdSchema,
  utcInstantSchema,
  vocabularyIdSchema,
  voiceSessionIdSchema,
} from "./common.js";
import { callNinaErrorSchema } from "./errors.js";
import { boundaryUnion, strictBoundaryObject, z } from "./schema-system.js";
import { listeningResultSchema, voiceActivityContextSchema } from "./voice.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const count = z.int().nonnegative().max(10_000);
const revisionSchema = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const mcpIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u)
  .brand<"McpIdempotencyKey">();

export const mcpToolNames = [
  "open_deutsch_read_learner_context",
  "open_deutsch_read_practice_context",
  "open_deutsch_read_curriculum_coverage",
  "open_deutsch_read_prepared_voice_activity",
  "open_deutsch_create_activity",
  "open_deutsch_save_attempt_feedback",
  "open_deutsch_save_listening_result",
  "open_deutsch_save_voice_summary",
] as const;
export const mcpToolNameSchema = z.enum(mcpToolNames);

export const mcpToolAnnotationSchema = strictBoundaryObject({
  readOnlyHint: z.boolean(),
  destructiveHint: z.boolean(),
  idempotentHint: z.boolean(),
  openWorldHint: z.boolean(),
});
export const mcpConfirmationPolicySchema = z.enum(["none", "preview-and-explicit-confirmation"]);

const generationInput = { dataRootGeneration: dataRootGenerationSchema };
const writeInput = { ...generationInput, idempotencyKey: mcpIdempotencyKeySchema };

export const learnerContextReadInputSchema = strictBoundaryObject({
  ...generationInput,
  sections: z
    .array(z.enum(["profile", "goals", "teaching-defaults"]))
    .min(1)
    .max(3),
});
const mcpLearningContextSchema = learningContextSchema.omit({ goal: true }).extend({
  goal: learningContextSchema.shape.goal.optional(),
});
const learnerContextDataSchema = z.strictObject({
  learningContext: mcpLearningContextSchema,
  approximateLevel: z.enum(["A1", "A2", "B1", "B2"]).optional(),
  teachingProfile: z.enum(["conversation-partner", "strict-corrector"]).optional(),
});

export const practiceContextReadInputSchema = strictBoundaryObject({
  ...generationInput,
  focus: z.enum(["recommendation", "mistakes", "vocabulary", "learning-path", "all"]),
  maximumItemsPerSection: z.int().min(1).max(20).default(5),
});
const practiceContextDataSchema = z.strictObject({
  recentAttempts: z.array(attemptEvidenceSchema).max(20),
  learningContext: mcpLearningContextSchema,
  learningPath: z
    .strictObject({ reference: courseReferenceSchema, title: text(300), objective: text(1000) })
    .nullable(),
  mistakes: z
    .array(
      z.strictObject({
        mistakeId: mistakeIdSchema,
        category: text(100),
        occurrenceCount: z.int().positive().max(10_000),
        summary: text(300),
      }),
    )
    .max(20),
  dueVocabulary: z
    .array(
      z.strictObject({
        vocabularyId: vocabularyIdSchema,
        lemma: text(160),
        dueOn: z.iso.date(),
      }),
    )
    .max(20),
  recommendation: z
    .strictObject({ primary: text(500), alternatives: z.array(text(300)).max(3) })
    .nullable(),
});

export const curriculumCoverageReadInputSchema = strictBoundaryObject({
  ...generationInput,
  band: z.enum(["A1", "A2", "B1", "B2"]).optional(),
  domain: text(100).optional(),
  includeLearnerRelevance: z.boolean().default(false),
});
export const preparedVoiceActivityReadInputSchema = strictBoundaryObject({
  ...generationInput,
  selector: boundaryUnion([
    strictBoundaryObject({ kind: z.literal("activity-id"), activityId: activityIdSchema }),
    strictBoundaryObject({
      kind: z.literal("latest"),
      activityKind: z.enum(["speaking", "listening"]),
    }),
  ]),
});
const preparedVoiceActivityDataSchema = z.strictObject({
  learningContext: mcpLearningContextSchema,
  activityId: activityIdSchema,
  title: text(160),
  preparedAt: utcInstantSchema,
  context: voiceActivityContextSchema,
  learningPath: courseReferenceSchema.optional(),
  courseTeaching: courseTeachingContextSchema.optional(),
  teachingDefaults: z.strictObject({
    explanationLanguage: explanationLanguageSchema,
    teachingProfile: z.enum(["conversation-partner", "strict-corrector"]),
  }),
});
const curriculumCoverageDataSchema = z.strictObject({
  matchingTopicCount: count,
  topicsWithLessonsCount: count,
  gaps: z
    .array(
      z.strictObject({
        topicId: curriculumTopicIdSchema,
        band: z.enum(["A1", "A2", "B1", "B2"]),
        domain: text(100),
        summary: text(500),
      }),
    )
    .max(100),
  nextGap: z
    .strictObject({
      topicId: curriculumTopicIdSchema,
      band: z.enum(["A1", "A2", "B1", "B2"]),
      domain: text(100),
      summary: text(500),
    })
    .nullable(),
});

const activityCreateFields = {
  learningScope: learningScopeSchema,
  title: text(160),
  instructions: text(2_000),
  curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
  naturalRequest: text(1_000).optional(),
};
export const activityCreateInputSchema = strictBoundaryObject({
  ...writeInput,
  activity: z.discriminatedUnion("kind", [
    z.strictObject({
      ...activityCreateFields,
      kind: z.enum(["writing", "grammar", "vocabulary", "reading", "placement"]),
      voiceContext: z.never().optional(),
    }),
    z.strictObject({
      ...activityCreateFields,
      kind: z.literal("listening"),
      voiceContext: voiceActivityContextSchema.extend({ kind: z.literal("listening") }),
    }),
    z.strictObject({
      ...activityCreateFields,
      kind: z.literal("speaking"),
      voiceContext: voiceActivityContextSchema.extend({ kind: z.literal("speaking") }),
    }),
  ]),
});
const activityCreateDataSchema = z.strictObject({
  activityId: activityIdSchema,
  destinationSurface: z.literal("practice"),
  persistence: z.literal("until-completed-or-deleted"),
  replayed: z.boolean(),
});

export const attemptFeedbackSaveInputSchema = strictBoundaryObject({
  ...writeInput,
  activityId: activityIdSchema,
  expectedActivityRevision: revisionSchema,
  targetAttemptId: attemptIdSchema.nullable(),
  feedback: externalAttemptFeedbackSchema,
});
const attemptFeedbackDataSchema = z.strictObject({
  eventId: attemptEventIdSchema,
  attemptId: attemptIdSchema,
  activityId: activityIdSchema,
  replayed: z.boolean(),
});

export const voiceSummarySaveInputSchema = strictBoundaryObject({
  learningScope: learningScopeSchema,
  ...writeInput,
  activity: z
    .strictObject({
      activityId: activityIdSchema,
      outcome: z.enum(["completed", "partially-completed", "abandoned"]),
      objectiveResults: z.array(courseEvidenceSchema).min(1).max(20),
      facts: z.string().trim().min(1).max(4000).optional(),
    })
    .optional(),
  summary: z.strictObject({
    scenario: text(300),
    topic: text(300),
    durationMilliseconds: z.int().positive().max(86_400_000).nullable(),
    observedIssues: z.array(text(500)).max(20),
    vocabularyNotes: z.array(text(500)).max(30),
    feedback: text(2_000),
    nextSteps: z.array(text(500)).max(10),
    occurredAt: utcInstantSchema,
  }),
});
export const listeningResultSaveInputSchema = strictBoundaryObject({
  ...writeInput,
  activityId: activityIdSchema,
  expectedActivityRevision: revisionSchema,
  result: listeningResultSchema,
  occurredAt: utcInstantSchema,
});
const listeningResultDataSchema = z.strictObject({
  attemptId: attemptIdSchema,
  activityId: activityIdSchema,
  historyEntryId: historyEntryIdSchema,
  replayed: z.boolean(),
});
const voiceSummaryDataSchema = z.strictObject({
  voiceSessionId: voiceSessionIdSchema,
  replayed: z.boolean(),
});

const successResult = <Data extends z.ZodType>(data: Data) =>
  strictBoundaryObject({ status: z.literal("ok"), summary: text(1_200), data });
const errorResult = strictBoundaryObject({
  status: z.literal("error"),
  summary: text(500),
  error: callNinaErrorSchema,
});
const toolResult = <Data extends z.ZodType>(data: Data) =>
  boundaryUnion([successResult(data), errorResult]);

export const learnerContextReadResultSchema = toolResult(learnerContextDataSchema);
export const practiceContextReadResultSchema = toolResult(practiceContextDataSchema);
export const curriculumCoverageReadResultSchema = toolResult(curriculumCoverageDataSchema);
export const preparedVoiceActivityReadResultSchema = toolResult(preparedVoiceActivityDataSchema);
export const activityCreateResultSchema = toolResult(activityCreateDataSchema);
export const attemptFeedbackSaveResultSchema = toolResult(attemptFeedbackDataSchema);
export const listeningResultSaveResultSchema = toolResult(listeningResultDataSchema);
export const voiceSummarySaveResultSchema = toolResult(voiceSummaryDataSchema);

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const additiveWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const mcpToolContracts = {
  open_deutsch_read_learner_context: {
    title: "Read learner context",
    description:
      "Read only the requested profile, goal, and teaching-default context from Call Nina.",
    annotations: readAnnotations,
    confirmationPolicy: "none",
    inputSchema: learnerContextReadInputSchema,
    resultSchema: learnerContextReadResultSchema,
  },
  open_deutsch_read_practice_context: {
    title: "Read practice context",
    description:
      "Read a bounded practice view containing the learning path, mistakes, due vocabulary, or recommendation.",
    annotations: readAnnotations,
    confirmationPolicy: "none",
    inputSchema: practiceContextReadInputSchema,
    resultSchema: practiceContextReadResultSchema,
  },
  open_deutsch_read_curriculum_coverage: {
    title: "Read curriculum coverage",
    description:
      "Read bounded A1–B2 curriculum coverage and gap metadata without private learner content by default.",
    annotations: readAnnotations,
    confirmationPolicy: "none",
    inputSchema: curriculumCoverageReadInputSchema,
    resultSchema: curriculumCoverageReadResultSchema,
  },
  open_deutsch_read_prepared_voice_activity: {
    title: "Read a prepared Voice activity",
    description:
      "Read one prepared Voice activity and its teaching defaults. Use the exact id when supplied; select latest only when the learner requests it. No prior learner or practice context read is needed.",
    annotations: readAnnotations,
    confirmationPolicy: "none",
    inputSchema: preparedVoiceActivityReadInputSchema,
    resultSchema: preparedVoiceActivityReadResultSchema,
  },
  open_deutsch_create_activity: {
    title: "Create a desktop activity",
    description:
      "Create one validated persistent learning activity in the Call Nina Practice library. Copy learningScope from the original learner/activity context; never infer it from the current interface language. Listening and speaking require matching structured voiceContext.",
    annotations: additiveWriteAnnotations,
    confirmationPolicy: "none",
    inputSchema: activityCreateInputSchema,
    resultSchema: activityCreateResultSchema,
  },
  open_deutsch_save_attempt_feedback: {
    title: "Save attempt feedback",
    description:
      "Save bounded activity participation (targetAttemptId null) or later feedback linked to an existing attempt, without replacing its answer or evaluation.",
    annotations: additiveWriteAnnotations,
    confirmationPolicy: "none",
    inputSchema: attemptFeedbackSaveInputSchema,
    resultSchema: attemptFeedbackSaveResultSchema,
  },
  open_deutsch_save_listening_result: {
    title: "Save listening result",
    description: "Save explicit structured listening evidence without audio or a full transcript.",
    annotations: additiveWriteAnnotations,
    confirmationPolicy: "none",
    inputSchema: listeningResultSaveInputSchema,
    resultSchema: listeningResultSaveResultSchema,
  },
  open_deutsch_save_voice_summary: {
    title: "Save a Voice summary",
    description:
      "Save one bounded structured Codex Voice session summary without audio or transcript content. Retain the learningScope read when this session began, including after a language switch.",
    annotations: additiveWriteAnnotations,
    confirmationPolicy: "none",
    inputSchema: voiceSummarySaveInputSchema,
    resultSchema: voiceSummarySaveResultSchema,
  },
} as const;

export type McpToolName = z.infer<typeof mcpToolNameSchema>;
export type McpIdempotencyKey = z.infer<typeof mcpIdempotencyKeySchema>;
export type McpToolContracts = typeof mcpToolContracts;
export type McpToolInput<Name extends McpToolName> = z.input<McpToolContracts[Name]["inputSchema"]>;
export type McpToolResult<Name extends McpToolName> = z.output<
  McpToolContracts[Name]["resultSchema"]
>;
