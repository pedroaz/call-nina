import { type DesktopIpcRequest, type DesktopIpcResponse } from "@call-nina/contracts";
import {
  readBootstrapPointer,
  readSpeechPreferences,
  resolveDataRootLayout,
} from "@call-nina/persistence";
import { lstat, readFile, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { DesktopEnvironment } from "../desktop-environment.js";
import { readPersonalDataLocations } from "../personal-data.js";
import type { DesktopServices } from "./desktop-services.js";
import { cleanupUploadImages } from "./upload-images.js";

export class DiagnosticsService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "generation" | "assets">;

  get #root() {
    return this.#services().root;
  }
  get #generation() {
    return this.#services().generation;
  }
  get #assets() {
    return this.#services().assets;
  }

  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "generation" | "assets">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async activeLogFiles(): Promise<readonly string[]> {
    const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
    if (
      pointer.status !== "ready" ||
      !this.#root.database ||
      this.#root.database.closed ||
      pointer.rootGeneration !== this.#root.database.rootGeneration
    ) {
      throw new Error("OD_DATA_ROOT_STALE");
    }
    const logs = resolveDataRootLayout(pointer.dataRoot).logs;
    if ((await realpath(logs)) !== logs) throw new Error("OD_LOG_DIRECTORY_INVALID");
    const entries = await readdir(logs, { withFileTypes: true });
    if (entries.length > 1_000 || entries.some((entry) => !entry.isFile())) {
      throw new Error("OD_LOG_DIRECTORY_INVALID");
    }
    return Object.freeze(entries.map((entry) => path.join(logs, entry.name)));
  }

  async recentOperationalLogs(): Promise<Readonly<Record<string, readonly string[]>>> {
    const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
    if (pointer.status !== "ready") return {};
    const logs = resolveDataRootLayout(pointer.dataRoot).logs;
    const names = ["desktop.log", "app-server.log", "mcp-server.log"] as const;
    const output: Record<string, readonly string[]> = {};
    for (const name of names) {
      const content = await readFile(path.join(logs, name), "utf8").catch(() => "");
      const lines = content
        .split("\n")
        .filter((line) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s/u.test(line))
        .slice(-200);
      output[name] = Object.freeze(lines);
    }
    return Object.freeze(output);
  }

  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "personal-data/clear"
          | "personal-data/read"
          | "diagnostics/read"
          | "diagnostics/export"
          | "logs/clear";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "personal-data/clear": {
        if (this.#generation.operations.activeCount > 0) {
          return this.#environment.success(request, { status: "blocked", reason: "busy" });
        }
        const root = await this.#root.dataRootState(request.requestId);
        if (
          root.status !== "ready" ||
          !this.#root.repository ||
          root.generation !== request.payload.expectedGeneration
        ) {
          return this.#environment.failure(request, "stale-data-root");
        }
        const speech = this.#assets.speech;
        {
          const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
          if (
            pointer.status !== "ready" ||
            !this.#root.database ||
            pointer.rootGeneration !== request.payload.expectedGeneration
          )
            return this.#environment.failure(request, "stale-data-root");
          speech.setRoot(pointer.dataRoot, await readSpeechPreferences(this.#root.database));
        }
        const result = await this.#root.repository.clearPersonalData(request.payload);
        if (result.status === "cleared") {
          const uploadImagesCleared = await cleanupUploadImages(this.#root.database);
          let privateSpeechFailed = false;
          try {
            await speech.manage({ action: "clear-private-cache" });
          } catch {
            privateSpeechFailed = true;
            this.#environment.operationLog(
              "warn",
              "OD_PERSONAL_DATA_AUDIO_CLEANUP_FAILED",
              request.requestId,
              request.channel,
              undefined,
              "Private speech cleanup did not finish.",
              { action: request.channel, phase: "failed", outcome: "error" },
            );
          }
          this.#generation.operations.resetRetained();
          this.#generation.translations.clearReveals();
          for (const scope of ["dashboard", "history", "vocabulary", "settings"] as const) {
            this.#environment.emitEvent({ event: "state-invalidated", scope });
          }
          if (!uploadImagesCleared)
            return this.#environment.success(request, {
              status: "partial",
              scope: request.payload.scope,
              reason: "upload-images",
            });
          if (privateSpeechFailed)
            return this.#environment.success(request, {
              status: "partial",
              scope: request.payload.scope,
              reason: "private-speech",
            });
        }
        return this.#environment.success(request, result);
      }
      case "personal-data/read": {
        const root = await this.#root.dataRootState(request.requestId);
        const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
        if (
          root.status !== "ready" ||
          pointer.status !== "ready" ||
          !this.#root.repository ||
          !this.#root.database ||
          root.generation !== pointer.rootGeneration
        ) {
          return this.#environment.failure(request, "stale-data-root");
        }
        const locations = await readPersonalDataLocations(
          pointer.dataRoot,
          this.#environment.bootstrapFile,
        );
        const tables = await this.#root.repository.readPersonalDataInventory();
        return this.#environment.success(request, {
          rootGeneration: root.generation,
          dataRoot: pointer.dataRoot,
          schemaVersion: this.#root.database.schemaVersion,
          refreshedAt: new Date().toISOString(),
          locations,
          tables,
        });
      }
      case "diagnostics/read": {
        const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
        if (
          pointer.status !== "ready" ||
          !this.#root.database ||
          this.#root.database.closed ||
          pointer.rootGeneration !== this.#root.database.rootGeneration
        ) {
          return this.#environment.failure(request, "stale-data-root");
        }
        return this.#environment.success(request, {
          dataRootGeneration: this.#root.database.rootGeneration,
          dataRootFormatVersion: pointer.dataRootFormatVersion,
          databaseSchemaVersion: this.#root.database.schemaVersion,
          journalMode: this.#root.database.journalMode,
          foreignKeysEnabled: this.#root.database.foreignKeysEnabled,
          logFileCount: (await this.activeLogFiles()).length,
          recentLogs: await this.recentOperationalLogs(),
        });
      }
      case "diagnostics/export": {
        const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
        if (
          pointer.status !== "ready" ||
          !this.#root.database ||
          this.#root.database.closed ||
          pointer.rootGeneration !== this.#root.database.rootGeneration
        ) {
          return this.#environment.failure(request, "stale-data-root");
        }
        if (!this.#environment.exportDiagnostics)
          return this.#environment.success(request, { status: "cancelled" });
        const diagnostics = {
          schemaVersion: 1,
          dataRootGeneration: this.#root.database.rootGeneration,
          dataRootFormatVersion: pointer.dataRootFormatVersion,
          databaseSchemaVersion: this.#root.database.schemaVersion,
          journalMode: this.#root.database.journalMode,
          foreignKeysEnabled: this.#root.database.foreignKeysEnabled,
          logFileCount: (await this.activeLogFiles()).length,
          recentLogs: await this.recentOperationalLogs(),
        };
        return this.#environment.success(
          request,
          await this.#environment.exportDiagnostics(
            `${JSON.stringify({ exportedAt: new Date().toISOString(), diagnostics })}\n`,
          ),
        );
      }
      case "logs/clear": {
        const files = await this.activeLogFiles();
        for (const file of files) {
          const metadata = await lstat(file);
          if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new Error("OD_LOG_FILE_INVALID");
          }
          await unlink(file);
        }
        return this.#environment.success(request, { clearedFileCount: files.length });
      }
    }
  }
}
