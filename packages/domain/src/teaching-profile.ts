import { sessionIdSchema, strictBoundaryObject, z } from "@call-nina/contracts";

import { explanationLanguageSchema, type LearnerProfile } from "./learner-profile.js";

export const teachingProfileIds = ["conversation-partner", "strict-corrector"] as const;
export const teachingProfileIdSchema = z.enum(teachingProfileIds);

export const teachingActivityKinds = [
  "codex-conversation",
  "voice-conversation",
  "correct-now",
  "writing-review",
  "targeted-mistake-practice",
] as const;
export const teachingActivityKindSchema = z.enum(teachingActivityKinds);

export const teachingProfileDefinitionSchema = z.strictObject({
  id: teachingProfileIdSchema,
  conversationLanguagePolicy: z.enum(["german-first", "activity-language"]),
  interruptionPolicy: z.enum(["minimal", "every-meaningful-error"]),
  correctionTiming: z.enum(["immediate", "end-of-activity"]),
  correctionCoverage: z.enum(["priority-only", "all-meaningful"]),
  explanationLanguagePolicy: z.enum([
    "configured-teaching-language",
    "configured-with-english-support",
  ]),
  tone: z.enum(["encouraging", "precise"]),
  createsTargetedFollowUp: z.boolean(),
});

export const teachingProfiles = {
  "conversation-partner": {
    id: "conversation-partner",
    conversationLanguagePolicy: "german-first",
    interruptionPolicy: "minimal",
    correctionTiming: "end-of-activity",
    correctionCoverage: "priority-only",
    explanationLanguagePolicy: "configured-teaching-language",
    tone: "encouraging",
    createsTargetedFollowUp: false,
  },
  "strict-corrector": {
    id: "strict-corrector",
    conversationLanguagePolicy: "activity-language",
    interruptionPolicy: "every-meaningful-error",
    correctionTiming: "immediate",
    correctionCoverage: "all-meaningful",
    explanationLanguagePolicy: "configured-with-english-support",
    tone: "precise",
    createsTargetedFollowUp: true,
  },
} as const satisfies Record<
  (typeof teachingProfileIds)[number],
  z.input<typeof teachingProfileDefinitionSchema>
>;

const strictDefaultActivities = new Set<(typeof teachingActivityKinds)[number]>([
  "correct-now",
  "writing-review",
  "targeted-mistake-practice",
]);

export function defaultTeachingProfileForActivity(
  activity: (typeof teachingActivityKinds)[number],
): (typeof teachingProfileIds)[number] {
  return strictDefaultActivities.has(activity) ? "strict-corrector" : "conversation-partner";
}

export const sessionTeachingProfileSelectionSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  sessionId: sessionIdSchema,
  activity: teachingActivityKindSchema,
  overrideProfileId: teachingProfileIdSchema.optional(),
});

export type TeachingProfileId = z.infer<typeof teachingProfileIdSchema>;
export type TeachingActivityKind = z.infer<typeof teachingActivityKindSchema>;
export type TeachingProfileDefinition = z.infer<typeof teachingProfileDefinitionSchema>;
export type SessionTeachingProfileSelection = z.infer<typeof sessionTeachingProfileSelectionSchema>;
export type EffectiveTeachingProfile = TeachingProfileDefinition & {
  readonly explanationLanguage: LearnerProfile["explanationLanguage"];
  readonly englishSupport: "none" | "when-useful";
};

export function resolveTeachingProfile(
  selection: SessionTeachingProfileSelection,
  explanationLanguage: LearnerProfile["explanationLanguage"],
): EffectiveTeachingProfile {
  const validatedLanguage = explanationLanguageSchema.parse(explanationLanguage);
  const profile = teachingProfileDefinitionSchema.parse(
    teachingProfiles[
      selection.overrideProfileId ?? defaultTeachingProfileForActivity(selection.activity)
    ],
  );
  return {
    ...profile,
    explanationLanguage: validatedLanguage,
    englishSupport:
      profile.explanationLanguagePolicy === "configured-with-english-support" &&
      validatedLanguage !== "en"
        ? "when-useful"
        : "none",
  };
}
