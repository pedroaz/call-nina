import {
  activityIdSchema,
  learningScopeSchema,
  courseEvidenceSchema,
  strictBoundaryObject,
  utcInstantSchema,
  voiceSessionIdSchema,
  z,
} from "@call-nina/contracts";

import { feedbackUncertaintySchema } from "./attempt.js";
import { cefrBandSchema } from "./learner-profile.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);

export const voiceSessionDurationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-reported") }),
  z.strictObject({
    status: z.literal("known"),
    milliseconds: z.int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
]);

export const voiceObservedIssueCategories = [
  "pronunciation",
  "grammar",
  "vocabulary",
  "fluency",
  "comprehension",
  "register",
] as const;
export const voiceObservedIssueCategorySchema = z.enum(voiceObservedIssueCategories);

export const voiceObservedIssueSchema = z.strictObject({
  category: voiceObservedIssueCategorySchema,
  observation: text(500),
  evidenceSummary: text(500),
  feedback: text(800),
  uncertainty: feedbackUncertaintySchema,
});

export const voiceVocabularyItemSchema = z.strictObject({
  lemma: text(160),
  meaning: text(500),
  contextSummary: text(500),
});

export const voiceSessionFeedbackSchema = z.strictObject({
  summary: text(1_000),
  strengths: z.array(text(500)).max(12),
  priorities: z.array(text(500)).max(12),
  uncertainty: feedbackUncertaintySchema,
});

export const voiceNextStepSchema = z.strictObject({
  title: text(160),
  rationale: text(500),
  naturalRequest: text(1_000),
});

export const voiceSummarySchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  learningScope: learningScopeSchema,
  activity: z
    .strictObject({
      activityId: activityIdSchema,
      outcome: z.enum(["completed", "partially-completed", "abandoned"]),
      objectiveResults: z.array(courseEvidenceSchema).min(1).max(20),
      facts: z.string().trim().min(1).max(4000).optional(),
    })
    .optional(),
  voiceSessionId: voiceSessionIdSchema,
  summarizedAt: utcInstantSchema,
  scenario: z.strictObject({
    title: text(160),
    topic: text(500),
    targetLevel: cefrBandSchema,
    speakingGoals: z.array(text(500)).min(1).max(12),
  }),
  duration: voiceSessionDurationSchema,
  observedIssues: z.array(voiceObservedIssueSchema).max(50),
  vocabulary: z.array(voiceVocabularyItemSchema).max(50),
  feedback: voiceSessionFeedbackSchema,
  nextSteps: z.array(voiceNextStepSchema).min(1).max(12),
});

export type VoiceObservedIssue = z.infer<typeof voiceObservedIssueSchema>;
export type VoiceVocabularyItem = z.infer<typeof voiceVocabularyItemSchema>;
export type VoiceSummary = z.infer<typeof voiceSummarySchema>;
