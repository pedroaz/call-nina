import { z } from "./schema-system.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);

export const voiceActivityContextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(["listening", "speaking"]),
  targetLevel: z.enum(["a1", "a2", "b1", "b2"]),
  scenario: text(240),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  correctionTiming: z.enum(["during", "after-each", "end"]),
  speakingPace: z.enum(["slow", "normal", "fast"]).optional(),
  objectives: z.array(text(500)).min(1).max(8),
  script: text(2_400).optional(),
  questions: z.array(text(500)).min(1).max(8),
  answerGuidance: z.array(text(500)).min(1).max(8),
});
export type VoiceActivityContext = z.infer<typeof voiceActivityContextSchema>;

const evidence = z.strictObject({
  outcome: z.enum(["demonstrated", "developing", "not-demonstrated"]),
  evidence: text(800),
  uncertainty: z.discriminatedUnion("level", [
    z.strictObject({ level: z.literal("none") }),
    z.strictObject({
      level: z.enum(["some", "substantial"]),
      explanation: text(800),
    }),
  ]),
});

export const listeningResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  exerciseResults: z
    .array(
      z.strictObject({
        kind: z.enum(["gist", "detail", "dictation", "cloze"]),
        ...evidence.shape,
      }),
    )
    .length(4),
  difficultVocabulary: z.array(text(160)).max(30),
  nextSteps: z.array(text(500)).min(1).max(10),
  noAudioNotice: z.literal("OD_NO_AUDIO_OR_TRANSCRIPT_STORED_BY_CALL_NINA"),
});
export type ListeningResult = z.infer<typeof listeningResultSchema>;
