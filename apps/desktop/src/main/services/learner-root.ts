import {
  dataRootGenerationSchema,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import {
  assertCallNinaDatabaseLease,
  CallNinaRepository,
  initializeCallNinaDataRoot,
  inspectDataRootChoice,
  openCallNinaDatabase,
  readBootstrapPointer,
  recoverCallNinaDataRoot,
  switchCallNinaDataRoot,
  type CallNinaDatabase,
} from "@call-nina/persistence";
import { safeError, selectionId, type PendingSelection } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { CodexIntegration, DesktopServices } from "./desktop-services.js";

export class LearnerRoot {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<
    DesktopServices,
    "mobile" | "assets" | "vocabulary" | "generation" | "providers"
  >;
  #database: CallNinaDatabase | undefined;
  #repository: CallNinaRepository | undefined;
  #rootSwitching = false;
  readonly #pending = new Map<string, PendingSelection>();
  get #mobile() {
    return this.#services().mobile;
  }
  get #assets() {
    return this.#services().assets;
  }
  get #vocabulary() {
    return this.#services().vocabulary;
  }
  get #generation() {
    return this.#services().generation;
  }
  get #providers() {
    return this.#services().providers;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<
      DesktopServices,
      "mobile" | "assets" | "vocabulary" | "generation" | "providers"
    >,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async dataRootState(correlationId: string) {
    if (this.#rootSwitching)
      return {
        status: "unavailable" as const,
        reason: "database-busy" as const,
        error: safeError("data-root-busy", correlationId),
      };
    const state = await readBootstrapPointer(this.#environment.bootstrapFile);
    if (state.status === "unconfigured") return { status: "unconfigured" as const };
    if (state.status !== "ready") {
      const kind =
        state.status === "generation-mismatch"
          ? "stale-data-root"
          : state.status === "target-unavailable"
            ? "not-found"
            : "validation";
      const reason =
        state.status === "generation-mismatch"
          ? "stale"
          : state.status === "target-unavailable"
            ? "missing"
            : "invalid";
      return { status: "unavailable", reason, error: safeError(kind, correlationId) } as const;
    }
    try {
      if (
        !this.#database ||
        this.#database.closed ||
        this.#database.rootGeneration !== state.rootGeneration
      ) {
        this.#mobile.cancel();
        this.#assets.speech.resetRoot();
        this.#database?.close();
        this.#database = await openCallNinaDatabase({
          bootstrapFile: this.#environment.bootstrapFile,
          dataRoot: state.dataRoot,
          rootGeneration: state.rootGeneration,
        });
        this.#repository = new CallNinaRepository(this.#database);
      }
      await this.#assets.bindStorage(state.dataRoot);
      this.#vocabulary.scheduleVocabulary();
      return {
        status: "ready" as const,
        generation: state.rootGeneration,
        displayName: state.dataRoot,
        warnings: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const kind = message.includes("STALE") ? "stale-data-root" : "database";
      const reason = message.includes("STALE")
        ? "stale"
        : message.includes("SCHEMA_NEWER")
          ? "schema-newer"
          : message.includes("BUSY")
            ? "database-busy"
            : "database-failed";
      return { status: "unavailable", reason, error: safeError(kind, correlationId) } as const;
    }
  }

  async handle(
    request: Extract<
      DesktopIpcRequest,
      { channel: "app/readiness" | "data-root/read" | "data-root/choose" | "data-root/confirm" }
    >,
    integration?: CodexIntegration,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "app/readiness": {
        const dataRoot = await this.dataRootState(request.requestId);
        return this.#environment.success(request, {
          status: dataRoot.status === "ready" ? "ready" : "degraded",
          dataRoot,
          codex: integration ?? (await this.#environment.codexState(request.requestId)),
        });
      }
      case "data-root/read": {
        return this.#environment.success(request, await this.dataRootState(request.requestId));
      }
      case "data-root/choose": {
        const current = await this.dataRootState(request.requestId);
        const chosen = await this.#environment.chooseDirectory();
        if (!chosen) return this.#environment.success(request, { status: "cancelled" });
        const plan = await inspectDataRootChoice(chosen, {
          knownInstallRoots: this.#environment.knownInstallRoots,
        });
        const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
        const pointerGeneration = "rootGeneration" in pointer ? pointer.rootGeneration : null;
        const expectedGeneration =
          current.status === "ready" ? current.generation : pointerGeneration;
        const mode =
          expectedGeneration === null
            ? "initialize"
            : this.#database && !this.#database.closed
              ? "switch"
              : "recover";
        const id = selectionId();
        this.#pending.clear();
        this.#pending.set(id, { plan, expectedGeneration, mode });
        return this.#environment.success(request, {
          status: "selected",
          selectionId: id,
          generation: dataRootGenerationSchema.parse((expectedGeneration ?? 0) + 1),
          displayName: plan.dataRoot,
          warnings: plan.warnings,
        });
      }
      case "data-root/confirm": {
        if (this.#rootSwitching) return this.#environment.failure(request, "data-root-busy");
        this.#mobile.cancel();
        if (this.#generation.operations.activeCount > 0)
          return this.#environment.failure(request, "data-root-busy");
        const pending = this.#pending.get(request.payload.selectionId);
        if (!pending) return this.#environment.failure(request, "conflict");
        this.#rootSwitching = true;
        try {
          this.#assets.invalidate();
          this.#environment.offline.suspend();
          await this.#providers.connections.stopConnectionRuntime();
          await this.#assets.speech.close();
          this.#pending.delete(request.payload.selectionId);
          const timestamp = new Date().toISOString();
          if (pending.mode === "initialize") {
            this.#database = await initializeCallNinaDataRoot({
              bootstrapFile: this.#environment.bootstrapFile,
              selection: pending.plan,
              selectedAt: timestamp,
              createdAt: timestamp,
            });
          } else if (pending.mode === "switch") {
            if (!this.#database) return this.#environment.failure(request, "stale-data-root");
            this.#database = await switchCallNinaDataRoot({
              currentDatabase: this.#database,
              bootstrapFile: this.#environment.bootstrapFile,
              nextSelection: pending.plan,
              expectedGeneration: dataRootGenerationSchema.parse(pending.expectedGeneration),
              selectedAt: timestamp,
              createdAt: timestamp,
            });
          } else {
            if (pending.expectedGeneration === null)
              return this.#environment.failure(request, "conflict");
            this.#database = await recoverCallNinaDataRoot({
              bootstrapFile: this.#environment.bootstrapFile,
              nextSelection: pending.plan,
              expectedGeneration: dataRootGenerationSchema.parse(pending.expectedGeneration),
              selectedAt: timestamp,
              createdAt: timestamp,
            });
          }
          this.#repository = new CallNinaRepository(this.#database);
          this.#generation.operations.resetRetained();
          this.#generation.translations.clearReveals();
          this.#rootSwitching = false;
          const state = await this.dataRootState(request.requestId);
          if (state.status === "ready") {
            this.#environment.emitEvent({
              event: "data-root-changed",
              generation: state.generation,
              displayName: state.displayName,
            });
          }
          return this.#environment.success(request, state);
        } finally {
          this.#rootSwitching = false;
        }
      }
    }
  }
  get database() {
    return this.#database;
  }
  get repository() {
    return this.#repository;
  }
  get rootSwitching() {
    return this.#rootSwitching;
  }
  close() {
    this.#database?.close();
    this.#database = undefined;
    this.#repository = undefined;
    this.#pending.clear();
  }
  isCurrent(database: CallNinaDatabase) {
    return database === this.#database && !database.closed;
  }
  capture() {
    const database = this.#database,
      repository = this.#repository;
    if (!database || !repository) throw new Error("OD_DATA_ROOT_STALE");
    return {
      database,
      repository,
      generation: database.rootGeneration,
      assertCurrent: async () => {
        if (database !== this.#database || database.closed) throw new Error("OD_DATA_ROOT_STALE");
        await assertCallNinaDatabaseLease(database);
      },
    };
  }
}
