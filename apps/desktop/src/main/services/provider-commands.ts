import {
  type AiConnection,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import { providerSupports, recommendedRouting, resolveModelPreference } from "@call-nina/domain";
import { offlineCatalog } from "@call-nina/offline-runtime";
import { readAiConnections } from "@call-nina/persistence";
import { type AcceptedOperation } from "../backend-support.js";
import { mutateConnections } from "../connection-settings.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import { runPluginIntegrationAction } from "../plugin-integration.js";
import type { CodexIntegration, DesktopServices } from "./desktop-services.js";

export class ProviderCommands {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "generation" | "providers">;
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "generation" | "providers">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  get #root() {
    return this.#services().root;
  }
  get #generation() {
    return this.#services().generation;
  }

  get #providers() {
    return this.#services().providers;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "offline-model/read"
          | "offline-model/manage"
          | "ai-connections/read"
          | "ai-connections/update"
          | "provider/access/read"
          | "codex/integration/read"
          | "codex/integration/action"
          | "chatgpt/usage/open"
          | "chatgpt/account/read"
          | "chatgpt/accounts/read"
          | "chatgpt/account/logout"
          | "chatgpt/account/login/start"
          | "chatgpt/account/login/cancel"
          | "chatgpt/models/read";
      }
    >,
    integration?: CodexIntegration,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "offline-model/read":
      case "offline-model/manage": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready") return this.#environment.failure(request, "stale-data-root");
        if (request.channel === "offline-model/manage") {
          if (
            request.payload.action !== "cancel" &&
            (this.#generation.operations.activeCount > 0 ||
              this.#generation.translations.pendingCount > 0)
          )
            return this.#environment.failure(request, "conflict");
          if (request.payload.action === "install") this.#environment.offline.install();
          else if (request.payload.action === "cancel")
            await this.#environment.offline.cancelDownload();
          else await this.#environment.offline.remove();
          this.#environment.emitEvent({ event: "state-invalidated", scope: "ai-connections" });
        }
        return this.#environment.success(request, {
          catalog: offlineCatalog(),
          snapshot: await this.#environment.offline.inspect(),
        });
      }
      case "ai-connections/read":
      case "ai-connections/update": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready" || !this.#root.database)
          return this.#environment.failure(request, "stale-data-root");
        if (request.channel === "ai-connections/update") {
          let mutation = request.payload;
          if (mutation.action.kind === "recommend") {
            const view = await this.#providers.connectionsView();
            for (const connection of view.settings.connections) {
              connection.preference = {
                model: { mode: "automatic" },
                effort: { mode: "semantic", effort: "balanced" },
              };
              const state = view.availability.find((entry) => entry.connectionId === connection.id);
              if (
                state?.status === "model-unavailable" &&
                state.models &&
                resolveModelPreference(connection.preference, state.models).status === "available"
              )
                state.status = "configured";
            }
            mutation = {
              ...mutation,
              action: {
                kind: "routing",
                routing: recommendedRouting(view),
                resetModelDefaults: true,
              },
            };
            // Recommendations reset model choices atomically in the mutation owner.
          }
          if (
            request.payload.action.kind !== "routing" &&
            request.payload.action.kind !== "recommend" &&
            (this.#generation.operations.activeCount > 0 ||
              this.#generation.translations.pendingCount > 0)
          )
            return this.#environment.failure(request, "conflict");
          if (mutation.action.kind === "routing") {
            const view = await this.#providers.connectionsView();
            const next = mutation.action.routing;
            const previous = view.settings.routing;
            const assignments = [
              { route: next.text, prior: previous.text, capability: "text" as const },
              { route: next.image, prior: previous.image, capability: "image" as const },
              ...Object.entries(next.actions).map(([action, route]) => ({
                route,
                prior: previous.actions[action as keyof typeof previous.actions],
                capability: "text" as const,
              })),
            ];
            for (const assignment of assignments) {
              if (!assignment.route || assignment.route === assignment.prior) continue;
              const connection = view.settings.connections.find(
                (entry) => entry.routeId === assignment.route,
              );
              const status = view.availability.find(
                (entry) => entry.connectionId === connection?.id,
              )?.status;
              if (
                !connection ||
                (status !== "available" && status !== "configured") ||
                !providerSupports(view, connection, assignment.capability)
              )
                return this.#environment.failure(request, "conflict");
            }
          }
          await mutateConnections(
            this.#root.database,
            this.#environment.secrets,
            mutation,
            async () => {},
          );
          this.#environment.emitEvent({ event: "state-invalidated", scope: "ai-connections" });
        }
        return this.#environment.success(request, await this.#providers.connectionsView());
      }
      case "provider/access/read": {
        let retainedSelection: AcceptedOperation["operation"]["modelSelection"] | undefined;
        let retainedConnection: AiConnection | undefined;
        let hasImage = request.payload.hasImage ?? false;
        if (request.payload.previousOperationId) {
          const dataRoot = await this.#root.dataRootState(request.requestId);
          if (dataRoot.status !== "ready")
            return this.#environment.failure(request, "stale-data-root");
          const prior = this.#generation.operations.findSubmission(
            ({ operationId }) => operationId === request.payload.previousOperationId,
          );
          if (!prior) return this.#environment.failure(request, "not-found");
          if (prior.dataRootGeneration !== dataRoot.generation)
            return this.#environment.failure(request, "stale-data-root");
          if (
            prior.operation.input.kind !== request.payload.operation ||
            !this.#generation.operations.canRetry(prior.operationId)
          )
            return this.#environment.failure(request, "conflict");
          // Resolve retry access from main-owned state, never the current sidebar preference.
          retainedSelection = prior.operation.modelSelection;
          retainedConnection = prior.connection;
          hasImage = prior.operation.capability === "image";
        }
        return this.#environment.success(
          request,
          await this.#providers.providerAccess(
            request.payload.operation,
            request.requestId,
            retainedSelection,
            retainedConnection,
            integration,
            hasImage,
          ),
        );
      }
      case "codex/integration/read": {
        return this.#environment.success(
          request,
          integration ?? (await this.#environment.codexState(request.requestId)),
        );
      }
      case "codex/integration/action": {
        const current = await this.#environment.codexState(request.requestId);
        if (current.status !== "available") return this.#environment.failure(request, "app-server");
        return this.#environment.success(
          request,
          await runPluginIntegrationAction(
            request.payload.action,
            current.codexVersion,
            request.requestId,
          ),
        );
      }
      case "chatgpt/usage/open": {
        if (!this.#environment.openExternal)
          return this.#environment.failure(request, "app-server");
        await this.#environment.openExternal("https://chatgpt.com/settings/usage");
        return this.#environment.success(request, { status: "opened" });
      }
      case "chatgpt/account/read": {
        return this.#environment.success(request, await this.#environment.chatgpt.account());
      }
      case "chatgpt/accounts/read": {
        return this.#environment.success(request, await this.#environment.chatgpt.accounts());
      }
      case "chatgpt/account/logout": {
        if (
          this.#generation.operations.activeCount > 0 ||
          this.#generation.translations.pendingCount > 0
        )
          return this.#environment.failure(request, "conflict");
        return this.#environment.success(request, await this.#environment.chatgpt.logout());
      }
      case "chatgpt/account/login/start": {
        if (
          this.#generation.operations.activeCount > 0 ||
          this.#generation.translations.pendingCount > 0
        )
          return this.#environment.failure(request, "conflict");
        // Sign-in creates the provider configuration if needed; routing remains an explicit Settings choice.
        if (!this.#root.database) return this.#environment.failure(request, "stale-data-root");
        const connections = await readAiConnections(this.#root.database);
        let connection = connections.connections.find((entry) => entry.routeId === "chatgpt");
        if (!connection) {
          const created = await mutateConnections(
            this.#root.database,
            this.#environment.secrets,
            {
              expectedGeneration: this.#root.database.rootGeneration,
              expectedRevision: connections.revision,
              action: {
                kind: "save",
                connection: {
                  id: crypto.randomUUID(),
                  label: "ChatGPT",
                  routeId: "chatgpt",
                  preference: {
                    model: { mode: "automatic" },
                    effort: { mode: "semantic", effort: "balanced" },
                  },
                },
                credential: { action: "keep" },
              },
            },
            async () => this.#providers.connections.stopConnectionRuntime(),
          );
          connection = created.connections.find((entry) => entry.routeId === "chatgpt");
        }
        const loginId = await this.#environment.chatgpt.startLogin(
          request.payload.registrationId,
          request.payload.uiLocale,
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "ai-connections" });
        return this.#environment.success(request, { loginId, status: "started" });
      }
      case "chatgpt/account/login/cancel": {
        const cancelled = this.#environment.chatgpt.cancelLogin(request.payload.loginId);
        return this.#environment.success(request, {
          loginId: request.payload.loginId,
          status: cancelled ? "cancelled" : "already-finished",
        });
      }
      case "chatgpt/models/read": {
        return this.#environment.success(request, await this.#environment.chatgpt.models());
      }
    }
  }
}
