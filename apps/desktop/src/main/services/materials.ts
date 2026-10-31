import { type DesktopIpcRequest, type DesktopIpcResponse } from "@call-nina/contracts";
import {
  deleteMaterial,
  listMaterials,
  readMaterialRevision,
  readMaterialUsage,
  saveMaterial,
} from "@call-nina/persistence";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class MaterialsService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root">;

  get #root() {
    return this.#services().root;
  }
  constructor(environment: DesktopEnvironment, services: () => Pick<DesktopServices, "root">) {
    this.#environment = environment;
    this.#services = services;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "material/import-web"
          | "material/cancel-import"
          | "material/list"
          | "material/read"
          | "material/save"
          | "material/delete";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "material/import-web":
      case "material/cancel-import":
        return this.#environment.failure(request, "unsupported-operation");
      case "material/list":
      case "material/read":
      case "material/save":
      case "material/delete": {
        const root = await this.#root.dataRootState(request.requestId);
        const database = this.#root.database;
        if (
          root.status !== "ready" ||
          !database ||
          !this.#root.repository ||
          ("rootGeneration" in request.payload &&
            request.payload.rootGeneration !== database.rootGeneration)
        )
          return this.#environment.failure(request, "stale-data-root");
        const scope = await this.#root.repository.requireLearningScope();
        if (request.channel === "material/list")
          return this.#environment.success(request, {
            rootGeneration: database.rootGeneration,
            language: scope.targetLanguage,
            learningScope: scope,
            ...(await listMaterials(database, request.payload.cursor)),
          });
        if (request.channel === "material/read")
          return this.#environment.success(request, {
            material: await readMaterialRevision(database, request.payload.reference),
            usage: await readMaterialUsage(database, request.payload.reference),
          });
        if (request.channel === "material/delete") {
          await deleteMaterial(database, request.payload.reference, request.payload.learningScope);
          this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
          return this.#environment.success(request, { deleted: true });
        }
        if (request.payload.draft.language !== scope.targetLanguage)
          return this.#environment.failure(request, "conflict");
        const material = await saveMaterial(
          database,
          request.payload.draft,
          request.payload.previous,
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, { material });
      }
    }
  }
}
