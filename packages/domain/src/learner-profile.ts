import {
  calendarDateSchema,
  curriculumTopicIdSchema,
  learnerIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
} from "@call-nina/contracts";

export const cefrBands = ["a1", "a2", "b1", "b2"] as const;
export const cefrBandSchema = z.enum(cefrBands);
export const levelBasisSchema = z.enum(["self-reported", "diagnostic", "inferred"]);
export const uiLocaleSchema = z.enum(["en", "de"]);
export const teachingLanguageSchema = z.enum(["en", "de"]);
export const defaultTeachingProfileIdSchema = z.enum(["conversation-partner", "strict-corrector"]);
export const onboardingStateSchema = z.enum(["not-started", "in-progress", "complete"]);
export const correctionTimingSchema = z.enum(["immediate", "end-of-activity", "adaptive"]);
export const correctionCoverageSchema = z.enum(["priority-only", "all-meaningful"]);

export const defaultUiLocale = "en" as const;

const sharedLevelShape = {
  currentLevel: cefrBandSchema,
  targetLevel: cefrBandSchema,
  updatedAt: utcInstantSchema,
} as const;

export const levelEstimateSchema = z.discriminatedUnion("basis", [
  z.strictObject({
    ...sharedLevelShape,
    basis: z.literal("self-reported"),
    optionalDiagnosticCompletedOn: calendarDateSchema.optional(),
  }),
  z.strictObject({
    ...sharedLevelShape,
    basis: z.literal("inferred"),
    optionalDiagnosticCompletedOn: calendarDateSchema.optional(),
  }),
  z.strictObject({
    ...sharedLevelShape,
    basis: z.literal("diagnostic"),
    optionalDiagnosticCompletedOn: calendarDateSchema,
  }),
]);

export const correctionPreferencesSchema = z.strictObject({
  timing: correctionTimingSchema,
  coverage: correctionCoverageSchema,
  showConciseExplanation: z.boolean(),
  showNaturalAlternative: z.boolean(),
});

export const profileInsightSchema = z.strictObject({
  topicId: curriculumTopicIdSchema.optional(),
  label: z.string().trim().min(1).max(120),
  note: z.string().trim().min(1).max(500).optional(),
  confidence: z.enum(["low", "medium", "high"]),
  source: z.enum(["inferred", "learner"]),
  learnerEdited: z.boolean(),
  updatedAt: utcInstantSchema,
});

export const learnerProfileSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  learnerId: learnerIdSchema,
  levelEstimate: levelEstimateSchema,
  everydayGermanyGoal: z.string().trim().min(1).max(500),
  motivation: z.string().trim().min(1).max(500),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
  preferredTopics: z.array(z.string().trim().min(1).max(120)).max(20),
  correctionPreferences: correctionPreferencesSchema,
  onboardingState: onboardingStateSchema,
  inferredStrengths: z.array(profileInsightSchema).max(50),
  inferredWeaknesses: z.array(profileInsightSchema).max(50),
  uiLocale: uiLocaleSchema,
  teachingLanguage: teachingLanguageSchema,
  defaultTeachingProfileId: defaultTeachingProfileIdSchema,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
});

export type CefrBand = z.infer<typeof cefrBandSchema>;
export type LevelEstimate = z.infer<typeof levelEstimateSchema>;
export type CorrectionPreferences = z.infer<typeof correctionPreferencesSchema>;
export type DefaultTeachingProfileId = z.infer<typeof defaultTeachingProfileIdSchema>;
export type ProfileInsight = z.infer<typeof profileInsightSchema>;
export type LearnerProfile = z.infer<typeof learnerProfileSchema>;

export function createInitialLearnerProfile(
  profile: Omit<LearnerProfile, "uiLocale">,
): LearnerProfile {
  return learnerProfileSchema.parse({ ...profile, uiLocale: defaultUiLocale });
}
