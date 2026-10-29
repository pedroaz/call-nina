import { offlineModelViewSchema } from "./offline-model.js";
import { dataRootGenerationSchema } from "./common.js";
import { modelCatalogSchema } from "./app-server-state.js";
import { generationKindSchema } from "./generation.js";
import { languageSchema } from "./learning-context.js";
import { z } from "./schema-system.js";

// Configuration describes intent, never adapter availability or entitlement.
export const aiRouteSchema = z.enum([
  "chatgpt",
  "claude-code",
  "openai",
  "anthropic",
  "google",
  "local",
  "managed",
]);
export const aiConnectionIdSchema = z.uuid();
export const aiSecretReferenceSchema = z.uuid();
const selectionId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
export const aiModelPreferenceSchema = z.strictObject({
  model: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("automatic") }),
    z.strictObject({ mode: z.literal("exact"), modelId: selectionId }),
  ]),
  effort: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("semantic"), effort: z.enum(["fast", "balanced", "deep"]) }),
    z.strictObject({ mode: z.literal("exact"), effortId: selectionId }),
  ]),
});
export const aiConnectionInputSchema = z.strictObject({
  id: aiConnectionIdSchema,
  label: z.string().trim().min(1).max(120),
  routeId: aiRouteSchema,
  preference: aiModelPreferenceSchema,
});
export const aiConnectionSchema = aiConnectionInputSchema
  .extend({ secretRef: aiSecretReferenceSchema.nullable() })
  .refine(
    (value) =>
      ["openai", "anthropic", "google"].includes(value.routeId) || value.secretRef === null,
    { message: "OD_CONNECTION_SECRET_OWNER_INVALID" },
  );
// Root-owned intent survives portability; device-owned key material never travels with it.
export const legacyAiConnectionsSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    revision: z.int().min(0),
    connections: z.array(aiConnectionSchema).max(50),
    activeConnectionId: aiConnectionIdSchema.nullable(),
    migrationNotice: z.boolean(),
    retiredSecretRefs: z.array(aiSecretReferenceSchema).max(100),
  })
  .superRefine((value, ctx) => {
    const ids = value.connections.map((entry) => entry.id);
    const refs = value.connections.flatMap((entry) => (entry.secretRef ? [entry.secretRef] : []));
    if (
      new Set(ids).size !== ids.length ||
      new Set(refs).size !== refs.length ||
      new Set(value.retiredSecretRefs).size !== value.retiredSecretRefs.length ||
      refs.some((ref) => value.retiredSecretRefs.includes(ref)) ||
      (ids.length === 0
        ? value.activeConnectionId !== null
        : !ids.includes(value.activeConnectionId ?? ""))
    ) {
      ctx.addIssue({ code: "custom", message: "OD_CONNECTION_STATE_INVALID" });
    }
  });
export const legacyEmptyAiConnections = {
  schemaVersion: 2,
  revision: 0,
  connections: [],
  activeConnectionId: null,
  migrationNotice: false,
  retiredSecretRefs: [],
} as const;
export const aiCapabilitySchema = z.enum(["text", "image", "audio"]);
export const aiActionSchema = z.enum([...generationKindSchema.options, "translation"]);
export const aiRoutingSchema = z.strictObject({
  liveConversation: z.literal("codex").nullable().default("codex"),
  text: aiRouteSchema.nullable(),
  image: aiRouteSchema.nullable(),
  actions: z.partialRecord(aiActionSchema, aiRouteSchema),
});
export const aiConnectionsSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    revision: z.int().min(0),
    connections: z.array(aiConnectionSchema).max(7),
    routing: aiRoutingSchema,
    migrationNotice: z.boolean(),
    retiredSecretRefs: z.array(aiSecretReferenceSchema).max(200),
  })
  .superRefine((value, ctx) => {
    const ids = value.connections.map((entry) => entry.id);
    const routes = value.connections.map((entry) => entry.routeId);
    const refs = value.connections.flatMap((entry) => (entry.secretRef ? [entry.secretRef] : []));
    if (
      new Set(ids).size !== ids.length ||
      new Set(routes).size !== routes.length ||
      new Set(refs).size !== refs.length ||
      new Set(value.retiredSecretRefs).size !== value.retiredSecretRefs.length ||
      refs.some((ref) => value.retiredSecretRefs.includes(ref))
    )
      ctx.addIssue({ code: "custom", message: "OD_CONNECTION_STATE_INVALID" });
  });
