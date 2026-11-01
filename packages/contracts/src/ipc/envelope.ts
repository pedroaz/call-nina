import { correlationIdSchema, modelRequestIdSchema, utcInstantSchema } from "../common.js";
import { callNinaErrorSchema } from "../errors.js";
import { strictBoundaryObject, z } from "../schema-system.js";

export const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);

export const desktopIpcChannels = [
  "feedback/open",
  "analytics/read",
  "analytics/consent",
  "analytics/screen",
  "speech/availability",
  "speech/read",
  "speech/manage",
  "speech/synthesize",
  "nina-account/credentials/read",
  "nina-account/credentials/save",
  "nina-account/diagnostic",
  "mobile-sync/publish",
  "mobile-sync/read",
  "nina-account/read",
  "nina-account/update",
  "offline-model/read",
  "offline-model/manage",
  "ai-connections/read",
  "ai-connections/update",
  "translation/read",
  "translation/start",
  "translation/cancel",
  "translation/flashcard-visibility",
  "app/readiness",
  "provider/access/read",
  "data-root/read",
  "data-root/choose",
  "data-root/confirm",
  "privacy/ai-disclosure/read",
  "privacy/ai-disclosure/acknowledge",
  "placement/complete",
  "codex-activity/prepare",
  "learner-profile/read",
  "learner-profile/start-onboarding",
  "learner-profile/finish-onboarding",
  "stories/read",
  "stories/position",
  "stories/vocabulary",
  "learner-settings/read",
  "learner-settings/update",
  "learner-settings/select-language",
  "development-notice/read",
  "development-notice/dismiss",
  "personal-data/read",
  "personal-data/clear",
  "diagnostics/read",
  "diagnostics/export",
  "logs/clear",
  "learning-path/read",
  "learning-path/update",
  "learning-path/vocabulary",
  "learning-path/prepare-voice",
  "nina/plan",
  "nina/read",
  "dashboard/read",
  "activity/list",
  "activity/resolve",
  "activity/reuse",
  "flashcards/create",
  "flashcards/read",
  "flashcards/progress",
  "flashcards/save-vocabulary",
  "vocabulary/learning-read",
  "vocabulary/learning-update",
  "vocabulary/read",
  "vocabulary/detail",
  "vocabulary/review-queue",
  "vocabulary/bulk",
  "vocabulary-set/list",
  "vocabulary-set/create",
  "vocabulary/confirm",
  "vocabulary/review",
  "vocabulary/edit",
  "vocabulary/suspend",
  "vocabulary/resume",
  "vocabulary/delete",
  "uploads/list",
  "uploads/read",
  "uploads/save",
  "uploads/archive",
  "uploads/image",
  "uploads/analyses",
  "uploads/commit",
  "material/list",
  "material/import-web",
  "material/cancel-import",
  "material/read",
  "material/save",
  "material/delete",
  "prepared-activity/read",
  "voice-activity/read",
  "voice-activity/open-in-codex",
  "prepared-activity/delete",
  "exercise-set/support",
  "exercise-set/start",
  "exercise-set/answer",
  "exercise-set/complete",
  "exercise-set/abandon",
  "history/read",
  "history/mistake-amend",
  "history/delete",
  "codex/integration/read",
  "codex/integration/action",
  "chatgpt/account/read",
  "chatgpt/account/logout",
  "chatgpt/account/login/start",
  "chatgpt/account/login/cancel",
  "chatgpt/models/read",
  "chatgpt/accounts/read",
  "chatgpt/usage/open",
  "learning-operation/start",
  "learning-operation/retry",
  "learning-operation/cancel",
] as const;

export const desktopIpcChannelSchema = z.enum(desktopIpcChannels);

export const emptyPayload = z.strictObject({});

type RequestShape<
  Channel extends (typeof desktopIpcChannels)[number],
  Payload extends z.ZodType,
> = { channel: z.ZodLiteral<Channel>; requestId: typeof correlationIdSchema; payload: Payload };
export function request<
  const Channel extends (typeof desktopIpcChannels)[number],
  Payload extends z.ZodType,
>(
  channel: Channel,
  payload: Payload,
): ReturnType<typeof strictBoundaryObject<RequestShape<Channel, Payload>>> {
  return strictBoundaryObject<RequestShape<Channel, Payload>>({
    channel: z.literal(channel),
    requestId: correlationIdSchema,
    payload,
  });
}

type ResponseShape<
  Channel extends (typeof desktopIpcChannels)[number],
  Result extends z.ZodType,
> = {
  status: z.ZodLiteral<"ok">;
  channel: z.ZodLiteral<Channel>;
  requestId: typeof correlationIdSchema;
  result: Result;
};
export function response<
  const Channel extends (typeof desktopIpcChannels)[number],
  Result extends z.ZodType,
>(
  channel: Channel,
  result: Result,
): ReturnType<typeof strictBoundaryObject<ResponseShape<Channel, Result>>> {
  return strictBoundaryObject<ResponseShape<Channel, Result>>({
    status: z.literal("ok"),
    channel: z.literal(channel),
    requestId: correlationIdSchema,
    result,
  });
}

export const generatedActivityProvenanceSchema = z.strictObject({
  modelRequestId: modelRequestIdSchema,
  generatedAt: utcInstantSchema,
  modelId: text(128),
  effortId: text(128),
});

export const errorResponse = strictBoundaryObject({
  status: z.literal("error"),
  channel: desktopIpcChannelSchema,
  requestId: correlationIdSchema,
  error: callNinaErrorSchema,
});

export const envelopeResponses = [errorResponse] as const;
