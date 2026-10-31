import {
  activityIdSchema,
  correlationIdSchema,
  dataRootGenerationSchema,
  modelRequestIdSchema,
} from "../common.js";
import { callNinaErrorSchema } from "../errors.js";
import { generationProvenanceSchema } from "../generation-provenance.js";
import { generationCandidateOutputSchemas } from "../generation.js";
import { learningScopeSchema } from "../learning-context.js";
import { boundaryUnion, strictBoundaryObject, z } from "../schema-system.js";
import { translationFinishedEventSchema } from "../translation.js";
import { text } from "./envelope.js";
import { learningOperationKinds, learningOperationKindSchema } from "./generation.js";

export const desktopIpcEventSchema = boundaryUnion([
  strictBoundaryObject({
    event: z.literal("speech-audio"),
    id: z.uuid(),
    audio: z.string().max(8_000_000),
  }),
  translationFinishedEventSchema,
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
          learningScope: learningScopeSchema.optional(),
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
      "ai-connections",
      "speech-playback",
    ]),
  }),
  strictBoundaryObject({
    event: z.literal("prepared-activity-open"),
    activityId: activityIdSchema,
    source: z.literal("url-scheme"),
  }),
]);