export const emptyAiConnections = {
  schemaVersion: 3,
  revision: 0,
  connections: [],
  routing: { text: null, image: null, actions: {}, liveConversation: "codex" },
  migrationNotice: false,
  retiredSecretRefs: [],
} as const;
export type AiCapability = z.infer<typeof aiCapabilitySchema>;
export type AiRouting = z.infer<typeof aiRoutingSchema>;
export type AiAction = z.infer<typeof aiActionSchema>;
export const aiProviderOrder = [
  "managed",
  "chatgpt",
  "openai",
  "anthropic",
  "google",
  "local",
  "claude-code",
] as const;
export function routedProvider(
  routing: AiRouting,
  action: AiAction,
  capability: "text" | "image" = "text",
) {
  return routing.actions[action] ?? routing[capability];
}

export const aiSecretInputSchema = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[^\s\x00-\x1f\x7f]+$/u);
export const aiConnectionMutationSchema = z.strictObject({
  expectedGeneration: dataRootGenerationSchema,
  expectedRevision: z.int().min(0),
  action: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("save"),
      connection: aiConnectionInputSchema,
      credential: z.discriminatedUnion("action", [
        z.strictObject({ action: z.literal("keep") }),
        z.strictObject({ action: z.literal("remove") }),
        z.strictObject({ action: z.literal("replace"), secret: aiSecretInputSchema }),
      ]),
    }),
    z.strictObject({
      kind: z.literal("routing"),
      routing: aiRoutingSchema,
      resetModelDefaults: z.boolean().optional(),
    }),
    z.strictObject({ kind: z.literal("recommend") }),
    // Keep assignments to a removed provider explicit and unavailable; never fall back.
    z.strictObject({
      kind: z.literal("remove"),
      connectionId: aiConnectionIdSchema,
    }),
    z.strictObject({ kind: z.literal("dismiss-migration") }),
  ]),
});
export const secureStorageStateSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    backend: z.enum(["keychain", "dpapi", "gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]),
  }),
  z.strictObject({ status: z.literal("unavailable") }),
]);
export const directApiRouteSchema = z.enum(["openai", "anthropic", "google"]);
// Shipped support policy, not account discovery or evidence of live access.
export const directApiCatalogSchema = z.strictObject({
  routeId: directApiRouteSchema,
  billing: z.literal("personal-api"),
  validation: z.literal("not-checked"),
  models: modelCatalogSchema,
  operations: z.array(generationKindSchema),
  languages: z.array(languageSchema),
});
export type DirectApiRoute = z.infer<typeof directApiRouteSchema>;
export type DirectApiCatalog = z.infer<typeof directApiCatalogSchema>;
export const aiConnectionsViewSchema = z.strictObject({
  expectedGeneration: dataRootGenerationSchema,
  settings: aiConnectionsSchema,
  secureStorage: secureStorageStateSchema,
  directApiCatalogs: z.array(directApiCatalogSchema).max(3),
  offlineModel: offlineModelViewSchema,
  availability: z
    .array(
      z.strictObject({
        connectionId: aiConnectionIdSchema,
        status: z.enum([
          "available",
          // Local prerequisites only; no key validation or provider contact.
          "configured",
          "inactive",
          "adapter-unavailable",
          "runtime-unavailable",
          "account-required",
          "model-unavailable",
          "credential-required",
          "secure-storage-unavailable",
        ]),
        // Inactive adapters are never started to populate this view.
        operations: z.array(generationKindSchema),
        languages: z.array(languageSchema),
        models: modelCatalogSchema.nullable(),
      }),
    )
    .max(50),
});
export type AiConnection = z.infer<typeof aiConnectionSchema>;
export type AiConnections = z.infer<typeof aiConnectionsSchema>;
export type AiModelPreference = z.infer<typeof aiModelPreferenceSchema>;
