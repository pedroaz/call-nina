import {
  providerRouteIdSchema,
  providerOperationSchema,
  providerAccessSchema,
} from "./provider-access.js";
import { generationProvenanceSchema } from "./generation-provenance.js";
import { attemptEvidenceSchema, externalAttemptFeedbackSchema } from "./attempt-evidence.js";
import { materialReferenceSchema, materialSourceSchema } from "./material.js";
import { portableExerciseContentSchema } from "./content.js";
import { maximumExerciseHistoryPromptCharacters } from "./content-limits.js";
import { learningContextSchema, learningScopeSchema } from "./learning-context.js";
import { openActivityActionSchema, activityDestinationSchema } from "./activity-action.js";
import {
  flashcardCreateRequestSchema,
  flashcardReadRequestSchema,
  flashcardProgressRequestSchema,
  flashcardSaveRequestSchema,
  flashcardDeckSchema,
} from "./flashcards.js";
import {
  courseReferenceSchema,
  learningPathSnapshotSchema,
  learningPathUpdateSchema,
} from "./learning-path.js";
import {
  vocabularyLibraryFilterSchema,
  vocabularyVersionSchema,
  vocabularyBulkRequestSchema,
  vocabularySummarySchema,
  vocabularyCountsSchema,
} from "./vocabulary-library.js";
import {
  personalDataOverviewSchema,
  personalDataCleanupRequestSchema,
  personalDataCleanupResultSchema,
} from "./personal-data.js";
import { practiceSuggestionSchema } from "./practice-suggestion.js";
import {
  preparedActivitySchema,
  activityLibraryCursorSchema,
  activityLibraryFilterSchema,
  activityLibraryItemSchema,
} from "./activity.js";
import {
  activityIdSchema,
  attemptIdSchema,
  calendarDateSchema,
  correlationIdSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  historyEntryIdSchema,
  mistakeIdSchema,
  modelRequestIdSchema,
  utcInstantSchema,
  vocabularyIdSchema,
} from "./common.js";
import { callNinaErrorSchema } from "./errors.js";
import {
  accountStateSchema,
  modelCatalogSchema,
  rateLimitStateSchema,
} from "./app-server-state.js";
import { generationCandidateOutputSchemas } from "./generation.js";
import { boundaryUnion, strictBoundaryObject, z } from "./schema-system.js";
import { listeningResultSchema, voiceActivityContextSchema } from "./voice.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);

export const desktopIpcChannels = [
  "app/readiness",
  "provider/access/read",
  "data-root/read",
  "data-root/choose",
  "data-root/confirm",
  "privacy/ai-disclosure/read",
  "privacy/ai-disclosure/acknowledge",
  "placement/complete",
  "codex-activity/prepare",
  "learner-profile/read",
  "learner-profile/start-onboarding",
  "learner-profile/finish-onboarding",
  "learner-settings/read",
  "learner-settings/update",
  "development-notice/read",
  "development-notice/dismiss",
  "personal-data/read",
  "personal-data/clear",
  "diagnostics/read",
  "diagnostics/export",
  "logs/clear",
  "learning-path/read",
  "learning-path/update",
  "learning-path/vocabulary",
  "learning-path/prepare-voice",
  "dashboard/read",
  "activity/list",
  "activity/resolve",
  "flashcards/create",
  "flashcards/read",
  "flashcards/progress",
  "flashcards/save-vocabulary",
  "vocabulary/read",
  "vocabulary/detail",
  "vocabulary/review-queue",
  "vocabulary/bulk",
  "vocabulary-set/list",
  "vocabulary-set/create",
  "vocabulary/confirm",
  "vocabulary/review",
  "vocabulary/edit",
  "vocabulary/suspend",
  "vocabulary/resume",
  "vocabulary/delete",
  "prepared-activity/read",
  "voice-activity/read",
  "voice-activity/open-in-codex",
  "prepared-activity/delete",
  "exercise-set/support",
  "exercise-set/start",
  "exercise-set/complete",
  "exercise-set/abandon",
  "history/read",
  "history/mistake-amend",
  "history/delete",
  "codex/integration/read",
  "codex/integration/action",
  "codex/account/read",
  "codex/account/login/start",
  "codex/account/login/cancel",
  "codex/account/logout",
  "codex/models/read",
  "codex/rate-limits/read",
  "learning-operation/start",
  "learning-operation/retry",
  "learning-operation/cancel",
] as const;
export const desktopIpcChannelSchema = z.enum(desktopIpcChannels);

const emptyPayload = z.strictObject({});
const request = <
  const Channel extends (typeof desktopIpcChannels)[number],
  Payload extends z.ZodType,
>(
  channel: Channel,
  payload: Payload,
) =>
  strictBoundaryObject({
    channel: z.literal(channel),
    requestId: correlationIdSchema,
    payload,
  });

