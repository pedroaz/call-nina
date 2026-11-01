import {
  calendarDateSchema,
  dataRootGenerationSchema,
  historyEntryIdSchema,
  utcInstantSchema,
} from "../common.js";
import { languageSchema, learningContextSchema, learningScopeSchema } from "../learning-context.js";
import { strictBoundaryObject, z } from "../schema-system.js";
import { emptyPayload, request, response, text } from "./envelope.js";

export const learnerProfileReadRequest = request("learner-profile/read", emptyPayload);

export const learnerNameSchema = z.string().trim().max(100);

export const onboardingProfileInputSchema = z.strictObject({
  learnerName: learnerNameSchema,
  expectedGeneration: dataRootGenerationSchema,
  targetLanguage: languageSchema,
  uiLocale: languageSchema,
  approximateLevel: z.enum(["a1", "a2", "b1", "b2"]),
  everydayLifeGoal: text(500),
  defaultTeachingProfileId: z.enum(["conversation-partner", "strict-corrector"]),
  explanationLanguage: languageSchema,
  placement: z.strictObject({ status: z.literal("skipped") }),
});

export const learnerProfileStartOnboardingRequest = request(
  "learner-profile/start-onboarding",
  onboardingProfileInputSchema,
);

export const learnerProfileFinishOnboardingRequest = request(
  "learner-profile/finish-onboarding",
  z.strictObject({
    expectedGeneration: dataRootGenerationSchema,
    expectedUpdatedAt: utcInstantSchema,
  }),
);

export const editableLearnerSettingsSchema = z.strictObject({
  learnerName: learnerNameSchema,
  learningScope: learningScopeSchema,
  approximateLevel: z.enum(["a1", "a2", "b1", "b2"]),
  everydayLifeGoal: text(500),
  defaultTeachingProfileId: z.enum(["conversation-partner", "strict-corrector"]),
  explanationLanguage: languageSchema,
  uiLocale: languageSchema,
  correctionPreferences: z.strictObject({
    timing: z.enum(["immediate", "end-of-activity", "adaptive"]),
    coverage: z.enum(["priority-only", "all-meaningful"]),
    showConciseExplanation: z.boolean(),
    showNaturalAlternative: z.boolean(),
  }),
});

export const learnerLanguageSelectRequest = request(
  "learner-settings/select-language",
  z.strictObject({ expectedGeneration: dataRootGenerationSchema, targetLanguage: languageSchema }),
);

export const learnerSettingsReadRequest = request("learner-settings/read", emptyPayload);

export const learnerSettingsUpdateRequest = request(
  "learner-settings/update",
  z.strictObject({
    expectedUpdatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
    settings: editableLearnerSettingsSchema,
  }),
);

export const placementUncertaintySchema = z.discriminatedUnion("level", [
  z.strictObject({ level: z.literal("none") }),
  z.strictObject({ level: z.enum(["some", "substantial"]), explanation: text(800) }),
]);

export const placementResultShape = {
  learningScope: learningScopeSchema,
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

export const placementCompleteRequest = request(
  "placement/complete",
  z.strictObject({ result: placementResultSchema }),
);

export const learnerProfileSummarySchema = z.strictObject({
  learnerName: learnerNameSchema,
  learningContext: learningContextSchema,
  onboardingState: z.enum(["not-started", "in-progress", "complete"]),
  approximateLevel: z.enum(["a1", "a2", "b1", "b2"]),
  everydayLifeGoal: text(500),
  defaultTeachingProfileId: z.enum(["conversation-partner", "strict-corrector"]),
  explanationLanguage: languageSchema,
  uiLocale: languageSchema,
  placement: z.strictObject({ status: z.enum(["skipped", "completed"]) }),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
});

export const learnerProfileReadResponse = response(
  "learner-profile/read",
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("not-created") }),
    z.strictObject({ status: z.literal("ready"), profile: learnerProfileSummarySchema }),
  ]),
);

export const learnerProfileStartOnboardingResponse = response(
  "learner-profile/start-onboarding",
  z.strictObject({ status: z.literal("ready"), profile: learnerProfileSummarySchema }),
);

export const learnerProfileFinishOnboardingResponse = response(
  "learner-profile/finish-onboarding",
  z.strictObject({ status: z.literal("ready"), profile: learnerProfileSummarySchema }),
);

export const placementCompleteResponse = response(
  "placement/complete",
  z.strictObject({
    status: z.literal("completed"),
    historyEntryId: historyEntryIdSchema,
    profile: learnerProfileSummarySchema,
  }),
);

export const learnerSettingsProjectionSchema = z.strictObject({
  dataRoot: z.strictObject({
    generation: dataRootGenerationSchema,
    displayName: text(32768),
  }),
  settings: editableLearnerSettingsSchema,
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
});

export const learnerLanguageSelectResponse = response(
  "learner-settings/select-language",
  learnerSettingsProjectionSchema,
);

export const learnerSettingsReadResponse = response(
  "learner-settings/read",
  learnerSettingsProjectionSchema,
);

export const learnerSettingsUpdateResponse = response(
  "learner-settings/update",
  learnerSettingsProjectionSchema,
);

export const learnerRequests = [
  placementCompleteRequest,
  learnerProfileReadRequest,
  learnerProfileStartOnboardingRequest,
  learnerProfileFinishOnboardingRequest,
  learnerLanguageSelectRequest,
  learnerSettingsReadRequest,
  learnerSettingsUpdateRequest,
] as const;

export const learnerResponses = [
  learnerProfileReadResponse,
  learnerProfileStartOnboardingResponse,
  learnerProfileFinishOnboardingResponse,
  placementCompleteResponse,
  learnerLanguageSelectResponse,
  learnerSettingsReadResponse,
  learnerSettingsUpdateResponse,
] as const;
