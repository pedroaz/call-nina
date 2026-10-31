import { type DesktopIpcRequest, type DesktopIpcResponse } from "@call-nina/contracts";
import {
  archiveUpload,
  commitUploadWords,
  listUploads,
  readMaterialUsage,
  readUpload,
  readUploadAnalyses,
  readUploadWords,
  saveUpload,
} from "@call-nina/persistence";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";
import { readUploadImage, storeUploadImage } from "./upload-images.js";

export class UploadsService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "generation">;

  get #root() {
    return this.#services().root;
  }
  get #generation() {
    return this.#services().generation;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "generation">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "uploads/list"
          | "uploads/read"
          | "uploads/save"
          | "uploads/archive"
          | "uploads/image"
          | "uploads/analyses"
          | "uploads/commit";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "uploads/list":
      case "uploads/read":
      case "uploads/save":
      case "uploads/archive":
      case "uploads/image":
      case "uploads/analyses":
      case "uploads/commit": {
        const database = this.#root.database;
        if (
          !database ||
          !this.#root.repository ||
          ("rootGeneration" in request.payload &&
            request.payload.rootGeneration !== database.rootGeneration)
        )
          return this.#environment.failure(request, "stale-data-root");
        if (request.channel === "uploads/list")
          return this.#environment.success(
            request,
            await listUploads(database, request.payload.vocabularyId),
          );
        if (request.channel === "uploads/read") {
          const upload = await readUpload(database, request.payload.reference);
          const usage = upload.material
            ? await readMaterialUsage(database, {
                materialId: upload.material.materialId,
                revisionId: upload.material.revisionId,
              })
            : { activityCount: 0, attemptCount: 0, activities: [] };
          return this.#environment.success(request, {
            upload,
            words: await readUploadWords(database, request.payload.reference),
            usage,
          });
        }
        if (request.channel === "uploads/save") {
          const preview = request.payload.websitePack
            ? this.#generation.operations.websitePack(request.payload.websitePack.operationId)
            : undefined;
          if (
            request.payload.websitePack &&
            (!preview ||
              preview.rootGeneration !== database.rootGeneration ||
              preview.language !== request.payload.language ||
              preview.pack.source.url !== request.payload.draft.url)
          )
            return this.#environment.failure(request, "conflict");
          const stored = request.payload.draft.image
            ? await storeUploadImage(database.dataRoot, request.payload.draft.image)
            : undefined;
          try {
            const upload = await saveUpload(
              database,
              request.payload.draft,
              request.payload.previous,
              stored?.metadata,
              request.payload.language,
              request.payload.saveId,
              preview && request.payload.websitePack
                ? { pack: preview.pack, positions: request.payload.websitePack.positions }
                : undefined,
            );
            this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
            return this.#environment.success(request, { upload });
          } catch (error) {
            if (stored?.created) await stored.discard().catch(() => {});
            if (
              error instanceof Error &&
              "code" in error &&
              ["ENOSPC", "EACCES", "EROFS", "EIO"].includes(String(error.code))
            )
              throw new Error("OD_UPLOAD_SAVE_FAILED");
            throw error;
          }
        }
        if (request.channel === "uploads/archive") {
          await archiveUpload(database, request.payload.reference);
          this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
          return this.#environment.success(request, { archived: true });
        }
        if (request.channel === "uploads/image") {
          const upload = await readUpload(database, request.payload.reference);
          return this.#environment.success(request, {
            image: upload.image ? await readUploadImage(database.dataRoot, upload.image) : null,
          });
        }
        if (request.channel === "uploads/analyses")
          return this.#environment.success(request, {
            analyses: await readUploadAnalyses(database, request.payload.reference),
          });
        const saved = await commitUploadWords(
          database,
          request.payload.analysisId,
          request.payload.positions,
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        return this.#environment.success(request, { saved });
      }
    }
  }
}