const providerAccessReadRequest = request(
  "provider/access/read",
  z.strictObject({
    routeId: providerRouteIdSchema,
    operation: providerOperationSchema,
    previousOperationId: correlationIdSchema.optional(),
  }),
);
const appReadinessRequest = request("app/readiness", emptyPayload);
const dataRootReadRequest = request("data-root/read", emptyPayload);
const dataRootChooseRequest = request(
  "data-root/choose",
  z.strictObject({ expectedGeneration: dataRootGenerationSchema.optional() }),
);
const dataRootConfirmRequest = request(
  "data-root/confirm",
  z.strictObject({ selectionId: correlationIdSchema }),
);
const privacyDisclosureReadRequest = request("privacy/ai-disclosure/read", emptyPayload);
const privacyDisclosureAcknowledgeRequest = request(
  "privacy/ai-disclosure/acknowledge",
  emptyPayload,
);
const learnerProfileReadRequest = request("learner-profile/read", emptyPayload);
const onboardingProfileInputSchema = z.strictObject({
  expectedGeneration: dataRootGenerationSchema,
  uiLocale: z.enum(["en", "de"]),
  approximateLevel: z.enum(["a1", "a2", "b1", "b2"]),
  everydayLifeGoal: text(500),
  defaultTeachingProfileId: z.enum(["conversation-partner", "strict-corrector"]),
  explanationLanguage: z.enum(["en", "de"]),
  placement: z.strictObject({ status: z.literal("skipped") }),
});
const learnerProfileStartOnboardingRequest = request(
  "learner-profile/start-onboarding",
  onboardingProfileInputSchema,
);
const learnerProfileFinishOnboardingRequest = request(
  "learner-profile/finish-onboarding",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    expectedUpdatedAt: utcInstantSchema,
  }),
);
const runtimeSelectionIdSchema = text(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const modelPreferenceSchema = z.strictObject({
  model: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("automatic") }),
    z.strictObject({ mode: z.literal("exact"), modelId: runtimeSelectionIdSchema }),
  ]),
  effort: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("semantic"), effort: z.enum(["fast", "balanced", "deep"]) }),
    z.strictObject({ mode: z.literal("exact"), effortId: runtimeSelectionIdSchema }),
  ]),
});
const persistedModelPreferencesSchema = z.strictObject({
  routeId: providerRouteIdSchema,
  schemaVersion: z.literal(1),
  correction: modelPreferenceSchema,
  generation: modelPreferenceSchema,
  helper: modelPreferenceSchema,
  research: modelPreferenceSchema,
});
const editableLearnerSettingsSchema = z.strictObject({
  approximateLevel: z.enum(["a1", "a2", "b1", "b2"]),
  everydayLifeGoal: text(500),
  defaultTeachingProfileId: z.enum(["conversation-partner", "strict-corrector"]),
  explanationLanguage: z.enum(["en", "de"]),
  uiLocale: z.enum(["en", "de"]),
  correctionPreferences: z.strictObject({
    timing: z.enum(["immediate", "end-of-activity", "adaptive"]),
    coverage: z.enum(["priority-only", "all-meaningful"]),
    showConciseExplanation: z.boolean(),
    showNaturalAlternative: z.boolean(),
  }),
  modelPreferences: persistedModelPreferencesSchema,
});
const learnerSettingsReadRequest = request("learner-settings/read", emptyPayload);
const learnerSettingsUpdateRequest = request(
  "learner-settings/update",
  z.strictObject({
    expectedUpdatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
    settings: editableLearnerSettingsSchema,
  }),
);
const placementUncertaintySchema = z.discriminatedUnion("level", [
  z.strictObject({ level: z.literal("none") }),
  z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(800) }),
]);
const placementResultShape = {
  schemaVersion: z.literal(1),
  completedOn: calendarDateSchema,
  estimatedLevel: z.null(),
  uncertainty: placementUncertaintySchema,
  sampleResults: z
    .array(
      z.strictObject({
        kind: z.enum(["grammar", "vocabulary", "reading", "writing"]),
        topic: text(160),
        outcome: z.enum(["demonstrated", "developing", "not-demonstrated", "not-assessed"]),
        evidence: text(800),
        uncertainty: placementUncertaintySchema,
      }),
    )
    .length(4),
  voiceCalibration: z.strictObject({
    status: z.literal("unavailable"),
    code: z.literal("OD_HANDOFF_VOICE_SESSION_UNSUPPORTED"),
    explanation: text(800),
  }),
};
export const placementResultSchema = strictBoundaryObject(placementResultShape);
export type PlacementResult = z.infer<typeof placementResultSchema>;
const placementCompleteRequest = request(
  "placement/complete",
  z.strictObject({ result: placementResultSchema }),
);
const codexActivityPrepareRequest = request(
  "codex-activity/prepare",
  z.strictObject({
    title: text(160),
    context: voiceActivityContextSchema,
  }),
);
const personalDataReadRequest = request("personal-data/read", emptyPayload);
const personalDataCleanupRequest = request("personal-data/clear", personalDataCleanupRequestSchema);
const diagnosticsReadRequest = request("diagnostics/read", emptyPayload);
const diagnosticsExportRequest = request("diagnostics/export", emptyPayload);
const logsClearRequest = request("logs/clear", emptyPayload);
const activityListRequest = request("activity/list", activityLibraryFilterSchema);
const activityResolveRequest = request("activity/resolve", openActivityActionSchema);
const dashboardReadRequest = request(
  "dashboard/read",
  z.strictObject({ locale: z.enum(["en", "de"]).optional() }),
);
const learningPathReadRequest = request("learning-path/read", emptyPayload);
const learningPathUpdateRequest = request("learning-path/update", learningPathUpdateSchema);
const learningPathVocabularyRequest = request(
  "learning-path/vocabulary",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    reference: courseReferenceSchema,
  }),
);
const learningPathPrepareVoiceRequest = request(
  "learning-path/prepare-voice",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    reference: courseReferenceSchema,
  }),
);
const vocabularyReadRequest = request("vocabulary/read", vocabularyLibraryFilterSchema);
const vocabularyDetailRequest = request(
  "vocabulary/detail",
  z.strictObject({ vocabularyId: vocabularyIdSchema, rootGeneration: dataRootGenerationSchema }),
);
const vocabularyQueueRequest = request(
  "vocabulary/review-queue",
  z.strictObject({ rootGeneration: dataRootGenerationSchema }),
);
const vocabularyBulkRequest = request("vocabulary/bulk", vocabularyBulkRequestSchema);
const vocabularySetListRequest = request(
  "vocabulary-set/list",
  z.strictObject({ rootGeneration: dataRootGenerationSchema }),
);
const vocabularySetCreateRequest = request(
  "vocabulary-set/create",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    title: text(160),
    naturalRequest: text(1_000),
    topic: text(160).optional(),
  }),
);
const vocabularyConfirmRequest = request(
  "vocabulary/confirm",
  z.strictObject({ vocabularyId: vocabularyIdSchema, dueOn: calendarDateSchema }),
);
const vocabularyReviewRequest = request(
  "vocabulary/review",
  vocabularyVersionSchema.extend({
    rootGeneration: dataRootGenerationSchema,
    grade: z.enum(["again", "hard", "good", "easy"]),
    retrieval: z.enum(["recognition", "recall", "use"]),
  }),
);
const vocabularyEditRequest = request(
  "vocabulary/edit",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    vocabularyId: vocabularyIdSchema,
    expectedRevision: z.int().nonnegative(),
    expectedUpdatedAt: utcInstantSchema,
    lemma: text(160),
    meaning: text(500),
    example: text(500),
    exampleMeaning: text(500),
  }),
);
const vocabularySuspendRequest = request(
  "vocabulary/suspend",
  z.strictObject({
    vocabularyId: vocabularyIdSchema,
    expectedRevision: z.int().nonnegative(),
    reason: z.enum(["learner-paused", "duplicate", "not-useful", "other"]),
  }),
);
const vocabularyResumeRequest = request(
  "vocabulary/resume",
  z.strictObject({ vocabularyId: vocabularyIdSchema, expectedRevision: z.int().nonnegative() }),
);
const vocabularyDeleteRequest = request(
  "vocabulary/delete",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    vocabularyId: vocabularyIdSchema,
  }),
);

