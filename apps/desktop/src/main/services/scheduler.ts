import { type DesktopIpcRequest, type DesktopIpcResponse } from "@call-nina/contracts";
import { safeError, semanticAction } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

function bypassesLearnerQueue(channel: DesktopIpcRequest["channel"]): boolean {
  return (
    channel.startsWith("speech/") ||
    channel === "material/import-web" ||
    channel === "mobile-sync/publish" ||
    channel === "mobile-sync/read" ||
    channel === "nina-account/read" ||
    channel === "nina-account/update" ||
    channel === "nina-account/diagnostic" ||
    channel === "nina-account/credentials/read" ||
    channel === "nina-account/credentials/save"
  );
}
export class RequestScheduler {
  get #dispatcher() {
    return this.#services().dispatcher;
  }
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "dispatcher" | "imports">;
  #requestQueue: Promise<void> = Promise.resolve();
  #closing = false;

  get #imports() {
    return this.#services().imports;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "dispatcher" | "imports">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  enqueue<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.#requestQueue.then(work);
    this.#requestQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async handleLoggedRequest(request: DesktopIpcRequest): Promise<DesktopIpcResponse> {
    if (this.#closing) return this.#environment.failure(request, "cancellation");
    const action = semanticAction(request.channel);
    const startedAt = Date.now();
    if (action) {
      this.#environment.operationLog(
        "debug",
        "DESKTOP_ACTION_STARTED",
        request.requestId,
        action,
        undefined,
        "Desktop action started.",
        { action, phase: "started" },
      );
    }
    // External discovery must settle outside the learner-data queue. Validate
    // local state only after re-entering the queue, including Voice root leases.
    const needsIntegration =
      request.channel === "app/readiness" ||
      request.channel === "codex/integration/read" ||
      request.channel === "voice-activity/open-in-codex" ||
      (request.channel === "provider/access/read" && request.payload.operation === "voice-handoff");
    const integration = needsIntegration
      ? await this.#environment.codexState(request.requestId).catch(() => ({
          status: "unavailable" as const,
          reason: "app-server-unavailable" as const,
          error: safeError("app-server", request.requestId),
        }))
      : undefined;
    const response: DesktopIpcResponse = await this.enqueue(
      async (): Promise<DesktopIpcResponse> => {
        if (this.#closing) return this.#environment.failure(request, "cancellation");
        return this.#dispatcher.dispatch(request, integration);
      },
    );
    if (action) {
      const cancelled =
        response.status === "ok" &&
        typeof response.result === "object" &&
        "status" in response.result &&
        response.result.status === "cancelled";
      const errorCode = response.status === "error" ? response.error.reference.code : undefined;
      this.#environment.operationLog(
        response.status === "ok"
          ? /\/(?:read|list|status|snapshot|readiness)$/u.test(action) ||
            action === "learning-operation/start"
            ? "debug"
            : "info"
          : response.error.kind === "validation" || response.error.kind === "conflict"
            ? "warn"
            : "error",
        response.status === "error"
          ? "DESKTOP_ACTION_FAILED"
          : cancelled
            ? "DESKTOP_ACTION_CANCELLED"
            : "DESKTOP_ACTION_COMPLETED",
        request.requestId,
        action,
        errorCode,
        response.status === "error"
          ? "Desktop action failed."
          : cancelled
            ? "Desktop action cancelled."
            : "Desktop action completed.",
        {
          action,
          phase: response.status === "error" ? "failed" : cancelled ? "cancelled" : "completed",
          outcome: response.status === "error" ? "error" : cancelled ? "cancelled" : "ok",
          durationMs: Date.now() - startedAt,
        },
      );
    }
    return response;
  }

  async handle(request: DesktopIpcRequest): Promise<DesktopIpcResponse> {
    if (request.channel === "material/import-web") return this.#imports.captureWebsite(request);
    if (request.channel === "material/cancel-import") {
      return this.#environment.success(request, {
        cancelled: this.#imports.cancel(request.payload.importId),
      });
    }
    // Account network calls have their own serialized queue and cannot stall local learning.
    if (bypassesLearnerQueue(request.channel)) {
      if (this.#closing) return this.#environment.failure(request, "cancellation");
      return this.#dispatcher.dispatch(request);
    }
    return this.handleLoggedRequest(request);
  }
  get closing() {
    return this.#closing;
  }
  beginShutdown() {
    this.#closing = true;
  }
}
