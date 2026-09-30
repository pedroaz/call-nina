import { createHash, randomUUID } from "node:crypto";

import {
  type AiConnection,
  type GenerationProvenance,
  correlationIdSchema,
  errorDefinitions,
  callNinaErrorSchema,
  utcInstantSchema,
  type writingCorrectionCandidateSchema,
  type DesktopIpcRequest,
  type ErrorKind,
  type GenerationService,
} from "@call-nina/contracts";
import { type VocabularyCandidate } from "@call-nina/domain";
import {
  type DataRootSelectionPlan,
  type HistoryEntryRecord,
  type CallNinaRepository,
} from "@call-nina/persistence";

export type PendingSelection = Readonly<{
  plan: DataRootSelectionPlan;
  expectedGeneration: number | null;
  mode: "initialize" | "recover" | "switch";
}>;

export type AcceptedOperation = Readonly<{
  validatedVoiceModelRequestId?: string;
  connection: AiConnection;
  operationId: string;
  inputFingerprint: string;
  attempt?: 1 | 2;
  dataRootGeneration: number;
  operation: Parameters<GenerationService["runOperation"]>[0];
  startedAt: string;
  helperSessionId?: string;
  exerciseFeedback?: Extract<
    Extract<DesktopIpcRequest, { channel: "learning-operation/start" }>["payload"]["input"],
    { kind: "exercise-feedback" }
  >;
}>;

export type ValidatedWritingState = Readonly<{
  provenance: GenerationProvenance;
  operationId: string;
  submissionId: string;
  modelRequestId: string;
  output: ReturnType<typeof writingCorrectionCandidateSchema.parse>;
}>;

export const maximumRetainedSubmissions = 256;

export function diagnosticErrorCode(error: unknown): string {
  return error instanceof Error && /^(?:OD|APP_SERVER)_[A-Z0-9_]{3,100}$/u.test(error.message)
    ? error.message
    : "OD_UNEXPECTED_FAILURE";
}

export function semanticAction(channel: DesktopIpcRequest["channel"]): string | undefined {
  return channel;
}

export function safeError(kind: ErrorKind, correlationId: string) {
  const definition = errorDefinitions[kind];
  return callNinaErrorSchema.parse({
    schemaVersion: 1,
    kind,
    code: definition.code,
    messageKey: definition.messageKey,
    reference: {
      code: definition.code,
      correlationId,
      occurredAt: new Date().toISOString(),
    },
  });
}

export function selectionId() {
  return correlationIdSchema.parse(`correlation_${randomUUID().replaceAll("-", "")}`);
}

export function opaqueId(
  prefix:
    | "learner"
    | "activity"
    | "attempt"
    | "correction"
    | "exercise"
    | "history-entry"
    | "amendment"
    | "mistake"
    | "plan"
    | "review"
    | "vocabulary",
) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function vocabularyProjection(
  record: Awaited<ReturnType<CallNinaRepository["listVocabularyRecords"]>>[number],
) {
  const { entry } = record;
  const state = entry.state;
  const schedule = state.status === "candidate" ? undefined : state.schedule;
  const lastReview =
    schedule?.status === "reviewed"
      ? { reviewedAt: schedule.lastReview.reviewedAt, grade: schedule.lastReview.grade }
      : null;
  return {
    schemaVersion: entry.schemaVersion,
    targetLanguage: entry.targetLanguage,
    vocabularyId: entry.vocabularyId,
    lemma: entry.lemma,
    meaning: entry.meaning,
    lexeme: entry.lexeme,
    examples: entry.examples,
    source: entry.source,
    state:
      state.status === "candidate"
        ? state
        : state.status === "active"
          ? {
              status: "active" as const,
              confirmedAt: state.confirmedAt,
              dueOn: state.schedule.dueOn,
              stage: state.schedule.stage,
              lastReview,
            }
          : {
              status: "suspended" as const,
              confirmedAt: state.confirmedAt,
              dueOn: state.schedule.dueOn,
              stage: state.schedule.stage,
              suspendedAt: state.suspendedAt,
              reason: state.reason,
              lastReview,
            },
    revision: record.revision,
    updatedAt: record.updatedAt,
  };
}

export function vocabularyCandidateFromRecord(
  record: Awaited<ReturnType<CallNinaRepository["listVocabularyRecords"]>>[number],
): VocabularyCandidate {
  const { entry } = record;
  return {
    lemma: entry.lemma,
    meaning: entry.meaning,
    lexeme: entry.lexeme,
    example: entry.examples[0]?.text ?? entry.lemma,
    sourceContext: entry.source.context,
    origin:
      entry.source.kind === "correction"
        ? "correction"
        : entry.source.kind === "activity"
          ? "exercise"
          : entry.source.kind === "curriculum"
            ? "curriculum"
            : "goal",
  };
}

export function operationInputFingerprint(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

export function freshTimestampAfter(previous: string) {
  const now = Date.now();
  const previousMilliseconds = Date.parse(previous);
  return utcInstantSchema.parse(new Date(Math.max(now, previousMilliseconds + 1)).toISOString());
}

export function exerciseHistoryPrompt(
  exercise: Extract<
    HistoryEntryRecord["detail"],
    { kind: "exercise-attempt" }
  >["snapshot"]["exercise"],
): string {
  if (exercise.kind === "free-writing") return exercise.content.prompt;
  if (exercise.kind === "short-answer") return exercise.content.question;
  if (exercise.kind === "fill-in-the-blank") {
    return `${exercise.content.leadingText}${exercise.content.blanks
      .map(({ followingText }) => `___${followingText}`)
      .join("")}`;
  }
  if (exercise.kind === "sentence-correction") return exercise.content.sentence;
  if (exercise.kind === "multiple-choice") return exercise.content.question;
  return exercise.content.cue;
}