const preparedActivityReadRequest = request(
  "prepared-activity/read",
  z.strictObject({ activityId: activityIdSchema }),
);
const voiceActivityReadRequest = request(
  "voice-activity/read",
  z.strictObject({ activityId: activityIdSchema }),
);
const voiceActivityOpenInCodexRequest = request(
  "voice-activity/open-in-codex",
  z.strictObject({ activityId: activityIdSchema }),
);
const preparedActivityDeleteRequest = request(
  "prepared-activity/delete",
  z.strictObject({ activityId: activityIdSchema }),
);
const exerciseSupportRequest = request(
  "exercise-set/support",
  z.strictObject({ activityId: activityIdSchema, attemptId: attemptIdSchema }),
);
const exerciseSetStartRequest = request(
  "exercise-set/start",
  z.strictObject({
    activityId: activityIdSchema,
  }),
);
const exerciseSessionAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("free-writing"), text: text(10_000) }),
  z.strictObject({ kind: z.literal("short-answer"), text: text(12_000) }),
  z.strictObject({
    kind: z.literal("fill-in-the-blank"),
    valuesByBlankPosition: z.array(text(500)).min(1).max(20),
  }),
  z.strictObject({ kind: z.literal("sentence-correction"), text: text(12_000) }),
  z.strictObject({
    kind: z.literal("multiple-choice"),
    selectedOptionPosition: z.int().min(0).max(3),
  }),
  z.strictObject({ kind: z.literal("vocabulary-recall"), text: text(12_000) }),
]);
const exerciseSetCompleteRequest = request(
  "exercise-set/complete",
  z.strictObject({
    activityId: activityIdSchema,
    answers: z
      .array(
        z.strictObject({
          attemptId: attemptIdSchema,
          answer: exerciseSessionAnswerSchema,
        }),
      )
      .min(1)
      .max(30),
  }),
);
const exerciseSetAbandonRequest = request(
  "exercise-set/abandon",
  z.strictObject({ activityId: activityIdSchema }),
);
const historyActivityTypeSchema = z.enum([
  "writing",
  "grammar",
  "vocabulary-review",
  "reading",
  "codex-listening",
  "voice-speaking",
  "placement",
  "custom-lesson",
]);
const historyReadRequest = request(
  "history/read",
  z.strictObject({
    historyEntryIds: z.array(historyEntryIdSchema).min(1).max(100).optional(),
    skill: z.enum(["writing", "reading", "listening", "speaking"]).optional(),
    activityType: historyActivityTypeSchema.optional(),
    fromDate: calendarDateSchema.optional(),
    toDate: calendarDateSchema.optional(),
    curriculumTopicId: curriculumTopicIdSchema.optional(),
    mistakeCategory: text(120).optional(),
    maximum: z.int().min(1).max(200).optional(),
  }),
);
const historyDeleteRequest = request(
  "history/delete",
  z.strictObject({ historyEntryId: historyEntryIdSchema }),
);
const historyMistakeAmendCategorySchema = z.discriminatedUnion("kind", [
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
const historyMistakeAmendRequest = request(
  "history/mistake-amend",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    mistakeId: mistakeIdSchema,
    effectiveCategory: historyMistakeAmendCategorySchema,
    note: text(500).optional(),
  }),
);
const integrationReadRequest = request("codex/integration/read", emptyPayload);
const integrationActionRequest = request(
  "codex/integration/action",
  z.strictObject({ action: z.enum(["install", "refresh", "uninstall"]) }),
);
const accountReadRequest = request("codex/account/read", emptyPayload);
const accountLoginRequest = request(
  "codex/account/login/start",
  z.strictObject({ method: z.enum(["browser", "device-code"]) }),
);
const accountLoginCancelRequest = request(
  "codex/account/login/cancel",
  z.strictObject({ loginId: correlationIdSchema }),
);
const accountLogoutRequest = request("codex/account/logout", emptyPayload);
const modelsReadRequest = request("codex/models/read", emptyPayload);
const rateLimitsReadRequest = request("codex/rate-limits/read", emptyPayload);

export const learningOperationKinds = [
  "writing-prompt",
  "voice-activity-draft",
  "writing-correction",
  "contextual-help",
  "flashcard-generation",
  "exercise-generation",
  "exercise-feedback",
] as const;
export const learningOperationKindSchema = z.enum(learningOperationKinds);

