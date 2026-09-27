import { z } from "./schema-system.js";

export const identifierPrefixes = {
  learner: "learner",
  activity: "activity",
  exercise: "exercise",
  attempt: "attempt",
  correction: "correction",
  mistake: "mistake",
  vocabulary: "vocabulary",
  review: "review",
  voiceSession: "voice-session",
  curriculumTopic: "curriculum-topic",
  modelRequest: "model-request",
  historyEntry: "history-entry",
  run: "run",
  session: "session",
  correlation: "correlation",
} as const;

export type IdentifierKind = keyof typeof identifierPrefixes;

function opaqueIdentifier(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}_[0-9a-z]{16,64}$`, "u"));
}

export const learnerIdSchema = opaqueIdentifier(identifierPrefixes.learner).brand<"LearnerId">();
export const activityIdSchema = opaqueIdentifier(identifierPrefixes.activity).brand<"ActivityId">();
export const exerciseIdSchema = opaqueIdentifier(identifierPrefixes.exercise).brand<"ExerciseId">();
export const attemptIdSchema = opaqueIdentifier(identifierPrefixes.attempt).brand<"AttemptId">();
export const correctionIdSchema = opaqueIdentifier(
  identifierPrefixes.correction,
).brand<"CorrectionId">();
export const mistakeIdSchema = opaqueIdentifier(identifierPrefixes.mistake).brand<"MistakeId">();
export const vocabularyIdSchema = opaqueIdentifier(
  identifierPrefixes.vocabulary,
).brand<"VocabularyId">();
export const reviewIdSchema = opaqueIdentifier(identifierPrefixes.review).brand<"ReviewId">();
export const voiceSessionIdSchema = opaqueIdentifier(
  identifierPrefixes.voiceSession,
).brand<"VoiceSessionId">();
export const curriculumTopicIdSchema = opaqueIdentifier(
  identifierPrefixes.curriculumTopic,
).brand<"CurriculumTopicId">();
export const modelRequestIdSchema = opaqueIdentifier(
  identifierPrefixes.modelRequest,
).brand<"ModelRequestId">();
export const historyEntryIdSchema = opaqueIdentifier(
  identifierPrefixes.historyEntry,
).brand<"HistoryEntryId">();
export const runIdSchema = opaqueIdentifier(identifierPrefixes.run).brand<"RunId">();
export const sessionIdSchema = opaqueIdentifier(identifierPrefixes.session).brand<"SessionId">();
export const correlationIdSchema = opaqueIdentifier(
  identifierPrefixes.correlation,
).brand<"CorrelationId">();

export const identifierSchemas = {
  learner: learnerIdSchema,
  activity: activityIdSchema,
  exercise: exerciseIdSchema,
  attempt: attemptIdSchema,
  correction: correctionIdSchema,
  mistake: mistakeIdSchema,
  vocabulary: vocabularyIdSchema,
  review: reviewIdSchema,
  voiceSession: voiceSessionIdSchema,
  curriculumTopic: curriculumTopicIdSchema,
  modelRequest: modelRequestIdSchema,
  historyEntry: historyEntryIdSchema,
  run: runIdSchema,
  session: sessionIdSchema,
  correlation: correlationIdSchema,
} as const;

export type IdentifierFor<Kind extends IdentifierKind> = z.infer<(typeof identifierSchemas)[Kind]>;

export const dataRootGenerationSchema = z
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<"DataRootGeneration">();

export const utcInstantSchema = z.iso
  .datetime({ offset: false, precision: 3 })
  .brand<"UtcInstant">();
export const calendarDateSchema = z.iso.date().brand<"CalendarDate">();
export const durationMillisecondsSchema = z
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<"DurationMilliseconds">();

export type LearnerId = z.infer<typeof learnerIdSchema>;
export type ActivityId = z.infer<typeof activityIdSchema>;
export type ExerciseId = z.infer<typeof exerciseIdSchema>;
export type AttemptId = z.infer<typeof attemptIdSchema>;
export type CorrectionId = z.infer<typeof correctionIdSchema>;
export type MistakeId = z.infer<typeof mistakeIdSchema>;
export type VocabularyId = z.infer<typeof vocabularyIdSchema>;
export type ReviewId = z.infer<typeof reviewIdSchema>;
export type VoiceSessionId = z.infer<typeof voiceSessionIdSchema>;
export type CurriculumTopicId = z.infer<typeof curriculumTopicIdSchema>;
export type ModelRequestId = z.infer<typeof modelRequestIdSchema>;
export type HistoryEntryId = z.infer<typeof historyEntryIdSchema>;
export type RunId = z.infer<typeof runIdSchema>;
export type SessionId = z.infer<typeof sessionIdSchema>;
export type CorrelationId = z.infer<typeof correlationIdSchema>;
export type DataRootGeneration = z.infer<typeof dataRootGenerationSchema>;
export type UtcInstant = z.infer<typeof utcInstantSchema>;
export type CalendarDate = z.infer<typeof calendarDateSchema>;
export type DurationMilliseconds = z.infer<typeof durationMillisecondsSchema>;
