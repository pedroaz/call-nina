import {
  attemptIdSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
} from "@call-nina/contracts";

import { feedbackUncertaintySchema } from "./attempt.js";
import { aiProvenanceSchema } from "./exercise.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);

export const correctionCategories = [
  "grammar",
  "spelling",
  "punctuation",
  "word-choice",
  "word-order",
  "register",
  "idiom",
  "clarity",
] as const;
export const correctionCategorySchema = z.enum(correctionCategories);
export const correctionSeveritySchema = z.enum(["minor", "meaning-affecting"]);
export const correctionPrioritySchema = z.enum(["low", "medium", "high"]);

const changeMetadata = {
  category: correctionCategorySchema,
  severity: correctionSeveritySchema,
  priority: correctionPrioritySchema,
  explanation: text(800),
  grammarTopicIds: z.array(curriculumTopicIdSchema).max(12),
  uncertainty: feedbackUncertaintySchema,
} as const;

export const alignedCorrectionSegmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("unchanged"),
    text: z.string().min(1).max(12_000),
  }),
  z
    .strictObject({
      kind: z.literal("replacement"),
      originalText: text(12_000),
      correctedText: text(12_000),
      ...changeMetadata,
    })
    .refine((segment) => segment.originalText !== segment.correctedText, {
      path: ["correctedText"],
      message: "replacement must change text",
    }),
  z.strictObject({
    kind: z.literal("insertion"),
    originalText: z.literal(""),
    correctedText: text(12_000),
    ...changeMetadata,
  }),
  z.strictObject({
    kind: z.literal("deletion"),
    originalText: text(12_000),
    correctedText: z.literal(""),
    ...changeMetadata,
  }),
]);

export const naturalAlternativeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-needed") }),
  z.strictObject({
    status: z.literal("provided"),
    text: text(12_000),
    explanation: text(800).optional(),
  }),
]);

export const correctionVocabularyCandidateSchema = z.strictObject({
  lemma: text(160),
  meaning: text(500),
  sourceExcerpt: text(500),
  rationale: text(800),
  uncertainty: feedbackUncertaintySchema,
});

export const correctionFollowUpSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-suggested") }),
  z.strictObject({
    status: z.literal("suggested"),
    title: text(160),
    reason: text(800),
    naturalRequest: text(1_000),
    grammarTopicIds: z.array(curriculumTopicIdSchema).max(12),
  }),
]);

export const correctionSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  correctionId: correctionIdSchema,
  attemptId: attemptIdSchema,
  createdAt: utcInstantSchema,
  aiProvenance: aiProvenanceSchema,
  alignment: z.array(alignedCorrectionSegmentSchema).min(1).max(500),
  naturalAlternative: naturalAlternativeSchema,
  vocabularyCandidates: z.array(correctionVocabularyCandidateSchema).max(50),
  followUp: correctionFollowUpSchema,
  overallUncertainty: feedbackUncertaintySchema,
});

type CorrectionInput = z.infer<typeof correctionSchema>;

export function originalTextFromCorrection(correction: CorrectionInput): string {
  return correction.alignment
    .map((segment) => (segment.kind === "unchanged" ? segment.text : segment.originalText))
    .join("");
}

export function correctedTextFromCorrection(correction: CorrectionInput): string {
  return correction.alignment
    .map((segment) => (segment.kind === "unchanged" ? segment.text : segment.correctedText))
    .join("");
}

export type CorrectionCategory = z.infer<typeof correctionCategorySchema>;
export type AlignedCorrectionSegment = z.infer<typeof alignedCorrectionSegmentSchema>;
export type CorrectionVocabularyCandidate = z.infer<typeof correctionVocabularyCandidateSchema>;
export type Correction = CorrectionInput;
