import { productFeedbackRequests, productFeedbackResponses } from "./ipc/product-feedback.js";
import { accountRequests, accountResponses } from "./ipc/account.js";
import { activitiesRequests, activitiesResponses } from "./ipc/activities.js";
import { curriculumRequests, curriculumResponses } from "./ipc/curriculum.js";
import { diagnosticsRequests, diagnosticsResponses } from "./ipc/diagnostics.js";
import { type desktopIpcChannelSchema, envelopeResponses } from "./ipc/envelope.js";
import { desktopIpcEventSchema } from "./ipc/events.js";
import { exercisesRequests, exercisesResponses } from "./ipc/exercises.js";
import { generationRequests, generationResponses } from "./ipc/generation.js";
import { historyRequests, historyResponses } from "./ipc/history.js";
import { homeRequests, homeResponses } from "./ipc/home.js";
import { learnerRequests, learnerResponses } from "./ipc/learner.js";
import { providersRequests, providersResponses } from "./ipc/providers.js";
import { rootRequests, rootResponses } from "./ipc/root.js";
import { speechRequests, speechResponses } from "./ipc/speech.js";
import { uploadsRequests, uploadsResponses } from "./ipc/uploads.js";
import { vocabularyRequests, vocabularyResponses } from "./ipc/vocabulary.js";
import { boundaryUnion, type z } from "./schema-system.js";

export { desktopIpcChannels, desktopIpcChannelSchema } from "./ipc/envelope.js";
export {
  learningOperationInputSchema,
  learningOperationKinds,
  learningOperationKindSchema,
} from "./ipc/generation.js";
export { placementResultSchema, type PlacementResult } from "./ipc/learner.js";
export { codexIntegrationStateSchema } from "./ipc/providers.js";
export { dataRootStateSchema } from "./ipc/root.js";
export { desktopIpcEventSchema };

type DesktopRequestSchemas = readonly [
  ...typeof providersRequests,
  ...typeof rootRequests,
  ...typeof learnerRequests,
  ...typeof activitiesRequests,
  ...typeof diagnosticsRequests,
  ...typeof homeRequests,
  ...typeof curriculumRequests,
  ...typeof vocabularyRequests,
  ...typeof uploadsRequests,
  ...typeof exercisesRequests,
  ...typeof historyRequests,
  ...typeof generationRequests,
  ...typeof accountRequests,
  ...typeof speechRequests,
  ...typeof productFeedbackRequests,
];
export const desktopIpcRequestSchema: ReturnType<typeof boundaryUnion<DesktopRequestSchemas>> =
  boundaryUnion([
    ...providersRequests,
    ...rootRequests,
    ...learnerRequests,
    ...activitiesRequests,
    ...diagnosticsRequests,
    ...homeRequests,
    ...curriculumRequests,
    ...vocabularyRequests,
    ...uploadsRequests,
    ...exercisesRequests,
    ...historyRequests,
    ...generationRequests,
    ...accountRequests,
    ...speechRequests,
    ...productFeedbackRequests,
  ]);
type DesktopResponseSchemas = readonly [
  ...typeof envelopeResponses,
  ...typeof providersResponses,
  ...typeof rootResponses,
  ...typeof learnerResponses,
  ...typeof activitiesResponses,
  ...typeof diagnosticsResponses,
  ...typeof homeResponses,
  ...typeof curriculumResponses,
  ...typeof vocabularyResponses,
  ...typeof uploadsResponses,
  ...typeof exercisesResponses,
  ...typeof historyResponses,
  ...typeof generationResponses,
  ...typeof accountResponses,
  ...typeof speechResponses,
  ...typeof productFeedbackResponses,
];
export const desktopIpcResponseSchema: ReturnType<typeof boundaryUnion<DesktopResponseSchemas>> =
  boundaryUnion([
    ...envelopeResponses,
    ...providersResponses,
    ...rootResponses,
    ...learnerResponses,
    ...activitiesResponses,
    ...diagnosticsResponses,
    ...homeResponses,
    ...curriculumResponses,
    ...vocabularyResponses,
    ...uploadsResponses,
    ...exercisesResponses,
    ...historyResponses,
    ...generationResponses,
    ...accountResponses,
    ...speechResponses,
    ...productFeedbackResponses,
  ]);

export type DesktopIpcRequest = z.infer<typeof desktopIpcRequestSchema>;

export type DesktopIpcResponse = z.infer<typeof desktopIpcResponseSchema>;

export type DesktopIpcEvent = z.infer<typeof desktopIpcEventSchema>;

export type DesktopIpcChannel = z.infer<typeof desktopIpcChannelSchema>;

type DesktopIpcErrorResponse = Extract<DesktopIpcResponse, { status: "error" }>;

type RequestFor<Channel extends DesktopIpcChannel> = Extract<
  DesktopIpcRequest,
  { channel: Channel }
>;

type ResponseFor<Response, Channel extends DesktopIpcChannel> = Response extends {
  status: "ok";
  channel: infer Channels;
}
  ? Channel extends Channels
    ? Response & { channel: Channel }
    : never
  : never;
type SuccessResponseFor<Channel extends DesktopIpcChannel> = ResponseFor<
  DesktopIpcResponse,
  Channel
>;

export interface CallNinaDesktopBridge {
  invoke<Channel extends DesktopIpcChannel>(
    request: RequestFor<Channel>,
  ): Promise<SuccessResponseFor<Channel> | DesktopIpcErrorResponse>;
  subscribe(listener: (event: DesktopIpcEvent) => void): () => void;
  ready(): void;
  workspaceReady(ready: boolean): void;
}

export type DesktopRequest<Channel extends DesktopIpcChannel> = RequestFor<Channel>;
export type DesktopPayload<Channel extends DesktopIpcChannel> = RequestFor<Channel>["payload"];
export type DesktopResult<Channel extends DesktopIpcChannel> =
  SuccessResponseFor<Channel>["result"];

// Producers supply schema inputs; validation adds brands before crossing IPC.
type ReadonlyInput<Value> = Value extends readonly (infer Item)[]
  ? readonly ReadonlyInput<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: ReadonlyInput<Value[Key]> }
    : Value;
export type DesktopResultInput<Channel extends DesktopIpcChannel> = ReadonlyInput<
  ResponseFor<z.input<typeof desktopIpcResponseSchema>, Channel>["result"]
>;
