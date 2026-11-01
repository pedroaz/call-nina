import { correlationIdSchema, dataRootGenerationSchema } from "../common.js";
import { callNinaErrorSchema } from "../errors.js";
import { z } from "../schema-system.js";
import { emptyPayload, request, response, text } from "./envelope.js";
import { codexIntegrationStateSchema } from "./providers.js";

export const appReadinessRequest = request("app/readiness", emptyPayload);

export const dataRootReadRequest = request("data-root/read", emptyPayload);

export const dataRootChooseRequest = request(
  "data-root/choose",
  z.strictObject({ expectedGeneration: dataRootGenerationSchema.optional() }),
);

export const dataRootConfirmRequest = request(
  "data-root/confirm",
  z.strictObject({ selectionId: correlationIdSchema }),
);

export const privacyDisclosureReadRequest = request("privacy/ai-disclosure/read", emptyPayload);

export const privacyDisclosureAcknowledgeRequest = request(
  "privacy/ai-disclosure/acknowledge",
  emptyPayload,
);

export const dataRootStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unconfigured") }),
  z.strictObject({
    status: z.literal("ready"),
    generation: dataRootGenerationSchema,
    displayName: text(32768),
    warnings: z
      .array(
        z.enum([
          "git-worktree",
          "broad-permissions",
          "install-directory",
          "integration-restart-required",
        ]),
      )
      .max(4),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum([
      "missing",
      "invalid",
      "stale",
      "schema-newer",
      "database-busy",
      "database-failed",
    ]),
    error: callNinaErrorSchema,
  }),
]);

export const appReadinessResponse = response(
  "app/readiness",
  z.strictObject({
    status: z.enum(["ready", "degraded"]),
    dataRoot: dataRootStateSchema,
    codex: codexIntegrationStateSchema,
  }),
);

export const dataRootReadResponse = response("data-root/read", dataRootStateSchema);

export const dataRootChooseResponse = response(
  "data-root/choose",
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("cancelled") }),
    z.strictObject({
      status: z.literal("selected"),
      selectionId: correlationIdSchema,
      generation: dataRootGenerationSchema,
      displayName: text(32768),
      warnings: z
        .array(
          z.enum([
            "git-worktree",
            "broad-permissions",
            "install-directory",
            "integration-restart-required",
          ]),
        )
        .max(4),
    }),
  ]),
);

export const dataRootConfirmResponse = response("data-root/confirm", dataRootStateSchema);

export const privacyDisclosureReadResponse = response(
  "privacy/ai-disclosure/read",
  z.strictObject({ acknowledged: z.boolean() }),
);

export const privacyDisclosureAcknowledgeResponse = response(
  "privacy/ai-disclosure/acknowledge",
  z.strictObject({ acknowledged: z.literal(true) }),
);

export const developmentNoticeReadResponse = response(
  "development-notice/read",
  z.strictObject({ pending: z.boolean() }),
);

export const developmentNoticeDismissResponse = response(
  "development-notice/dismiss",
  z.strictObject({ dismissed: z.literal(true) }),
);

export const rootRequests = [
  appReadinessRequest,
  dataRootReadRequest,
  dataRootChooseRequest,
  dataRootConfirmRequest,
  privacyDisclosureReadRequest,
  privacyDisclosureAcknowledgeRequest,
  request("development-notice/read", emptyPayload),
  request("development-notice/dismiss", emptyPayload),
] as const;

export const rootResponses = [
  appReadinessResponse,
  dataRootReadResponse,
  dataRootChooseResponse,
  dataRootConfirmResponse,
  privacyDisclosureReadResponse,
  privacyDisclosureAcknowledgeResponse,
  developmentNoticeReadResponse,
  developmentNoticeDismissResponse,
] as const;
