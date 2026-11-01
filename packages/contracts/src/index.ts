export {
  activityActionSchema,
  activityDestinationSchema,
  openActivityActionSchema,
  type ActivityAction,
  type ActivityDestination,
} from "./activity-action.js";
export {
  exerciseEntryContextSchema,
  reuseExerciseActionSchema,
  type ExerciseEntryContext,
} from "./exercise-launch.js";

export {
  boundarySurfaceSchema,
  boundarySurfaces,
  boundaryUnion,
  parseBoundary,
  safeParseBoundary,
  strictBoundaryObject,
  toBoundaryJsonSchema,
  toStructuredOutputJsonSchema,
  validationIssues,
  z,
  type BoundarySurface,
  type RuntimeSchema,
  type ValidationIssue,
} from "./schema-system.js";

export {
  activityIdSchema,
  attemptIdSchema,
  calendarDateSchema,
  correctionIdSchema,
  correlationIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  durationMillisecondsSchema,
  exerciseIdSchema,
  historyEntryIdSchema,
  identifierPrefixes,
  identifierSchemas,
  learnerIdSchema,
  mistakeIdSchema,
  modelRequestIdSchema,
  reviewIdSchema,
  runIdSchema,
  sessionIdSchema,
  utcInstantSchema,
  vocabularyIdSchema,
  voiceSessionIdSchema,
  type ActivityId,
  type AttemptId,
  type CalendarDate,
  type CorrectionId,
  type CorrelationId,
  type CurriculumTopicId,
  type DataRootGeneration,
  type DurationMilliseconds,
  type ExerciseId,
  type HistoryEntryId,
  type IdentifierFor,
  type IdentifierKind,
  type LearnerId,
  type MistakeId,
  type ModelRequestId,
  type ReviewId,
  type RunId,
  type SessionId,
  type UtcInstant,
  type VocabularyId,
  type VoiceSessionId,
} from "./common.js";

export {
  callNinaErrorSchema,
  errorCodeSchema,
  errorDefinitions,
  errorKindSchema,
  errorMessageKeySchema,
  localizedErrorMessage,
  logReferenceSchema,
  safeErrorMessages,
  type CallNinaError,
  type ErrorCode,
  type ErrorKind,
  type ErrorLocale,
  type ErrorMessageKey,
  type LogReference,
} from "./errors.js";

export {
  codexIntegrationStateSchema,
  dataRootStateSchema,
  desktopIpcChannelSchema,
  desktopIpcChannels,
  desktopIpcEventSchema,
  desktopIpcRequestSchema,
  desktopIpcResponseSchema,
  learningOperationInputSchema,
  learningOperationKindSchema,
  learningOperationKinds,
  placementResultSchema,
  type CallNinaDesktopBridge,
  type DesktopIpcChannel,
  type DesktopIpcEvent,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type DesktopPayload,
  type DesktopRequest,
  type DesktopResult,
  type DesktopResultInput,
  type PlacementResult,
} from "./ipc.js";

export {
  accountStateSchema,
  modelCatalogSchema,
  rateLimitStateSchema,
} from "./app-server-state.js";

export {
  operationalLogComponentSchema,
  operationalLogOutcomeSchema,
  operationalLogPhaseSchema,
  operationalLogRecordSchema,
  operationalLogSeveritySchema,
  type OperationalLogRecord,
} from "./operational-log.js";

export {
  listeningResultSchema,
  voiceActivityContextSchema,
  type ListeningResult,
  type VoiceActivityContext,
} from "./voice.js";

export {
  activityCreateInputSchema,
  activityCreateResultSchema,
  attemptFeedbackSaveInputSchema,
  attemptFeedbackSaveResultSchema,
  curriculumCoverageReadInputSchema,
  curriculumCoverageReadResultSchema,
  learnerContextReadInputSchema,
  learnerContextReadResultSchema,
  listeningResultSaveInputSchema,
  listeningResultSaveResultSchema,
  mcpConfirmationPolicySchema,
  mcpIdempotencyKeySchema,
  mcpToolAnnotationSchema,
  mcpToolContracts,
  mcpToolNameSchema,
  mcpToolNames,
  practiceContextReadInputSchema,
  practiceContextReadResultSchema,
  preparedVoiceActivityReadInputSchema,
  preparedVoiceActivityReadResultSchema,
  voiceSummarySaveInputSchema,
  voiceSummarySaveResultSchema,
  type McpIdempotencyKey,
  type McpToolContracts,
  type McpToolInput,
  type McpToolName,
  type McpToolResult,
} from "./mcp.js";

