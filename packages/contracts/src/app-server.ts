import {
  generationEventSchema,
  generationOperationStartSchema,
  generationOutputSchemaIdSchema,
  generationOutputSchemaIds,
  generationKinds,
  generationDeadlineMilliseconds,
  type GenerationEvent,
  type GenerationOutputMap,
  type GenerationService,
} from "./generation.js";
import { correlationIdSchema, utcInstantSchema } from "./common.js";
import { callNinaErrorSchema } from "./errors.js";
import {
  accountStateSchema,
  modelCatalogSchema,
  rateLimitStateSchema,
} from "./app-server-state.js";
import { boundaryUnion, strictBoundaryObject, type RuntimeSchema, z } from "./schema-system.js";

export const supportedCodexVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  .brand<"SupportedCodexVersion">();

export const codexExecutableStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("missing") }),
  z.strictObject({
    status: z.literal("unsupported"),
    detectedVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  }),
  z.strictObject({
    status: z.literal("compatible"),
    version: supportedCodexVersionSchema,
    source: z.enum(["desktop-bundled", "configured-absolute-path"]),
  }),
]);

export const appServerLifecycleStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("stopped"), codex: codexExecutableStateSchema }),
  z.strictObject({
    status: z.enum(["discovering", "starting", "initializing", "stopping"]),
    startedAt: utcInstantSchema,
  }),
  z.strictObject({
    status: z.literal("ready"),
    codexVersion: supportedCodexVersionSchema,
    initializedAt: utcInstantSchema,
  }),
  z.strictObject({ status: z.literal("failed"), error: callNinaErrorSchema }),
]);

export const appServerSnapshotSchema = strictBoundaryObject({
  lifecycle: appServerLifecycleStateSchema,
  account: accountStateSchema,
  models: modelCatalogSchema,
  rateLimits: rateLimitStateSchema,
});

export const appServerWorkloadPolicySchema = strictBoundaryObject({
  policyVersion: z.literal(1),
  cwd: z.literal("owned-disposable-workspace"),
  thread: z.literal("ephemeral"),
  sandbox: z.strictObject({
    mode: z.literal("workspace-write"),
    writableRoots: z.literal("workspace-only"),
    networkAccess: z.literal(false),
  }),
  tools: z.strictObject({
    shell: z.literal(false),
    webSearch: z.literal(false),
    mcpServers: z.literal("none"),
    dynamicTools: z.literal(false),
  }),
  approvalPolicy: z.literal("never"),
  interactiveUserInput: z.literal(false),
  absoluteDeadlineMilliseconds: z.int().min(1_000).max(120_000),
  outputSchemaId: generationOutputSchemaIdSchema,
});

const sandboxPolicy = Object.freeze({
  mode: "workspace-write",
  writableRoots: "workspace-only",
  networkAccess: false,
} as const);
const toolPolicy = Object.freeze({
  shell: false,
  webSearch: false,
  mcpServers: "none",
  dynamicTools: false,
} as const);
const basePolicy = Object.freeze({
  policyVersion: 1,
  cwd: "owned-disposable-workspace",
  thread: "ephemeral",
  sandbox: sandboxPolicy,
  tools: toolPolicy,
  approvalPolicy: "never",
  interactiveUserInput: false,
} as const);

export const appServerWorkloadPolicies = Object.freeze(
  Object.fromEntries(
    generationKinds.map((kind) => [
      kind,
      Object.freeze({
        ...basePolicy,
        absoluteDeadlineMilliseconds: generationDeadlineMilliseconds[kind],
        outputSchemaId: generationOutputSchemaIds[kind],
      }),
    ]),
  ) as {
    readonly [Kind in (typeof generationKinds)[number]]: Readonly<
      typeof basePolicy & {
        readonly absoluteDeadlineMilliseconds: 30_000 | 60_000 | 120_000;
        readonly outputSchemaId: (typeof generationOutputSchemaIds)[Kind];
      }
    >;
  },
);

export const appServerCommands = [
  "runtime/start",
  "runtime/read",
  "account/read",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
  "models/read",
  "rate-limits/read",
  "operation/start",
  "operation/retry",
  "operation/cancel",
  "runtime/shutdown",
] as const;
export const appServerCommandNameSchema = z.enum(appServerCommands);

