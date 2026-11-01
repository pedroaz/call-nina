import {
  ninaPublicConfiguration,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import { publishSnapshot, readPublished, SyncError } from "@call-nina/mobile-sync";
import { assertCallNinaDatabaseLease, exportMobileFlashcards } from "@call-nina/persistence";
import { createHash, randomUUID } from "node:crypto";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class MobilePublishing {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "scheduler" | "root" | "assets">;
  #mobilePublishing = false;
  #mobileAbort: AbortController | undefined;
  get #scheduler() {
    return this.#services().scheduler;
  }
  get #root() {
    return this.#services().root;
  }
  get #assets() {
    return this.#services().assets;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "scheduler" | "root" | "assets">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "nina-account/credentials/read"
          | "nina-account/credentials/save"
          | "nina-account/diagnostic"
          | "mobile-sync/publish"
          | "mobile-sync/read"
          | "nina-account/read"
          | "nina-account/update";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "nina-account/credentials/read": {
        try {
          return this.#environment.success(request, {
            available: true,
            credentials: await this.#environment.loginCredentials.read(),
          });
        } catch {
          return this.#environment.success(request, { available: false, credentials: null });
        }
      }
      case "nina-account/credentials/save": {
        try {
          await this.#environment.loginCredentials.save(request.payload);
          return this.#environment.success(request, { saved: true });
        } catch {
          return this.#environment.success(request, { saved: false });
        }
      }
      case "nina-account/diagnostic": {
        const { stage, outcome, reason } = request.payload;
        this.#environment.operationLog(
          outcome === "failed" || outcome === "slow" ? "warn" : "info",
          "NINA_LOGIN_STAGE",
          request.requestId,
          reason,
          undefined,
          "Nina sign-in stage.",
          { action: "nina-account/login", metadata: { stage, status: outcome, reason } },
        );
        return this.#environment.success(request, { recorded: true });
      }
      case "mobile-sync/publish":
      case "mobile-sync/read": {
        const publishing = request.channel === "mobile-sync/publish";
        if (publishing)
          await this.#scheduler.enqueue(() => this.#root.dataRootState(request.requestId));
        if (publishing && this.#mobilePublishing)
          return this.#environment.success(request, { status: "failed", reason: "busy" });
        if (
          !ninaPublicConfiguration.serviceOrigin ||
          this.#environment.nina.state.status !== "signed-in"
        )
          return this.#environment.success(request, { status: "failed", reason: "sign-in" });
        const epoch = this.#environment.nina.epoch;
        const database = this.#root.database;
        if (publishing && !database)
          return this.#environment.success(request, { status: "failed", reason: "changed" });
        const controller = new AbortController();
        if (publishing) {
          this.#mobilePublishing = true;
          this.#mobileAbort = controller;
        }
        try {
          const connection = {
            origin: ninaPublicConfiguration.serviceOrigin,
            token: () => this.#environment.nina.token(epoch),
            hash: (bytes: Uint8Array) =>
              Promise.resolve(createHash("sha256").update(bytes).digest("hex")),
            signal: controller.signal,
            assertCurrent: async () => {
              if (database) await assertCallNinaDatabaseLease(database);
              this.#environment.nina.assert(epoch);
              if (
                controller.signal.aborted ||
                this.#scheduler.closing ||
                database !== this.#root.database ||
                database?.closed
              )
                throw new SyncError("changed");
            },
          };
          const result =
            publishing && database
              ? await publishSnapshot(
                  connection,
                  await exportMobileFlashcards(database),
                  randomUUID(),
                )
              : await readPublished(connection);
          return this.#environment.success(
            request,
            result ? { status: "synced", publishedAt: result.publishedAt } : { status: "empty" },
          );
        } catch (error) {
          return this.#environment.success(request, {
            status: "failed",
            reason:
              error instanceof SyncError && error.reason !== "update-required"
                ? error.reason
                : "unavailable",
          });
        } finally {
          if (publishing) {
            this.#mobilePublishing = false;
            this.#mobileAbort = undefined;
          }
        }
      }
      case "nina-account/read": {
        return this.#environment.success(request, this.#environment.nina.state);
      }
      case "nina-account/update": {
        const previous = JSON.stringify(this.#environment.nina.state);
        const beforeEpoch = this.#environment.nina.epoch;
        const state = await this.#environment.nina.update(
          request.payload.status,
          request.payload.token,
        );
        if (beforeEpoch !== this.#environment.nina.epoch) {
          this.#mobileAbort?.abort();
          this.#assets.speech.stopManaged();
        }
        if (JSON.stringify(state) !== previous) {
          this.#environment.operationLog(
            state.status === "unavailable" || state.status === "expired" ? "warn" : "info",
            "NINA_ACCOUNT_STATE",
            request.requestId,
            "account-sync",
            undefined,
            "Nina account state updated.",
            { action: "nina-account/update", metadata: { status: state.status } },
          );
        }
        if (JSON.stringify(state) !== previous)
          this.#environment.emitEvent({ event: "state-invalidated", scope: "ai-connections" });
        return this.#environment.success(request, state);
      }
    }
  }
  cancel() {
    this.#mobileAbort?.abort();
  }
}