export {
  appServerCommandNameSchema,
  appServerCommandSchema,
  appServerCommands,
  appServerEventSchema,
  appServerLifecycleStateSchema,
  appServerSnapshotSchema,
  appServerWorkloadPolicies,
  appServerWorkloadPolicySchema,
  codexExecutableStateSchema,
  codexIntegrationCapabilitiesSchema,
  supportedCodexVersionSchema,
  type AppServerCommand,
  type AppServerCommandName,
  type AppServerEvent,
  type AppServerLifecycleState,
  type AppServerSnapshot,
  type CallNinaAppServerAdapter,
  type SupportedCodexVersion,
} from "./app-server.js";
export {
  capturedTeachingContextSchema,
  contextualHelpCandidateSchema,
  exerciseFeedbackCandidateSchema,
  exerciseGenerationCandidateSchema,
  generatedExerciseInstructions,
  generationCandidateOutputJsonSchemas,
  generationCandidateOutputSchemas,
  generationCapabilitiesSchema,
  generationDeadlineFor,
  generationDeadlineMilliseconds,
  generationEventSchema,
  generationInputSchema,
  generationKindSchema,
  generationKinds,
  generationOperationStartSchema,
  generationOperationStateSchema,
  generationOutputJsonSchemaForInput,
  generationOutputSchemaIdSchema,
  generationOutputSchemaIds,
  isGeneratedExerciseInstruction,
  voiceActivityDraftCandidateSchema,
  writingCorrectionCandidateSchema,
  writingPromptCandidateSchema,
  type CapturedTeachingContext,
  type GenerationCandidateOutputMap,
  type GenerationCapabilities,
  type GenerationEvent,
  type GenerationInput,
  type GenerationKind,
  type GenerationOperationFor,
  type GenerationOperationStart,
  type GenerationOperationState,
  type GenerationOutputMap,
  type GenerationResult,
  type GenerationService,
} from "./generation.js";

export {
  activityLibraryCursorSchema,
  activityLibraryFilterSchema,
  activityLibraryItemSchema,
  activityTypeSchema,
  preparedActivitySchema,
} from "./activity.js";

export {
  practiceSuggestionContextSchema,
  practiceSuggestionSchema,
  type PracticeSuggestion,
} from "./practice-suggestion.js";

export {
  personalDataCleanupRequestSchema,
  personalDataCleanupResultSchema,
  personalDataCleanupScopeSchema,
  personalDataGroups,
  personalDataOverviewSchema,
  personalDataTableSchema,
  personalDataTableSummarySchema,
  personalDataTables,
  type PersonalDataCleanupScope,
  type PersonalDataTable,
} from "./personal-data.js";

export * from "./learning-path.js";
export {
  vocabularyBulkRequestSchema,
  vocabularyCountsSchema,
  vocabularyLibraryFilterSchema,
  vocabularySummarySchema,
  vocabularyVersionSchema,
} from "./vocabulary-library.js";

export * from "./flashcards.js";
export * from "./vocabulary-content.js";

export * from "./learning-context.js";

export * from "./content.js";
export * from "./german-language.js";
export * from "./material.js";

export * from "./content-limits.js";
export * from "./content-reference.js";

export * from "./attempt-evidence.js";
export { generationProvenanceSchema, type GenerationProvenance } from "./generation-provenance.js";

export {
  providerAccessReasonSchema,
  providerAccessSchema,
  providerOperationSchema,
  providerRouteIdSchema,
  type ProviderAccess,
  type ProviderOperation,
} from "./provider-access.js";

export * from "./ai-connections.js";
export * from "./language-policy.js";
export * from "./nina.js";
export * from "./translation.js";

export * from "./offline-model.js";

export { chatgptAccountsSchema, chatgptRegistrationIdSchema } from "./chatgpt.js";

export * from "./nina-account.js";

export * from "./mobile-sync.js";
export * from "./vocabulary-learning.js";

export * from "./speech.js";

export * from "./stories.js";

export * from "./uploads.js";

export * from "./website-study-pack.js";

export * from "./product-feedback.js";
