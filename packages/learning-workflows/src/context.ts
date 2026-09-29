import {
  learningContextSchema,
  type GenerationInput,
  type LearningContext,
} from "@call-nina/contracts";

export const generationLevel = { a1: "A1", a2: "A2", b1: "B1", b2: "B2" } as const;
export function buildLearningCalibration(
  context: LearningContext,
  profile: {
    levelEstimate: { currentLevel: keyof typeof generationLevel };
    defaultTeachingProfileId: "conversation-partner" | "strict-corrector";
  },
): Extract<GenerationInput, { kind: "writing-prompt" }>["calibration"] {
  const validated = learningContextSchema.parse(context);
  return {
    approximateLevel: generationLevel[profile.levelEstimate.currentLevel],
    explanationLanguage: validated.explanationLanguage,
    teachingProfile: profile.defaultTeachingProfileId,
  };
}
