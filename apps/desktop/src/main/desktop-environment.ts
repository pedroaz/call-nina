import { discoverCodex, type AppServerLogRecord } from "@call-nina/codex-client";
import {
  correlationIdSchema,
  desktopIpcResponseSchema,
  type DesktopIpcEvent,
  type DesktopIpcChannel,
  type DesktopResultInput,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type ErrorKind,
  type ProviderAccess,
  type Language,
} from "@call-nina/contracts";
import { type OfflineRuntime } from "@call-nina/offline-runtime";
import { safeError } from "./backend-support.js";
import { type ChatgptSession } from "./chatgpt-session.js";
import { NinaAccount } from "./nina-account.js";
import { type NinaLoginStorage } from "./nina-login-storage.js";
import { desktopPathOption } from "./options.js";
import { readPluginIntegrationState } from "./plugin-integration.js";
import { type ConnectionSecretStorage } from "./secret-storage.js";

export interface DesktopOptions {
  speechBundleDirectory?: string;
  developmentSpeechBundlesDirectory?: string;
  legacySpeechCandidatesDirectory?: string;
  curriculumRoot: string;
  bootstrapFile: string;
  secrets: ConnectionSecretStorage;
  loginCredentials: NinaLoginStorage;
  offlineRuntime: OfflineRuntime;
  chooseDirectory: (uiLocale: Language) => Promise<string | undefined>;
  knownInstallRoots: readonly string[];
  chatgpt: ChatgptSession;
  log?: (record: AppServerLogRecord) => void;
  emitEvent?: (event: DesktopIpcEvent) => void;
  openExternal?: (url: string) => Promise<void>;
  exportDiagnostics?: (
    content: string,
  ) => Promise<{ status: "cancelled" } | { status: "exported"; displayName: string }>;
}
export class DesktopEnvironment {
  readonly secrets;
  readonly loginCredentials;
  readonly curriculumRoot;
  readonly bootstrapFile;
  readonly chooseDirectory;
  readonly knownInstallRoots;
  readonly offline;
  readonly speechBundleDirectory;
  readonly developmentSpeechBundlesDirectory;
  readonly legacySpeechCandidatesDirectory;
  readonly chatgpt;
  readonly log;
  readonly emitEvent;
  readonly openExternal;
  readonly exportDiagnostics;
  readonly nina;
  constructor(
    options: DesktopOptions,
    observe: (event: DesktopIpcEvent) => void,
    onAccountChange: () => Promise<void>,
  ) {
    this.secrets = options.secrets;
    this.loginCredentials = options.loginCredentials;
    this.curriculumRoot = options.curriculumRoot;
    this.bootstrapFile = options.bootstrapFile;
    this.chooseDirectory = options.chooseDirectory;
    this.knownInstallRoots = options.knownInstallRoots;
    this.speechBundleDirectory = options.speechBundleDirectory;
    this.developmentSpeechBundlesDirectory = options.developmentSpeechBundlesDirectory;
    this.legacySpeechCandidatesDirectory = options.legacySpeechCandidatesDirectory;
    this.chatgpt = options.chatgpt;
    this.log = options.log;
    this.openExternal = options.openExternal;
    this.exportDiagnostics = options.exportDiagnostics;
    this.offline = options.offlineRuntime;
    this.emitEvent = (event: DesktopIpcEvent) => {
      options.emitEvent?.(event);
      observe(event);
    };
    this.chatgpt.subscribe(this.emitEvent);
    this.nina = new NinaAccount(onAccountChange);
  }
  success<Channel extends DesktopIpcChannel>(
    request: { channel: Channel; requestId: DesktopIpcRequest["requestId"] },
    result: DesktopResultInput<NoInfer<Channel>>,
  ): DesktopIpcResponse {
    return desktopIpcResponseSchema.parse({
      status: "ok",
      channel: request.channel,
      requestId: request.requestId,
      result,
    });
  }
  failure(request: DesktopIpcRequest, kind: ErrorKind): DesktopIpcResponse {
    return desktopIpcResponseSchema.parse({
      status: "error",
      channel: request.channel,
      requestId: request.requestId,
      error: safeError(kind, request.requestId),
    });
  }
  operationLog(
    severity: AppServerLogRecord["severity"],
    code: string,
    correlationId: string,
    reason: string,
    errorCode: string | undefined,
    message: string,
    fields: Readonly<{
      action?: string;
      phase?:
        | "received"
        | "started"
        | "queued"
        | "running"
        | "validating"
        | "persisting"
        | "completed"
        | "cancelled"
        | "failed";
      outcome?: "ok" | "rejected" | "cancelled" | "rate-limited" | "error";
      durationMs?: number;
      metadata?: Readonly<Record<string, string | number | boolean | null>>;
    }> = {},
  ): void {
    try {
      this.log?.({
        timestamp: new Date().toISOString(),
        severity,
        component: "desktop",
        code,
        correlationId: correlationIdSchema.parse(correlationId),
        message,
        ...(fields.action === undefined ? {} : { action: fields.action }),
        ...(fields.phase === undefined ? {} : { phase: fields.phase }),
        ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
        ...(fields.durationMs === undefined ? {} : { durationMs: fields.durationMs }),
        metadata: {
          reason,
          ...(errorCode === undefined ? {} : { code: errorCode }),
          ...(fields.metadata ?? {}),
        },
      });
    } catch {
      // Diagnostic sinks cannot change request handling.
    }
  }
  operationRequestFailure(
    request: DesktopIpcRequest,
    kind: ErrorKind,
    errorCode: string,
    reason: string,
  ): DesktopIpcResponse {
    this.operationLog(
      "warn",
      "DESKTOP_OPERATION_REQUEST_REJECTED",
      request.requestId,
      reason,
      errorCode,
      "Learning operation request was rejected before dispatch.",
      { action: reason, phase: "failed", outcome: "rejected" },
    );
    return this.failure(request, kind);
  }
  providerAccessFailure(
    request: DesktopIpcRequest,
    access: Extract<ProviderAccess, { status: "unavailable" }>,
  ) {
    const kind: ErrorKind =
      access.reason === "account-required" ||
      access.reason === "account-unavailable" ||
      access.reason === "credential-required" ||
      access.reason === "secure-storage-unavailable"
        ? "authentication"
        : access.reason === "model-unavailable"
          ? "model-unavailable"
          : access.reason === "capability-unavailable" || access.reason === "connection-required"
            ? "unsupported-operation"
            : access.reason === "plugin-required"
              ? "mcp"
              : "app-server";
    return this.operationRequestFailure(
      request,
      kind,
      safeError(kind, request.requestId).code,
      access.reason,
    );
  }
  async codexState(correlationId: string) {
    const executable = desktopPathOption("codex-executable");
    const discovery = await discoverCodex(executable === undefined ? {} : { executable });
    if (discovery.status === "available") {
      return readPluginIntegrationState(discovery.version, correlationId);
    }
    const kind =
      discovery.reason === "unsupported-version" ? "unsupported-codex-version" : "app-server";
    return {
      status: "unavailable" as const,
      reason: discovery.reason,
      error: safeError(kind, correlationId),
    };
  }
}
