import {
  aiConnectionsViewSchema,
  routedProvider,
  type AiAction,
  type AiConnection,
  type ProviderAccess,
  type ProviderOperation,
} from "@call-nina/contracts";
import {
  directApiCatalog,
  directApiCatalogs,
  directApiSelection,
  isDirectApiRoute,
} from "@call-nina/direct-api";
import { resolveModelPreference } from "@call-nina/domain";
import { managedCatalog } from "@call-nina/managed-generation/service";
import { offlineCatalog, offlineSelection } from "@call-nina/offline-runtime";
import { readAiConnections } from "@call-nina/persistence";
import { type AcceptedOperation } from "../backend-support.js";
import { cleanupConnectionSecrets, type ConnectionView } from "../connection-settings.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import { ConnectionRuntime } from "./connection-runtime.js";
import type { CodexIntegration, DesktopServices } from "./desktop-services.js";

export class ProviderAccessService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "generation" | "scheduler">;
  readonly #connections: ConnectionRuntime;
  get #root() {
    return this.#services().root;
  }
  get #generation() {
    return this.#services().generation;
  }
  get #scheduler() {
    return this.#services().scheduler;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "generation" | "scheduler">,
  ) {
    this.#environment = environment;
    this.#services = services;
    this.#connections = new ConnectionRuntime({
      database: () => this.#root.database,
      closing: () => this.#scheduler.closing,
      chatgpt: this.#environment.chatgpt,
      nina: this.#environment.nina,
      offline: this.#environment.offline,
      secrets: this.#environment.secrets,
      connectionById: (id) => this.connectionById(id),
      projectGenerationEvent: (event) => {
        this.#generation.projectEvent(event);
      },
      operationLog: (...args) => {
        this.#environment.operationLog(...args);
      },
    });
  }
  async connectionById(id: string): Promise<AiConnection> {
    if (!this.#root.database) throw new Error("OD_DATA_ROOT_STALE");
    const settings = await readAiConnections(this.#root.database);
    const connection = settings.connections.find((entry) => entry.id === id);
    if (!connection) throw new Error("OD_CONNECTION_NOT_FOUND");
    return connection;
  }

  async routedConnection(action: AiAction, image = false): Promise<AiConnection | undefined> {
    if (!this.#root.database) return undefined;
    const settings = await readAiConnections(this.#root.database);
    const route = routedProvider(settings.routing, action, image ? "image" : "text");
    return settings.connections.find((entry) => entry.routeId === route);
  }

  async requireRoutedConnection(action: AiAction, image = false): Promise<AiConnection> {
    const connection = await this.routedConnection(action, image);
    if (!connection) throw new Error("OD_CONNECTION_NOT_FOUND");
    return connection;
  }

  async connectionsView(): Promise<ConnectionView> {
    if (!this.#root.database) throw new Error("OD_DATA_ROOT_STALE");
    const settings = await cleanupConnectionSecrets(
      this.#root.database,
      this.#environment.secrets,
      await readAiConnections(this.#root.database),
    );
    const availability: ConnectionView["availability"] = [];
    const offlineSnapshot = await this.#environment.offline.inspect();
    for (const connection of settings.connections) {
      const entry: ConnectionView["availability"][number] = {
        connectionId: connection.id,
        status: "adapter-unavailable",
        operations: [],
        languages: [],
        models: null,
      };
      if (connection.routeId === "chatgpt") {
        entry.status = "account-required";
        {
          if (this.#environment.secrets.state().status !== "available")
            entry.status = "secure-storage-unavailable";
          else
            try {
              if (
                (await this.#environment.chatgpt.account()).status === "signed-in" &&
                !this.#environment.chatgpt.pendingLoginId
              ) {
                entry.models = await this.#environment.chatgpt.models();
                entry.operations = [
                  "writing-prompt",
                  "voice-activity-draft",
                  "writing-correction",
                  "contextual-help",
                  "vocabulary-analysis",
                  "flashcard-generation",
                  "exercise-generation",
                  "exercise-feedback",
                ];
                entry.languages = ["en-US", "pt-BR", "es", "de"];
                entry.status =
                  resolveModelPreference(connection.preference, entry.models).status === "available"
                    ? "available"
                    : "model-unavailable";
              }
            } catch {
              entry.status = "model-unavailable";
            }
        }
      }
      if (isDirectApiRoute(connection.routeId)) {
        const catalog = directApiCatalog(connection.routeId);
        entry.models = catalog.models;
        entry.operations = catalog.operations;
        entry.languages = catalog.languages;
        entry.status =
          this.#environment.secrets.state().status !== "available"
            ? "secure-storage-unavailable"
            : !connection.secretRef
              ? "credential-required"
              : resolveModelPreference(connection.preference, catalog.models).status !== "available"
                ? "model-unavailable"
                : "configured";
      }
      if (connection.routeId === "local") {
        const catalog = offlineCatalog();
        const snapshot = offlineSnapshot;
        entry.models = catalog.models;
        entry.operations = catalog.operations;
        entry.languages = catalog.languages;
        entry.status =
          (snapshot.state !== "installed" && snapshot.state !== "generating") ||
          snapshot.preflight?.generationEligibility !== "ready"
            ? "runtime-unavailable"
            : resolveModelPreference(connection.preference, catalog.models).status !== "available"
              ? "model-unavailable"
              : "configured";
      }
      if (connection.routeId === "managed") {
        entry.status = "runtime-unavailable";
        const catalog = managedCatalog();
        if (catalog) {
          entry.models = catalog.models;
          entry.operations = catalog.operations;
          entry.languages = [...catalog.languages];
          entry.status =
            this.#environment.nina.state.status !== "signed-in"
              ? "account-required"
              : !this.#environment.nina.state.access?.hostedAiEnabled ||
                  this.#environment.nina.state.access.remainingActions <= 0 ||
                  !this.#environment.nina.state.access.inferenceEnabled
                ? "runtime-unavailable"
                : resolveModelPreference(connection.preference, catalog.models).status ===
                    "available"
                  ? "configured"
                  : "model-unavailable";
        }
      }
      availability.push(entry);
    }
    return aiConnectionsViewSchema.parse({
      expectedGeneration: this.#root.database.rootGeneration,
      settings,
      secureStorage: this.#environment.secrets.state(),
      directApiCatalogs: directApiCatalogs(),
      offlineModel: { catalog: offlineCatalog(), snapshot: offlineSnapshot },
      availability,
    });
  }

  async providerAccess(
    operation: ProviderOperation,
    correlationId: string,
    retainedSelection?: AcceptedOperation["operation"]["modelSelection"],
    retainedConnection?: AiConnection,
    integrationState?: CodexIntegration,
    hasImage = false,
  ): Promise<ProviderAccess> {
    const connection = retainedConnection
      ? await this.connectionById(retainedConnection.id).catch(() => undefined)
      : operation === "voice-handoff"
        ? undefined
        : await this.routedConnection(operation, hasImage);
    const generationKind = operation === "translation" ? "contextual-help" : operation;
    const configuredRoute =
      connection?.routeId ??
      (this.#root.database && operation !== "voice-handoff"
        ? routedProvider(
            (await readAiConnections(this.#root.database)).routing,
            operation,
            hasImage ? "image" : "text",
          )
        : null);
    const unavailable = (
      reason: Extract<ProviderAccess, { status: "unavailable" }>["reason"],
    ): ProviderAccess => ({
      routeId: configuredRoute,
      operation,
      status: "unavailable",
      reason,
    });
    if (operation === "voice-handoff") {
      if (
        !this.#root.database ||
        (await readAiConnections(this.#root.database)).routing.liveConversation !== "codex"
      )
        return unavailable("capability-unavailable");
      if (!this.#environment.openExternal) return unavailable("capability-unavailable");
      const integration = integrationState ?? (await this.#environment.codexState(correlationId));
      if (integration.status !== "available") return unavailable("integration-unavailable");
      if (integration.plugin !== "installed") return unavailable("plugin-required");
      return {
        routeId: connection?.routeId ?? "chatgpt",
        operation,
        status: "available",
        modelSelection: null,
      };
    }
    if (!connection) return unavailable("connection-required");
    if (hasImage && connection.routeId !== "chatgpt") return unavailable("capability-unavailable");
    if (
      retainedConnection &&
      (connection.id !== retainedConnection.id ||
        connection.routeId !== retainedConnection.routeId ||
        connection.secretRef !== retainedConnection.secretRef)
    )
      return unavailable("capability-unavailable");
    if (isDirectApiRoute(connection.routeId)) {
      const catalog = directApiCatalog(connection.routeId);
      if (!catalog.operations.some((kind) => kind === generationKind))
        return unavailable("capability-unavailable");
      if (this.#environment.secrets.state().status !== "available")
        return unavailable("secure-storage-unavailable");
      if (!connection.secretRef) return unavailable("credential-required");
      try {
        const resolution = retainedSelection
          ? directApiSelection(connection.routeId, retainedSelection)
          : resolveModelPreference(connection.preference, catalog.models);
        if ("status" in resolution) {
          if (resolution.status !== "available") return unavailable("model-unavailable");
          return {
            routeId: connection.routeId,
            operation,
            status: "available",
            modelSelection: {
              modelId: resolution.effectiveModelId,
              effortId: resolution.effectiveEffortId,
            },
          };
        }
        return {
          routeId: connection.routeId,
          operation,
          status: "available",
          modelSelection: resolution,
        };
      } catch {
        return unavailable("model-unavailable");
      }
    }
    if (connection.routeId === "local") {
      const catalog = offlineCatalog();
      if (!catalog.operations.some((supported) => supported === generationKind))
        return unavailable("capability-unavailable");
      const snapshot = await this.#environment.offline.inspect();
      if (
        (snapshot.state !== "installed" && snapshot.state !== "generating") ||
        snapshot.preflight?.generationEligibility !== "ready"
      )
        return unavailable("runtime-unavailable");
      try {
        if (retainedSelection)
          return {
            routeId: "local",
            operation,
            status: "available",
            modelSelection: offlineSelection(retainedSelection),
          };
        const resolution = resolveModelPreference(connection.preference, catalog.models);
        if (resolution.status !== "available") return unavailable("model-unavailable");
        return {
          routeId: "local",
          operation,
          status: "available",
          modelSelection: {
            modelId: resolution.effectiveModelId,
            effortId: resolution.effectiveEffortId,
          },
        };
      } catch {
        return unavailable("model-unavailable");
      }
    }
    if (connection.routeId === "managed") {
      if (this.#environment.nina.state.status !== "signed-in")
        return unavailable("account-required");
      if (
        !this.#environment.nina.state.access?.hostedAiEnabled ||
        this.#environment.nina.state.access.remainingActions <= 0
      )
        return unavailable("account-unavailable");
      if (!this.#environment.nina.state.access.inferenceEnabled)
        return unavailable("runtime-unavailable");
      const catalog = managedCatalog();
      if (!catalog) return unavailable("runtime-unavailable");
      if (!catalog.operations.some((kind) => kind === generationKind))
        return unavailable("capability-unavailable");
      if (retainedSelection) {
        if (
          retainedSelection.model.selection !== "exact" ||
          retainedSelection.model.modelId !== catalog.models.runtimeDefaultModelId ||
          retainedSelection.effort.selection !== "runtime-default"
        )
          return unavailable("model-unavailable");
        return {
          routeId: "managed",
          operation,
          status: "available",
          modelSelection: { modelId: retainedSelection.model.modelId, effortId: "runtime-default" },
        };
      }
      const resolution = resolveModelPreference(connection.preference, catalog.models);
      if (resolution.status !== "available") return unavailable("model-unavailable");
      return {
        routeId: "managed",
        operation,
        status: "available",
        modelSelection: {
          modelId: resolution.effectiveModelId,
          effortId: resolution.effectiveEffortId,
        },
      };
    }
    if (connection.routeId !== "chatgpt") return unavailable("capability-unavailable");
    if (this.#environment.secrets.state().status !== "available")
      return unavailable("secure-storage-unavailable");
    if (this.#environment.chatgpt.pendingLoginId) return unavailable("account-unavailable");
    const account = await this.#environment.chatgpt.account();
    if (account.status === "signed-out" || account.status === "expired")
      return unavailable("account-required");
    if (account.status !== "signed-in") return unavailable("account-unavailable");
    try {
      const catalog = await this.#environment.chatgpt.models();
      if (hasImage) {
        const modelId =
          retainedSelection?.model.selection === "exact"
            ? retainedSelection.model.modelId
            : connection.preference.model.mode === "exact"
              ? connection.preference.model.modelId
              : catalog.runtimeDefaultModelId;
        if (
          !catalog.models.find((entry) => entry.id === modelId)?.inputModalities.includes("image")
        )
          return unavailable("capability-unavailable");
      }
      // Retry retains the original model/effort and never silently changes it.
      if (retainedSelection) {
        const model = retainedSelection.model;
        const effort = retainedSelection.effort;
        if (model.selection !== "exact" || effort.selection !== "exact")
          return unavailable("model-unavailable");
        const entry = catalog.models.find(({ id }) => id === model.modelId);
        if (
          !entry?.inputModalities.includes("text") ||
          !entry.supportedReasoningEfforts.includes(effort.effortId)
        )
          return unavailable("model-unavailable");
        return {
          routeId: connection.routeId,
          operation,
          status: "available",
          modelSelection: { modelId: model.modelId, effortId: effort.effortId },
        };
      }
      const resolution = resolveModelPreference(connection.preference, catalog);
      if (
        resolution.status === "unavailable" ||
        !catalog.models
          .find(({ id }) => id === resolution.effectiveModelId)
          ?.inputModalities.includes("text")
      )
        return unavailable("model-unavailable");
      return {
        routeId: connection.routeId,
        operation,
        status: "available",
        modelSelection: {
          modelId: resolution.effectiveModelId,
          effortId: resolution.effectiveEffortId,
        },
      };
    } catch {
      return unavailable("model-unavailable");
    }
  }

  get connections() {
    return this.#connections;
  }
}