export const learningOperationInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("flashcard-generation"),
    topic: text(2_000),
    cardCount: z.int().min(3).max(30),
    targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
  }),
  z.strictObject({
    kind: z.literal("writing-prompt"),
    naturalRequest: text(1_000).optional(),
  }),
  z.strictObject({
    kind: z.literal("voice-activity-draft"),
    voiceKind: z.enum(["listening", "speaking"]),
    naturalRequest: text(2_000),
    targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
    difficulty: z.enum(["beginner", "intermediate", "advanced"]),
    correctionTiming: z.enum(["during", "after-each", "end"]),
    speakingPace: z.enum(["slow", "normal", "fast"]).optional(),
  }),
  z.strictObject({
    kind: z.literal("writing-correction"),
    learnerText: text(12_000),
    activityGoal: text(1_000).optional(),
    teachingProfile: z
      .enum(["profile-default", "conversation-partner", "strict-corrector"])
      .optional(),
    feedbackCoverage: z.enum(["all-meaningful", "priority-only"]).optional(),
  }),
  z.strictObject({
    kind: z.literal("contextual-help"),
    sessionId: correlationIdSchema,
    intent: z.enum(["chat", "translate"]),
    selectedText: text(4_000),
    containingSentence: text(4_000),
    question: text(1_000),
    activeResultSummary: text(2_000).optional(),
  }),
  z.strictObject({
    kind: z.literal("exercise-generation"),
    request: z.discriminatedUnion("source", [
      z.strictObject({
        source: z.literal("learning-path"),
        expectedGeneration: dataRootGenerationSchema,
        reference: courseReferenceSchema,
      }),
      z.strictObject({
        source: z.literal("suggestion"),
        suggestion: practiceSuggestionSchema,
      }),
      z.strictObject({
        source: z.literal("natural-request"),
        materialTitle: text(160).optional(),
        materialSource: materialSourceSchema.optional(),
        naturalRequest: text(2_000),
        exerciseCount: z.int().min(3).max(30).optional(),
        targetLevel: z.enum(["a1", "a2", "b1", "b2"]).optional(),
      }),
      z.strictObject({
        source: z.literal("grammar"),
        materialTitle: text(160).optional(),
        materialSource: materialSourceSchema.optional(),
        naturalRequest: text(2_000),
        exerciseCount: z.int().min(3).max(30).optional(),
        targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
      }),
      z.strictObject({
        source: z.literal("reading"),
        materialTitle: text(160).optional(),
        materialSource: materialSourceSchema.optional(),
        naturalRequest: text(2_000),
        passage: text(12_000).optional(),
        exerciseCount: z.int().min(3).max(30).optional(),
        targetLevel: z.enum(["a1", "a2", "b1", "b2"]).optional(),
      }),
      z.strictObject({
        source: z.literal("saved-material"),
        expectedGeneration: dataRootGenerationSchema,
        material: materialReferenceSchema,
        exerciseCount: z.int().min(3).max(30).optional(),
      }),
      z.strictObject({
        source: z.literal("prepared-activity"),
        activityId: activityIdSchema,
        exerciseCount: z.int().min(3).max(30).optional(),
      }),
      z.strictObject({
        source: z.literal("mistake-pattern"),
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
      }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("exercise-feedback"),
    activityId: activityIdSchema,
    attemptId: attemptIdSchema,
    answer: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("free-writing"), text: text(10_000) }),
      z.strictObject({ kind: z.literal("short-answer"), text: text(12_000) }),
      z.strictObject({ kind: z.literal("sentence-correction"), text: text(12_000) }),
    ]),
  }),
]);

const learningOperationStartRequest = request(
  "learning-operation/start",
  z.strictObject({
    routeId: providerRouteIdSchema,
    submissionId: correlationIdSchema,
    input: learningOperationInputSchema,
  }),
);
const learningOperationCancelRequest = request(
  "learning-operation/cancel",
  z.strictObject({ operationId: correlationIdSchema }),
);
const learningOperationRetryRequest = request(
  "learning-operation/retry",
  z.strictObject({
    routeId: providerRouteIdSchema,
    previousOperationId: correlationIdSchema,
    submissionId: correlationIdSchema,
  }),
);

export const desktopIpcRequestSchema = boundaryUnion([
  appReadinessRequest,
  providerAccessReadRequest,
  dataRootReadRequest,
  dataRootChooseRequest,
  dataRootConfirmRequest,
  privacyDisclosureReadRequest,
  privacyDisclosureAcknowledgeRequest,
  placementCompleteRequest,
  codexActivityPrepareRequest,
  learnerProfileReadRequest,
  learnerProfileStartOnboardingRequest,
  learnerProfileFinishOnboardingRequest,
  learnerSettingsReadRequest,
  learnerSettingsUpdateRequest,
  request("development-notice/read", emptyPayload),
  request("development-notice/dismiss", emptyPayload),
  personalDataReadRequest,
  personalDataCleanupRequest,
  diagnosticsReadRequest,
  diagnosticsExportRequest,
  logsClearRequest,
  activityListRequest,
  activityResolveRequest,
  learningPathReadRequest,
  learningPathUpdateRequest,
  learningPathVocabularyRequest,
  learningPathPrepareVoiceRequest,
  dashboardReadRequest,
  request("flashcards/create", flashcardCreateRequestSchema),
  request("flashcards/read", flashcardReadRequestSchema),
  request("flashcards/progress", flashcardProgressRequestSchema),
  request("flashcards/save-vocabulary", flashcardSaveRequestSchema),
  vocabularyReadRequest,
  vocabularyDetailRequest,
  vocabularyQueueRequest,
  vocabularyBulkRequest,
  vocabularySetListRequest,
  vocabularySetCreateRequest,
  vocabularyConfirmRequest,
  vocabularyReviewRequest,
  vocabularyEditRequest,
  vocabularySuspendRequest,
  vocabularyResumeRequest,
  vocabularyDeleteRequest,
  preparedActivityReadRequest,
  voiceActivityReadRequest,
  voiceActivityOpenInCodexRequest,
  preparedActivityDeleteRequest,
  exerciseSupportRequest,
  exerciseSetStartRequest,
  exerciseSetCompleteRequest,
  exerciseSetAbandonRequest,
  historyReadRequest,
  historyMistakeAmendRequest,
  historyDeleteRequest,
  integrationReadRequest,
  integrationActionRequest,
  accountReadRequest,
  accountLoginRequest,
  accountLoginCancelRequest,
  accountLogoutRequest,
  modelsReadRequest,
  rateLimitsReadRequest,
  learningOperationStartRequest,
  learningOperationRetryRequest,
  learningOperationCancelRequest,
]);

export const dataRootStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unconfigured") }),
  z.strictObject({
    status: z.literal("ready"),
    generation: dataRootGenerationSchema,
    displayName: text(32768),
    warnings: z
      .array(
        z.enum([
          "git-worktree",
          "broad-permissions",
          "install-directory",
          "integration-restart-required",
        ]),
      )
      .max(4),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum([
      "missing",
      "invalid",
      "stale",
      "schema-newer",
      "database-busy",
      "database-failed",
    ]),
    error: callNinaErrorSchema,
  }),
]);

