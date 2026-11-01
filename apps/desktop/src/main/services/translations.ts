import {
  translationRequestSchema,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import { isDirectApiRoute } from "@call-nina/direct-api";
import { readSavedTranslations, validateTranslationReveal } from "@call-nina/persistence";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class TranslationController {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "generation" | "learner" | "providers">;

  get #root() {
    return this.#services().root;
  }
  get #generation() {
    return this.#services().generation;
  }
  get #learner() {
    return this.#services().learner;
  }
  get #providers() {
    return this.#services().providers;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "generation" | "learner" | "providers">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "translation/flashcard-visibility"
          | "translation/read"
          | "translation/start"
          | "translation/cancel";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "translation/flashcard-visibility": {
        const root = await this.#root.dataRootState(request.requestId);
        if (
          root.status !== "ready" ||
          root.generation !== request.payload.rootGeneration ||
          !this.#root.database
        )
          return this.#environment.failure(request, "stale-data-root");
        if (request.payload.visible) {
          await validateTranslationReveal(this.#root.database, request.payload);
          // Only the currently displayed back is authorized; a new flip revokes old capabilities.
          this.#generation.translations.clearReveals();
          this.#generation.translations.reveal(request.payload);
        } else this.#generation.translations.hide(request.payload.revealId);
        return this.#environment.success(request, { visible: request.payload.visible });
      }
      case "translation/read":
      case "translation/start": {
        const root = await this.#root.dataRootState(request.requestId);
        if (
          root.status !== "ready" ||
          root.generation !== request.payload.rootGeneration ||
          !this.#root.database ||
          !this.#root.repository
        )
          return this.#environment.failure(request, "stale-data-root");
        const database = this.#root.database;
        const source = await readSavedTranslations(
          database,
          translationRequestSchema.parse({
            rootGeneration: request.payload.rootGeneration,
            activityId: request.payload.activityId,
            content: request.payload.content,
            field: request.payload.field,
          }),
          this.#generation.translations.translationReveal(request.payload),
        );
        if (request.channel === "translation/read")
          return this.#environment.success(request, { translations: source.translations });
        if (source.translations.some((item) => item.language === request.payload.language))
          return this.#environment.success(request, {
            operationId: request.payload.operationId,
            status: "saved",
          });
        if (
          this.#generation.translations.pendingCount > 0 ||
          this.#generation.operations.isActive(request.payload.operationId)
        )
          return this.#environment.failure(request, "conflict");
        if (!(await this.#learner.hasAcknowledgedAiDisclosure()))
          return this.#environment.failure(request, "validation");
        const settings = await this.#root.repository.readLearnerSettingsForScope(
          source.learningScope,
        );
        const access = await this.#providers.providerAccess("translation", request.requestId);
        if (access.status === "unavailable")
          return this.#environment.providerAccessFailure(request, access);
        if (
          (isDirectApiRoute(access.routeId) || access.routeId === "managed") &&
          this.#generation.operations.activeCount >= 4
        )
          return this.#environment.failure(request, "conflict");
        if (!access.modelSelection)
          return this.#environment.failure(request, "unsupported-operation");
        const connection = await this.#providers.requireRoutedConnection("translation");
        this.#generation.operations.activate(request.payload.operationId);
        this.#generation.translations.start(
          request.payload,
          database,
          source,
          settings.learningContext,
          {
            model: { selection: "exact", modelId: access.modelSelection.modelId },
            effort:
              access.routeId === "managed"
                ? { selection: "runtime-default" }
                : { selection: "exact", effortId: access.modelSelection.effortId },
          },
          connection,
        );
        return this.#environment.success(request, {
          operationId: request.payload.operationId,
          status: "accepted",
        });
      }
      case "translation/cancel": {
        const generation = this.#generation.translations.rootGeneration(
          request.payload.operationId,
        );
        if (generation !== undefined && generation !== request.payload.rootGeneration)
          return this.#environment.failure(request, "stale-data-root");
        const found = generation !== undefined;
        if (found) await this.#generation.translations.cancel(request.payload.operationId);
        return this.#environment.success(request, {
          status: found ? "cancelling" : "already-finished",
        });
      }
    }
  }
}
