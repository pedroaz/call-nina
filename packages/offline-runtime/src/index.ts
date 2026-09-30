import { type OfflineSnapshot } from "@call-nina/contracts";
import { type LearningAttempt } from "@call-nina/learning-workflows";
import { offlineCandidate, downloadBytes } from "./candidate.js";
import { fail, safeCode } from "./files.js";
import { ArtifactStore } from "./store.js";
import { OfflineTransport } from "./transport.js";

export { offlineCandidate } from "./candidate.js";
export class OfflineRuntime {
  private readonly store: ArtifactStore;
  private readonly transport: OfflineTransport;
  private busy: "download" | "generation" | "removal" | null = null;
  private phase: "downloading" | "verifying" = "downloading";
  private bytes = 0;
  private error: string | null = null;
  private downloadController: AbortController | null = null;
  private downloadTask: Promise<void> | null = null;
  private generationController: AbortController | null = null;
  private generationTask: Promise<string> | null = null;
  constructor(options: { artifactRoot: string }) {
    // Main supplies its dedicated device-owned directory, never a learner root or renderer path.
    this.store = new ArtifactStore(options.artifactRoot);
    this.transport = new OfflineTransport(this.store);
  }
  async inspect(): Promise<OfflineSnapshot> {
    const base = {
      candidateId: offlineCandidate.id,
      modelId: offlineCandidate.modelId,
      quality: offlineCandidate.quality,
      platform: offlineCandidate.platform,
      downloadedBytes: this.bytes,
      downloadBytes,
      errorCode: this.error,
    };
    try {
      const preflight = await this.store.preflight();
      const installed = await this.store.state();
      const state =
        this.busy === "download"
          ? this.phase
          : this.busy === "generation"
            ? "generating"
            : this.busy === "removal"
              ? "removing"
              : installed;
      return {
        ...base,
        downloadedBytes: installed === "installed" ? downloadBytes : this.bytes,
        state,
        preflight,
      };
    } catch (error) {
      return { ...base, state: "unavailable", errorCode: safeCode(error), preflight: null };
    }
  }
  // Starts an explicitly requested job and returns immediately. Inspect reports bounded progress.
  install(): void {
    if (this.busy) fail("BUSY");
    this.busy = "download";
    this.error = null;
    this.bytes = 0;
    this.phase = "downloading";
    const controller = new AbortController();
    this.downloadController = controller;
    this.downloadTask = this.store
      .install(controller.signal, (bytes, phase) => {
        this.bytes = bytes;
        this.phase = phase;
      })
      .catch((error: unknown) => {
        this.error = controller.signal.aborted ? "OD_OFFLINE_CANCELLED" : safeCode(error);
      })
      .finally(() => {
        this.busy = null;
        this.downloadController = null;
        this.downloadTask = null;
      });
  }
  async cancelDownload(): Promise<void> {
    this.downloadController?.abort();
    await this.downloadTask;
  }
  async remove(): Promise<void> {
    if (this.busy) fail("BUSY");
    this.busy = "removal";
    try {
      await this.store.remove();
      this.bytes = 0;
      this.error = null;
    } catch (error) {
      this.error = safeCode(error);
      throw new Error(this.error);
    } finally {
      this.busy = null;
    }
  }
  generate(attempt: LearningAttempt, isActive: () => boolean): Promise<string> {
    if (this.busy) fail("BUSY");
    if (!isActive()) fail("INACTIVE");
    this.busy = "generation";
    this.error = null;
    const controller = new AbortController();
    this.generationController = controller;
    this.generationTask = this.transport
      .generate(
        {
          ...attempt,
          signal: AbortSignal.any([controller.signal, ...(attempt.signal ? [attempt.signal] : [])]),
        },
        isActive,
      )
      .catch((error: unknown) => {
        this.error = safeCode(error);
        throw new Error(this.error);
      })
      .finally(() => {
        this.busy = null;
        this.generationController = null;
        this.generationTask = null;
      });
    return this.generationTask;
  }
  // Main awaits settlement before route/root switching, removal or application shutdown.
  async stop(): Promise<void> {
    await this.cancelDownload();
    this.generationController?.abort();
    await this.generationTask?.catch(() => undefined);
    await this.transport.stop();
  }
}

export type { OfflineSnapshot } from "@call-nina/contracts";
export { offlineCatalog, offlineSelection } from "./catalog.js";
export { OfflineGenerationService } from "./service.js";