export const codexIntegrationStateSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["missing", "unsupported-version", "app-server-unavailable"]),
    error: callNinaErrorSchema,
  }),
  z.strictObject({
    status: z.literal("available"),
    codexVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
    plugin: z.enum(["not-installed", "installed", "refresh-required"]),
  }),
]);

const response = <
  const Channel extends (typeof desktopIpcChannels)[number],
  Result extends z.ZodType,
>(
  channel: Channel,
  result: Result,
) =>
  strictBoundaryObject({
    status: z.literal("ok"),
    channel: z.literal(channel),
    requestId: correlationIdSchema,
    result,
  });

const providerAccessReadResponse = response("provider/access/read", providerAccessSchema);
const appReadinessResponse = response(
  "app/readiness",
  z.strictObject({
    status: z.enum(["ready", "degraded"]),
    dataRoot: dataRootStateSchema,
    codex: codexIntegrationStateSchema,
  }),
);
const dataRootReadResponse = response("data-root/read", dataRootStateSchema);
const dataRootChooseResponse = response(
  "data-root/choose",
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("cancelled") }),
    z.strictObject({
      status: z.literal("selected"),
      selectionId: correlationIdSchema,
      generation: dataRootGenerationSchema,
      displayName: text(32768),
      warnings: z
        .array(
          z.enum([
            "git-worktree",
            "broad-permissions",
            "install-directory",
            "integration-restart-required",
          ]),
        )
        .max(4),
    }),
  ]),
);
const dataRootConfirmResponse = response("data-root/confirm", dataRootStateSchema);
const privacyDisclosureReadResponse = response(
  "privacy/ai-disclosure/read",
  z.strictObject({ acknowledged: z.boolean() }),
);
const privacyDisclosureAcknowledgeResponse = response(
  "privacy/ai-disclosure/acknowledge",
  z.strictObject({ acknowledged: z.literal(true) }),
);
const learnerProfileSummarySchema = z.strictObject({
  learningContext: learningContextSchema,
  onboardingState: z.enum(["not-started", "in-progress", "complete"]),
  approximateLevel: z.enum(["a1", "a2", "b1", "b2"]),
  everydayLifeGoal: text(500),
  defaultTeachingProfileId: z.enum(["conversation-partner", "strict-corrector"]),
  explanationLanguage: z.enum(["en", "de"]),
  uiLocale: z.enum(["en", "de"]),
  placement: z.strictObject({ status: z.enum(["skipped", "completed"]) }),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
});
const learnerProfileReadResponse = response(
  "learner-profile/read",
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("not-created") }),
    z.strictObject({ status: z.literal("ready"), profile: learnerProfileSummarySchema }),
  ]),
);
const learnerProfileStartOnboardingResponse = response(
  "learner-profile/start-onboarding",
  z.strictObject({ status: z.literal("ready"), profile: learnerProfileSummarySchema }),
);
const learnerProfileFinishOnboardingResponse = response(
  "learner-profile/finish-onboarding",
  z.strictObject({ status: z.literal("ready"), profile: learnerProfileSummarySchema }),
);
const placementCompleteResponse = response(
  "placement/complete",
  z.strictObject({
    status: z.literal("completed"),
    historyEntryId: historyEntryIdSchema,
    profile: learnerProfileSummarySchema,
  }),
);
const codexActivityPrepareResponse = response(
  "codex-activity/prepare",
  z.strictObject({
    status: z.literal("prepared"),
    activityId: activityIdSchema,
  }),
);
const learnerSettingsProjectionSchema = z.strictObject({
  dataRoot: z.strictObject({
    generation: dataRootGenerationSchema,
    displayName: text(32768),
  }),
  settings: editableLearnerSettingsSchema,
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
});
const learnerSettingsReadResponse = response(
  "learner-settings/read",
  learnerSettingsProjectionSchema,
);
const learnerSettingsUpdateResponse = response(
  "learner-settings/update",
  learnerSettingsProjectionSchema,
);
const developmentNoticeReadResponse = response(
  "development-notice/read",
  z.strictObject({ pending: z.boolean() }),
);
const developmentNoticeDismissResponse = response(
  "development-notice/dismiss",
  z.strictObject({ dismissed: z.literal(true) }),
);
const personalDataReadResponse = response("personal-data/read", personalDataOverviewSchema);
const personalDataCleanupResponse = response(
  "personal-data/clear",
  personalDataCleanupResultSchema,
);
const diagnosticsReadResponse = response(
  "diagnostics/read",
  z.strictObject({
    dataRootGeneration: dataRootGenerationSchema,
    dataRootFormatVersion: z.literal(1),
    databaseSchemaVersion: z.int().positive().max(10_000),
    journalMode: z.literal("wal"),
    foreignKeysEnabled: z.literal(true),
    logFileCount: z.int().nonnegative().max(1_000),
    recentLogs: z.record(z.string(), z.array(z.string().min(1).max(1_000)).max(200)),
  }),
);
const diagnosticsExportResponse = response(
  "diagnostics/export",
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("cancelled") }),
    z.strictObject({ status: z.literal("exported"), displayName: text(200) }),
  ]),
);
const logsClearResponse = response(
  "logs/clear",
  z.strictObject({ clearedFileCount: z.int().nonnegative().max(1_000) }),
);
const activityListResponse = response(
  "activity/list",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    entries: z.array(activityLibraryItemSchema).max(50),
    nextCursor: activityLibraryCursorSchema.nullable(),
  }),
);
const activityResolveResponse = response(
  "activity/resolve",
  z.strictObject({
    activity: preparedActivitySchema,
    rootGeneration: dataRootGenerationSchema,
    destination: activityDestinationSchema,
    deletionStatus: z.enum(["available", "cascade", "retained-data"]),
  }),
);
const learningPathReadResponse = response("learning-path/read", learningPathSnapshotSchema);
const learningPathUpdateResponse = response("learning-path/update", learningPathSnapshotSchema);
const learningPathVocabularyResponse = response(
  "learning-path/vocabulary",
  z.strictObject({ added: z.int().nonnegative() }),
);
const learningPathPrepareVoiceResponse = response(
  "learning-path/prepare-voice",
  z.strictObject({ activityId: activityIdSchema }),
);
const dashboardReadResponse = response(
  "dashboard/read",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    refreshedAt: utcInstantSchema,
    suggestions: z.array(practiceSuggestionSchema).max(24),
    preparedActivities: z
      .array(
        z.strictObject({
          activityId: activityIdSchema,
          activityType: z.enum([
            "writing",
            "grammar",
            "vocabulary-review",
            "reading",
            "codex-listening",
            "voice-speaking",
            "placement",
            "custom-lesson",
            "flashcards",
          ]),
          title: text(160),
          originSurface: z.enum(["desktop", "codex"]),
          preparedAt: utcInstantSchema,
          deletionStatus: z.enum(["available", "cascade", "retained-data"]),
        }),
      )
      .max(20),
    dueVocabulary: z
      .array(
        z.strictObject({
          vocabularyId: vocabularyIdSchema,
          lemma: text(160),
          meaning: text(500),
          dueOn: calendarDateSchema,
          stage: z.int().min(1).max(12),
        }),
      )
      .max(20),
    recentCorrections: z
      .array(
        z.strictObject({
          correctionId: correctionIdSchema,
          createdAt: utcInstantSchema,
          changedSegmentCount: z.int().min(0).max(500),
        }),
      )
      .max(10),
    recurringMistakes: z
      .array(
        z.strictObject({
          mistakeId: mistakeIdSchema,
          category: z.discriminatedUnion("kind", [
            z.strictObject({ kind: z.literal("grammar"), categoryKey: text(120) }),
            z.strictObject({
              kind: z.literal("vocabulary"),
              categoryKey: text(120),
              lemma: text(160),
            }),
          ]),
          occurrenceCount: z.int().min(2).max(100),
          lastObservedOn: calendarDateSchema,
        }),
      )
      .max(10),
  }),
);
const vocabularyProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  vocabularyId: vocabularyIdSchema,
  lemma: text(160),
  meaning: text(500),
  lexeme: z.discriminatedUnion("partOfSpeech", [
    z.strictObject({
      partOfSpeech: z.literal("noun"),
      nounForm: z.strictObject({
        gender: z.enum(["masculine", "feminine", "neuter"]),
        article: z.enum(["der", "die", "das"]),
      }),
      plural: z.discriminatedUnion("status", [
        z.strictObject({ status: z.literal("form"), form: text(160) }),
        z.strictObject({ status: z.literal("unchanged") }),
        z.strictObject({ status: z.literal("not-applicable") }),
        z.strictObject({ status: z.literal("unknown") }),
      ]),
    }),
    z.strictObject({ partOfSpeech: z.literal("verb"), pattern: text(160).optional() }),
    z.strictObject({
      partOfSpeech: z.literal("phrase"),
      function: text(160).optional(),
      register: z.enum(["informal", "formal", "neutral"]).optional(),
    }),
    ...(["adjective", "adverb", "other"] as const).map((partOfSpeech) =>
      z.strictObject({ partOfSpeech: z.literal(partOfSpeech) }),
    ),
  ]),
  examples: z
    .array(z.strictObject({ german: text(500), meaning: text(500) }))
    .min(1)
    .max(12),
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("correction"),
      correctionId: correctionIdSchema,
      attemptId: attemptIdSchema,
      context: text(500),
    }),
    z.strictObject({
      kind: z.literal("activity"),
      activityId: activityIdSchema,
      context: text(500),
    }),
    z.strictObject({
      kind: z.literal("curriculum"),
      curriculumTopicId: curriculumTopicIdSchema,
      context: text(500),
    }),
    z.strictObject({ kind: z.literal("learner"), context: text(500) }),
  ]),
  state: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("candidate"), confirmation: z.literal("required") }),
    z.strictObject({
      status: z.literal("active"),
      confirmedAt: utcInstantSchema,
      dueOn: calendarDateSchema,
      stage: z.int().min(1).max(5),
      lastReview: z
        .strictObject({
          reviewedAt: utcInstantSchema,
          grade: z.enum(["again", "hard", "good", "easy"]),
        })
        .nullable(),
    }),
    z.strictObject({
      status: z.literal("suspended"),
      confirmedAt: utcInstantSchema,
      dueOn: calendarDateSchema,
      stage: z.int().min(1).max(5),
      suspendedAt: utcInstantSchema,
      reason: z.enum(["learner-paused", "duplicate", "not-useful", "other"]),
      lastReview: z
        .strictObject({
          reviewedAt: utcInstantSchema,
          grade: z.enum(["again", "hard", "good", "easy"]),
        })
        .nullable(),
    }),
  ]),
  revision: z.int().nonnegative(),
  updatedAt: utcInstantSchema,
});
const vocabularyReadResponse = response(
  "vocabulary/read",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    entries: z.array(vocabularySummarySchema).max(30),
    total: z.int().nonnegative(),
    page: z.int().nonnegative(),
    counts: vocabularyCountsSchema,
  }),
);
const vocabularyDetailResponse = response(
  "vocabulary/detail",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    entry: vocabularyProjectionSchema,
  }),
);
const vocabularyQueueResponse = response(
  "vocabulary/review-queue",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    entries: z
      .array(
        vocabularyProjectionSchema.extend({
          retrievalSchedules: z
            .array(
              z.strictObject({
                retrieval: z.enum(["recognition", "recall", "use"]),
                dueOn: calendarDateSchema,
              }),
            )
            .length(3),
        }),
      )
      .max(20),
  }),
);
const vocabularyBulkResponse = response(
  "vocabulary/bulk",
  z.strictObject({ status: z.literal("updated") }),
);
const vocabularySetListResponse = response(
  "vocabulary-set/list",
  z.strictObject({
    entries: z
      .array(
        z.strictObject({
          setId: activityIdSchema,
          title: text(160),
          candidateCount: z.int().nonnegative().max(50),
        }),
      )
      .max(50),
  }),
);
const vocabularySetCreateResponse = response(
  "vocabulary-set/create",
  z.strictObject({
    setId: activityIdSchema,
    status: z.literal("created"),
    candidateCount: z.int().min(1).max(50),
  }),
);
const vocabularyMutationResponse = (
  channel:
    | "vocabulary/confirm"
    | "vocabulary/review"
    | "vocabulary/edit"
    | "vocabulary/suspend"
    | "vocabulary/resume"
    | "vocabulary/delete",
) =>
  response(
    channel,
    z.strictObject({ vocabularyId: vocabularyIdSchema, status: z.literal("updated") }),
  );