const command = <const Name extends (typeof appServerCommands)[number], Payload extends z.ZodType>(
  name: Name,
  payload: Payload,
) =>
  strictBoundaryObject({
    command: z.literal(name),
    requestId: correlationIdSchema,
    payload,
  });
const emptyPayload = z.strictObject({});

export const appServerCommandSchema = boundaryUnion([
  command("runtime/start", emptyPayload),
  command("runtime/read", emptyPayload),
  command("account/read", emptyPayload),
  command("account/login/start", z.strictObject({ method: z.enum(["browser", "device-code"]) })),
  command("account/login/cancel", z.strictObject({ loginId: correlationIdSchema })),
  command("account/logout", emptyPayload),
  command("models/read", emptyPayload),
  command("rate-limits/read", emptyPayload),
  command("operation/start", generationOperationStartSchema),
  command(
    "operation/retry",
    z.strictObject({
      previousOperationId: correlationIdSchema,
      operationId: correlationIdSchema,
      submissionId: correlationIdSchema,
    }),
  ),
  command("operation/cancel", z.strictObject({ operationId: correlationIdSchema })),
  command(
    "runtime/shutdown",
    z.strictObject({ deadlineMilliseconds: z.int().min(100).max(10_000).default(5_000) }),
  ),
]);

const appServerRuntimeEventSchema = boundaryUnion([
  strictBoundaryObject({
    event: z.literal("lifecycle-changed"),
    state: appServerLifecycleStateSchema,
  }),
  strictBoundaryObject({ event: z.literal("account-changed"), state: accountStateSchema }),
  strictBoundaryObject({
    event: z.literal("account-login-changed"),
    loginId: correlationIdSchema,
    state: z.discriminatedUnion("status", [
      z.strictObject({ status: z.enum(["opening-browser", "waiting", "complete", "cancelled"]) }),
      z.strictObject({ status: z.literal("failed"), error: callNinaErrorSchema }),
    ]),
  }),
  strictBoundaryObject({ event: z.literal("models-changed") }),
  strictBoundaryObject({ event: z.literal("rate-limits-changed") }),
]);

// Reuse the canonical operation event type instead of expanding its large output
// union a second time at every adapter/consumer assignment.
export type AppServerEvent = z.infer<typeof appServerRuntimeEventSchema> | GenerationEvent;
export const appServerEventSchema = boundaryUnion([
  ...appServerRuntimeEventSchema.options,
  ...generationEventSchema.options,
]) as RuntimeSchema<AppServerEvent>;

export type SupportedCodexVersion = z.infer<typeof supportedCodexVersionSchema>;
export type AppServerLifecycleState = z.infer<typeof appServerLifecycleStateSchema>;
export type AppServerSnapshot = z.infer<typeof appServerSnapshotSchema>;
export type AppServerCommand = z.infer<typeof appServerCommandSchema>;
export type AppServerCommandName = z.infer<typeof appServerCommandNameSchema>;
// Structural adapter support; account, installation and session availability are checked at use.
export const codexIntegrationCapabilitiesSchema = z.strictObject({
  voiceHandoff: z.literal(true),
  externalConversation: z.literal(true),
  localMcp: z.literal(true),
  plugin: z.literal(true),
});
export interface CallNinaAppServerAdapter<
  Outputs extends GenerationOutputMap = GenerationOutputMap,
> extends GenerationService<Outputs> {
  readonly codexCapabilities: z.infer<typeof codexIntegrationCapabilitiesSchema>;
  start(): Promise<AppServerSnapshot>;
  snapshot(): Promise<AppServerSnapshot>;
  startManagedLogin(
    method: "browser" | "device-code",
  ): Promise<z.output<typeof correlationIdSchema>>;
  cancelManagedLogin(loginId: z.output<typeof correlationIdSchema>): Promise<void>;
  logout(): Promise<z.output<typeof accountStateSchema>>;
  refreshModels(): Promise<z.output<typeof modelCatalogSchema>>;
  refreshRateLimits(): Promise<z.output<typeof rateLimitStateSchema>>;
  shutdown(): Promise<void>;
  subscribe(listener: (event: AppServerEvent) => void): () => void;
}
