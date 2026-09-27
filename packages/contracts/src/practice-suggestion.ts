import {
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  mistakeIdSchema,
  vocabularyIdSchema,
} from "./common.js";
import { z } from "./schema-system.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);

export const practiceSuggestionContextSchema = z.strictObject({
  curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
  mistakeIds: z.array(mistakeIdSchema).max(12),
  vocabularyIds: z.array(vocabularyIdSchema).max(24),
});

export const practiceSuggestionSchema = z.strictObject({
  id: text(240),
  rootGeneration: dataRootGenerationSchema,
  source: z.enum(["due-vocabulary", "mistake", "starter"]),
  kind: z.enum([
    "writing",
    "grammar",
    "vocabulary-review",
    "reading",
    "codex-listening",
    "voice-speaking",
    "custom-lesson",
  ]),
  title: text(160),
  rationale: text(800),
  naturalRequest: text(1_000),
  estimatedMinutes: z.int().min(5).max(180),
  context: practiceSuggestionContextSchema,
});

export type PracticeSuggestion = z.infer<typeof practiceSuggestionSchema>;
