import { aiConnectionMutationSchema, aiConnectionsViewSchema } from "../ai-connections.js";
import { accountStateSchema, modelCatalogSchema } from "../app-server-state.js";
import { chatgptAccountsSchema, chatgptRegistrationIdSchema } from "../chatgpt.js";
import { correlationIdSchema } from "../common.js";
import { callNinaErrorSchema } from "../errors.js";
import { offlineModelActionSchema, offlineModelViewSchema } from "../offline-model.js";
import { providerAccessSchema, providerOperationSchema } from "../provider-access.js";
import { z } from "../schema-system.js";
import { emptyPayload, request, response, text } from "./envelope.js";

export const providerAccessReadRequest = request(
  "provider/access/read",
  z.strictObject({
    operation: providerOperationSchema,
    hasImage: z.boolean().optional(),
    previousOperationId: correlationIdSchema.optional(),
  }),
);

export const integrationReadRequest = request("codex/integration/read", emptyPayload);

export const integrationActionRequest = request(
  "codex/integration/action",
  z.strictObject({ action: z.enum(["install", "refresh", "uninstall"]) }),
);

export const accountReadRequest = request("chatgpt/account/read", emptyPayload);

export const accountLogoutRequest = request("chatgpt/account/logout", emptyPayload);

export const accountLoginRequest = request(
  "chatgpt/account/login/start",
  z.strictObject({ registrationId: chatgptRegistrationIdSchema.nullable() }),
);

export const accountLoginCancelRequest = request(
  "chatgpt/account/login/cancel",
  z.strictObject({ loginId: correlationIdSchema }),
);

export const modelsReadRequest = request("chatgpt/models/read", emptyPayload);

export const usageOpenRequest = request("chatgpt/usage/open", emptyPayload);

export const accountsReadRequest = request("chatgpt/accounts/read", emptyPayload);

export const codexIntegrationStateSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.enum(["missing", "unsupported-version", "app-server-unavailable"]),
    error: callNinaErrorSchema,
  }),
  z.strictObject({
    status: z.literal("available"),
    codexVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
    plugin: z.enum(["not-installed", "installed", "refresh-required"]),
  }),
]);

export const providerAccessReadResponse = response("provider/access/read", providerAccessSchema);

export const integrationReadResponse = response(
  "codex/integration/read",
  codexIntegrationStateSchema,
);

export const integrationActionResponse = response(
  "codex/integration/action",
  z.strictObject({
    action: z.enum(["install", "refresh", "uninstall"]),
    result: z.enum(["verified", "missing", "failed"]),
    sourceVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    status: codexIntegrationStateSchema,
    steps: z.array(text(240)).min(1).max(8),
  }),
);

export const accountReadResponse = response("chatgpt/account/read", accountStateSchema);

export const accountLogoutResponse = response("chatgpt/account/logout", accountStateSchema);

export const accountLoginResponse = response(
  "chatgpt/account/login/start",
  z.strictObject({ loginId: correlationIdSchema, status: z.literal("started") }),
);

export const accountLoginCancelResponse = response(
  "chatgpt/account/login/cancel",
  z.strictObject({
    loginId: correlationIdSchema,
    status: z.enum(["cancelled", "already-finished"]),
  }),
);

export const modelsReadResponse = response("chatgpt/models/read", modelCatalogSchema);

export const usageOpenResponse = response(
  "chatgpt/usage/open",
  z.strictObject({ status: z.literal("opened") }),
);

export const accountsReadResponse = response("chatgpt/accounts/read", chatgptAccountsSchema);

export const providersRequests = [
  request("offline-model/read", emptyPayload),
  request("offline-model/manage", offlineModelActionSchema),
  request("ai-connections/read", emptyPayload),
  request("ai-connections/update", aiConnectionMutationSchema),
  providerAccessReadRequest,
  integrationReadRequest,
  integrationActionRequest,
  accountReadRequest,
  accountLogoutRequest,
  accountLoginRequest,
  accountLoginCancelRequest,
  modelsReadRequest,
  accountsReadRequest,
  usageOpenRequest,
] as const;

export const providersResponses = [
  response("offline-model/read", offlineModelViewSchema),
  response("offline-model/manage", offlineModelViewSchema),
  response("ai-connections/read", aiConnectionsViewSchema),
  response("ai-connections/update", aiConnectionsViewSchema),
  providerAccessReadResponse,
  integrationReadResponse,
  integrationActionResponse,
  accountReadResponse,
  accountLogoutResponse,
  accountLoginResponse,
  accountLoginCancelResponse,
  modelsReadResponse,
  accountsReadResponse,
  usageOpenResponse,
] as const;
