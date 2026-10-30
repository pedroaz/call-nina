import type { NinaAccount } from "../nina-account.js";
import {
  type AiConnection,
  type CorrelationId,
  type GenerationEvent,
  type GenerationService,
} from "@call-nina/contracts";
import { DirectApiGenerationService, isDirectApiRoute } from "@call-nina/direct-api";
import { ManagedGenerationService } from "@call-nina/managed-generation/service";
import { OfflineGenerationService, type OfflineRuntime } from "@call-nina/offline-runtime";
import { type CallNinaDatabase } from "@call-nina/persistence";
import { type LearningWorkflowTiming } from "@call-nina/learning-workflows";
import { type OperationLog } from "../backend-support.js";
import { ChatgptGenerationService } from "../chatgpt-generation.js";
import { type ChatgptSession } from "../chatgpt-session.js";
import { type ConnectionSecretStorage } from "../secret-storage.js";

interface Dependencies {
  database: () => CallNinaDatabase | undefined;
  closing: () => boolean;
  chatgpt: ChatgptSession;
  nina: NinaAccount;
  offline: OfflineRuntime;
  secrets: ConnectionSecretStorage;
  connectionById: (id: string) => Promise<AiConnection>;
  projectGenerationEvent: (event: GenerationEvent) => void;
  operationLog: OperationLog;
}
export class ConnectionRuntime {
  readonly #dependencies: Dependencies;
  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }
  get #database() {
    return this.#dependencies.database();
  }
  get #closing() {
    return this.#dependencies.closing();
  }

  readonly operationServices = new Map<string, GenerationService>();

  readonly managedServices = new Set<ManagedGenerationService>();

  readonly directServices = new Set<DirectApiGenerationService>();

  readonly offlineServices = new Set<OfflineGenerationService>();

  offlineEpoch = 0;

  readonly chatgptServices = new Set<ChatgptGenerationService>();

  #logValidation(
    provider: "CHATGPT" | "LOCAL",
    operationId: string,
    event: LearningWorkflowTiming,
  ) {
    this.#dependencies.operationLog(
      event.outcome === "error" ? "warn" : "info",
      `${provider}_GENERATION_VALIDATION`,
      operationId,
      event.stage,
      event.code,
      "Generation validation completed.",
      {
        phase: "validating",
        outcome: event.outcome,
        durationMs: event.durationMs,
        metadata: {
          attempt: event.attempt,
          exerciseIndex: event.exerciseIndex ?? null,
          validationField: event.validationField ?? null,
          answerLength: event.answerLength ?? null,
        },
      },
    );
  }

  async generationForConnection(connection: AiConnection): Promise<GenerationService | undefined> {
    if (connection.routeId === "chatgpt" && this.#database) {
      const database = this.#database;
      const captured = structuredClone(connection);
      const registrationId = await this.#dependencies.chatgpt.selectedRegistration();
      if (!registrationId) throw new Error("OD_CHATGPT_SIGN_IN_REQUIRED");
      const assertActive = async () => {
        if (this.#closing || database !== this.#database || database.closed)
          throw new Error("OD_DATA_ROOT_STALE");
        const current = await this.#dependencies.connectionById(captured.id);
        if (
          current.id !== captured.id ||
          current.routeId !== "chatgpt" ||
          (await this.#dependencies.chatgpt.selectedRegistration()) !== registrationId
        )
          throw new Error("OD_CONNECTION_CONFLICT");
      };
      const service = new ChatgptGenerationService({
        session: this.#dependencies.chatgpt,
        registrationId,
        assertActive,
        connectionId: connection.id,
        rootGeneration: database.rootGeneration,
        onTiming: (operationId, event) => {
          this.#logValidation("CHATGPT", operationId, event);
        },
        onFailure: (operationId, code) => {
          this.#dependencies.operationLog(
            "warn",
            "CHATGPT_GENERATION_FAILED",
            operationId,
            "generation",
            code,
            "ChatGPT generation did not complete.",
            { phase: "failed", outcome: "error" },
          );
        },
      });
      service.subscribeGeneration(this.#dependencies.projectGenerationEvent);
      this.chatgptServices.add(service);
      return service;
    }
    if (connection.routeId === "managed" && this.#database) {
      const database = this.#database;
      const epoch = this.#dependencies.nina.epoch;
      const service = new ManagedGenerationService({
        readToken: () => this.#dependencies.nina.token(epoch),
        connectionId: connection.id,
        rootGeneration: database.rootGeneration,
        // Connection mutations wait for settlement; root/account changes invalidate the lease.
        assertActive: () => {
          this.#dependencies.nina.assertAi(epoch);
          if (this.#closing || database !== this.#database || database.closed)
            throw new Error("OD_DATA_ROOT_STALE");
        },
      });
      service.subscribeGeneration(this.#dependencies.projectGenerationEvent);
      this.managedServices.add(service);
      return service;
    }
    if (connection.routeId === "local" && this.#database) {
      const database = this.#database;
      const captured = structuredClone(connection);
      const service = new OfflineGenerationService({
        connectionId: captured.id,
        rootGeneration: database.rootGeneration,
        runtime: this.#dependencies.offline,
        onTiming: (operationId, event) => {
          this.#logValidation("LOCAL", operationId, event);
        },
        captureActive: () => {
          const epoch = this.offlineEpoch;
          return () =>
            !this.#closing &&
            database === this.#database &&
            !database.closed &&
            epoch === this.offlineEpoch;
        },
        assertActive: async () => {
          // Resource admission belongs to each transport attempt. A later memory
          // change must not invalidate an operation that has already finished.
          const current = await this.#dependencies.connectionById(captured.id);
          if (current.id !== captured.id || current.routeId !== captured.routeId)
            throw new Error("OD_OFFLINE_INACTIVE");
        },
      });
      service.subscribeGeneration(this.#dependencies.projectGenerationEvent);
      this.offlineServices.add(service);
      return service;
    }
    if (!isDirectApiRoute(connection.routeId) || !this.#database) return undefined;
    const database = this.#database;
    const captured = structuredClone(connection);
    const assertActive = async () => {
      if (this.#closing || database !== this.#database || database.closed)
        throw new Error("OD_DATA_ROOT_STALE");
      const current = await this.#dependencies.connectionById(captured.id);
      if (
        current.id !== captured.id ||
        current.routeId !== captured.routeId ||
        current.secretRef !== captured.secretRef ||
        !captured.secretRef
      )
        throw new Error("OD_CONNECTION_CONFLICT");
    };
    const service = new DirectApiGenerationService({
      route: connection.routeId,
      connectionId: connection.id,
      rootGeneration: database.rootGeneration,
      readActiveCredential: async () => {
        await assertActive();
        if (!captured.secretRef) throw new Error("OD_CONNECTION_CREDENTIAL_UNAVAILABLE");
        const secret = await this.#dependencies.secrets.read(captured.secretRef);
        await assertActive();
        return secret;
      },
    });
    service.subscribeGeneration(this.#dependencies.projectGenerationEvent);
    this.directServices.add(service);
    return service;
  }

  releaseOperation(operationId: CorrelationId): void {
    const service = this.operationServices.get(operationId);
    if (
      service instanceof ChatgptGenerationService &&
      ![...this.operationServices.entries()].some(
        ([id, current]) => id !== operationId && current === service,
      )
    ) {
      this.chatgptServices.delete(service);
      void service.shutdown();
    }
    service?.releaseOperation(operationId);
    this.operationServices.delete(operationId);
    if (
      service instanceof ManagedGenerationService &&
      ![...this.operationServices.values()].includes(service)
    ) {
      this.managedServices.delete(service);
      void service.shutdown();
    }
    if (
      service instanceof OfflineGenerationService &&
      ![...this.operationServices.values()].includes(service)
    ) {
      this.offlineServices.delete(service);
      void service.shutdown();
    }
    if (
      service instanceof DirectApiGenerationService &&
      ![...this.operationServices.values()].includes(service)
    ) {
      this.directServices.delete(service);
      void service.shutdown();
    }
  }

  async stopConnectionRuntime(): Promise<void> {
    this.offlineEpoch++;
    await this.#dependencies.offline.stop();
    if (this.#dependencies.chatgpt.pendingLoginId)
      this.#dependencies.chatgpt.cancelLogin(this.#dependencies.chatgpt.pendingLoginId);
  }
}
