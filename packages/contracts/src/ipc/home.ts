import {
  activityIdSchema,
  calendarDateSchema,
  correctionIdSchema,
  dataRootGenerationSchema,
  mistakeIdSchema,
  utcInstantSchema,
  vocabularyIdSchema,
} from "../common.js";
import { languageSchema, learningContextSchema } from "../learning-context.js";
import { ninaContinueSchema, ninaPlanSchema, ninaRequestSchema } from "../nina.js";
import { practiceSuggestionSchema } from "../practice-suggestion.js";
import { z } from "../schema-system.js";
import { emptyPayload, request, response, text } from "./envelope.js";

export const ninaPlanRequest = request("nina/plan", ninaRequestSchema);

export const ninaReadRequest = request("nina/read", emptyPayload);

export const dashboardReadRequest = request(
  "dashboard/read",
  z.strictObject({ locale: languageSchema.optional() }),
);

export const ninaPlanResponse = response("nina/plan", ninaPlanSchema);

export const ninaReadResponse = response(
  "nina/read",
  z.strictObject({
    rootGeneration: dataRootGenerationSchema,
    learningContext: learningContextSchema,
    resume: ninaContinueSchema.nullable(),
  }),
);

export const dashboardReadResponse = response(
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

export const homeRequests = [ninaPlanRequest, ninaReadRequest, dashboardReadRequest] as const;

export const homeResponses = [ninaPlanResponse, ninaReadResponse, dashboardReadResponse] as const;