const vocabularyConfirmResponse = vocabularyMutationResponse("vocabulary/confirm");
const vocabularyReviewResponse = response(
  "vocabulary/review",
  z.strictObject({
    vocabularyId: vocabularyIdSchema,
    status: z.literal("updated"),
    dueOn: calendarDateSchema,
  }),
);
const vocabularyEditResponse = vocabularyMutationResponse("vocabulary/edit");
const vocabularySuspendResponse = vocabularyMutationResponse("vocabulary/suspend");
const vocabularyResumeResponse = vocabularyMutationResponse("vocabulary/resume");
const vocabularyDeleteResponse = vocabularyMutationResponse("vocabulary/delete");

const generatedActivityProvenanceSchema = z.strictObject({
  modelRequestId: modelRequestIdSchema,
  generatedAt: utcInstantSchema,
  modelId: text(128),
  effortId: text(128),
});
const preparedActivityReadResponse = response(
  "prepared-activity/read",
  z.strictObject({
    learningScope: learningScopeSchema,
    activityId: activityIdSchema,
    title: text(160),
    curriculumTopicIds: z.array(curriculumTopicIdSchema).max(20),
    deletionStatus: z.enum(["available", "cascade", "retained-data"]),
    activeSet: z
      .strictObject({
        startedAt: utcInstantSchema,
        attemptIds: z.array(attemptIdSchema).min(1).max(30),
      })
      .nullable()
      .default(null),
    missionFacts: text(4000).optional(),
    provenance: generatedActivityProvenanceSchema,
    content: portableExerciseContentSchema,
  }),
);
const voiceActivityReadResponse = response(
  "voice-activity/read",
  z.strictObject({
    activityId: activityIdSchema,
    title: text(160),
    originSurface: z.enum(["desktop", "codex"]),
    preparedAt: utcInstantSchema,
    deletionStatus: z.enum(["available", "cascade", "retained-data"]),
    context: voiceActivityContextSchema,
  }),
);
const preparedActivityDeleteResponse = response(
  "prepared-activity/delete",
  z.strictObject({ activityId: activityIdSchema, status: z.literal("deleted") }),
);
const voiceActivityOpenInCodexResponse = response(
  "voice-activity/open-in-codex",
  z.strictObject({ status: z.enum(["open-requested", "setup-required"]) }),
);
const exerciseSupportResponse = response(
  "exercise-set/support",
  z.strictObject({ recorded: z.literal(true) }),
);
const exerciseSetStartResponse = response(
  "exercise-set/start",
  z.strictObject({
    activityId: activityIdSchema,
    status: z.literal("started"),
    startedAt: utcInstantSchema,
    attemptIds: z.array(attemptIdSchema).min(1).max(30),
  }),
);
const exerciseSetCompleteResponse = response(
  "exercise-set/complete",
  z.strictObject({
    activityId: activityIdSchema,
    status: z.literal("completed"),
    completedAt: utcInstantSchema,
  }),
);
const exerciseSetAbandonResponse = response(
  "exercise-set/abandon",
  z.strictObject({
    activityId: activityIdSchema,
    status: z.literal("abandoned"),
    abandonedAt: utcInstantSchema,
  }),
);
const historyDetailSchema = z.discriminatedUnion("kind", [
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
const historyMistakeCategorySchema = z.discriminatedUnion("kind", [
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
const historyMistakeOccurrenceSchema = z.strictObject({
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
const historyTargetedPracticeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-created") }),
  z.strictObject({
    status: z.literal("created"),
    activityId: activityIdSchema,
    createdAt: utcInstantSchema,
  }),
]);
const historyMistakePatternSchema = z.discriminatedUnion("status", [
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
const historyReadResponse = response(
  "history/read",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
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
const historyDeleteResponse = response(
  "history/delete",
  z.strictObject({ historyEntryId: historyEntryIdSchema, status: z.literal("deleted") }),
);
const historyMistakeAmendResponse = response(
  "history/mistake-amend",
  z.strictObject({
    mistakeId: mistakeIdSchema,
    rootGeneration: dataRootGenerationSchema,
    status: z.literal("amended"),
  }),
);
const integrationReadResponse = response("codex/integration/read", codexIntegrationStateSchema);
const integrationActionResponse = response(
  "codex/integration/action",
  z.strictObject({
    action: z.enum(["install", "refresh", "uninstall"]),
    result: z.enum(["verified", "missing", "failed"]),
    sourceVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    status: codexIntegrationStateSchema,
    steps: z.array(text(240)).min(1).max(8),
  }),
);
const accountReadResponse = response("codex/account/read", accountStateSchema);
const accountLoginResponse = response(
  "codex/account/login/start",
  z.strictObject({ loginId: correlationIdSchema, status: z.literal("started") }),
);
const accountLoginCancelResponse = response(
  "codex/account/login/cancel",
  z.strictObject({
    loginId: correlationIdSchema,
    status: z.enum(["cancelled", "already-finished"]),
  }),
);
const accountLogoutResponse = response(
  "codex/account/logout",
  z.strictObject({ status: z.literal("signed-out") }),
);
const modelsReadResponse = response("codex/models/read", modelCatalogSchema);
const rateLimitsReadResponse = response("codex/rate-limits/read", rateLimitStateSchema);
const learningOperationStartResponse = response(
  "learning-operation/start",
  z.strictObject({
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    status: z.literal("accepted"),
    submission: z.literal("retained"),
  }),
);
const learningOperationCancelResponse = response(
  "learning-operation/cancel",
  z.strictObject({
    operationId: correlationIdSchema,
    status: z.enum(["cancelling", "already-finished"]),
  }),
);
const learningOperationRetryResponse = response(
  "learning-operation/retry",
  z.strictObject({
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    status: z.literal("accepted"),
    submission: z.literal("retained"),
  }),
);
const errorResponse = strictBoundaryObject({
  status: z.literal("error"),
  channel: desktopIpcChannelSchema,
  requestId: correlationIdSchema,
  error: callNinaErrorSchema,
});

export const desktopIpcResponseSchema = boundaryUnion([
  appReadinessResponse,
  providerAccessReadResponse,
  dataRootReadResponse,
  dataRootChooseResponse,
  dataRootConfirmResponse,
  privacyDisclosureReadResponse,
  privacyDisclosureAcknowledgeResponse,
  learnerProfileReadResponse,
  learnerProfileStartOnboardingResponse,
  learnerProfileFinishOnboardingResponse,
  placementCompleteResponse,
  codexActivityPrepareResponse,
  learnerSettingsReadResponse,
  learnerSettingsUpdateResponse,
  developmentNoticeReadResponse,
  developmentNoticeDismissResponse,
  personalDataReadResponse,
  personalDataCleanupResponse,
  diagnosticsReadResponse,
  diagnosticsExportResponse,
  logsClearResponse,
  activityListResponse,
  activityResolveResponse,
  learningPathReadResponse,
  learningPathUpdateResponse,
  learningPathVocabularyResponse,
  learningPathPrepareVoiceResponse,
  dashboardReadResponse,
  response("flashcards/create", flashcardDeckSchema),
  response("flashcards/read", flashcardDeckSchema),
  response("flashcards/progress", flashcardDeckSchema),
  response("flashcards/save-vocabulary", flashcardDeckSchema),
  vocabularyReadResponse,
  vocabularyDetailResponse,
  vocabularyQueueResponse,
  vocabularyBulkResponse,
  vocabularySetListResponse,
  vocabularySetCreateResponse,
  vocabularyConfirmResponse,
  vocabularyReviewResponse,
  vocabularyEditResponse,
  vocabularySuspendResponse,
  vocabularyResumeResponse,
  vocabularyDeleteResponse,
  preparedActivityReadResponse,
  voiceActivityReadResponse,
  voiceActivityOpenInCodexResponse,
  preparedActivityDeleteResponse,
  exerciseSupportResponse,
  exerciseSetStartResponse,
  exerciseSetCompleteResponse,
  exerciseSetAbandonResponse,
  historyReadResponse,
  historyMistakeAmendResponse,
  historyDeleteResponse,
  integrationReadResponse,
  integrationActionResponse,
  accountReadResponse,
  accountLoginResponse,
  accountLoginCancelResponse,
  accountLogoutResponse,
  modelsReadResponse,
  rateLimitsReadResponse,
  learningOperationStartResponse,
  learningOperationRetryResponse,
  learningOperationCancelResponse,
  errorResponse,
]);

export const desktopIpcEventSchema = boundaryUnion([
  strictBoundaryObject({
    event: z.literal("account-login"),
    loginId: correlationIdSchema,
    state: z.discriminatedUnion("status", [
      z.strictObject({ status: z.enum(["opening-browser", "waiting", "complete", "cancelled"]) }),
      z.strictObject({ status: z.literal("failed"), error: callNinaErrorSchema }),
    ]),
  }),
  strictBoundaryObject({
    event: z.literal("learning-operation-progress"),
    operationId: correlationIdSchema,
    submissionId: correlationIdSchema,
    kind: learningOperationKindSchema,
    submission: z.literal("retained"),
    stage: z.enum(["queued", "starting", "running", "validating", "persisting", "cancelling"]),
    attempt: z.union([z.literal(1), z.literal(2)]),
  }),
  ...learningOperationKinds.map((kind) =>
    strictBoundaryObject({
      event: z.literal("learning-operation-finished"),
      operationId: correlationIdSchema,
      submissionId: correlationIdSchema,
      kind: z.literal(kind),
      submission: z.literal("retained"),
      outcome: z.discriminatedUnion("status", [
        z.strictObject({
          status: z.literal("validated"),
          modelRequestId: modelRequestIdSchema,
          provenance: generationProvenanceSchema,
          output: generationCandidateOutputSchemas[kind],
          activityId: activityIdSchema.optional(),
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
  ),
  strictBoundaryObject({
    event: z.literal("data-root-changed"),
    generation: dataRootGenerationSchema,
    displayName: text(32768),
  }),
  strictBoundaryObject({
    event: z.literal("state-invalidated"),
    scope: z.enum([
      "dashboard",
      "history",
      "vocabulary",
      "account",
      "models",
      "rate-limits",
      "settings",
    ]),
  }),
  strictBoundaryObject({
    event: z.literal("prepared-activity-open"),
    activityId: activityIdSchema,
    source: z.literal("url-scheme"),
  }),
]);

export type DesktopIpcRequest = z.infer<typeof desktopIpcRequestSchema>;
export type DesktopIpcResponse = z.infer<typeof desktopIpcResponseSchema>;
export type DesktopIpcEvent = z.infer<typeof desktopIpcEventSchema>;
export type DesktopIpcChannel = z.infer<typeof desktopIpcChannelSchema>;
type DesktopIpcErrorResponse = Extract<DesktopIpcResponse, { status: "error" }>;
type RequestFor<Channel extends DesktopIpcChannel> = Extract<
  DesktopIpcRequest,
  { channel: Channel }
>;
type SuccessResponseFor<Channel extends DesktopIpcChannel> = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: Channel }
>;

export interface CallNinaDesktopBridge {
  invoke<Channel extends DesktopIpcChannel>(
    request: RequestFor<Channel>,
  ): Promise<SuccessResponseFor<Channel> | DesktopIpcErrorResponse>;
  subscribe(listener: (event: DesktopIpcEvent) => void): () => void;
  ready(): void;
  workspaceReady(ready: boolean): void;
}
