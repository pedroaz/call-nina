import { type OfflineSnapshot } from "@call-nina/contracts";
import { type LearningAttempt } from "@call-nina/learning-workflows";
import { offlineCandidate, downloadBytes } from "./candidate.js";
import { fail, safeCode } from "./files.js";
import { ArtifactStore } from "./store.js";
import { OfflineTransport } from "./transport.js";

export { offlineCandidate } from "./candidate.js";
export class OfflineRuntime {
  private store: ArtifactStore;
  private transport: OfflineTransport;
  private paused = false;
  private removalTask: Promise<void> | null = null;
  private busy: "download" | "generation" | "removal" | null = null;
  private phase: "downloading" | "verifying" = "downloading";
  private bytes = 0;
  private error: string | null = null;
  private downloadController: AbortController | null = null;
  private downloadTask: Promise<void> | null = null;
  private generationController: AbortController | null = null;
  private generationTask: Promise<string> | null = null;
  constructor(options: { artifactRoot: string }) {
    // Main supplies a validated location beneath the selected learner root.
    this.store = new ArtifactStore(options.artifactRoot);
    this.transport = new OfflineTransport(this.store);
  }
  suspend(): void {
    this.paused = true;
  }
  async setRoot(artifactRoot: string): Promise<void> {
    if (this.store.root === new ArtifactStore(artifactRoot).root) {
      this.paused = false;
      return;
    }
    await this.stop();
    if (this.busy) fail("BUSY");
    this.store = new ArtifactStore(artifactRoot);
    this.transport = new OfflineTransport(this.store);
    this.bytes = 0;
    this.error = null;
    this.paused = false;
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
    let preflight: OfflineSnapshot["preflight"] = null;
    try {
      preflight = await this.store.preflight();
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
      return { ...base, state: "unavailable", errorCode: safeCode(error), preflight };
    }
  }
  // Starts an explicitly requested job and returns immediately. Inspect reports bounded progress.
  install(): void {
    if (this.paused || this.busy) fail("BUSY");
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
        this.error = controller.signal.aborted ? null : safeCode(error);
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
  remove(): Promise<void> {
    if (this.paused || this.busy) fail("BUSY");
    this.busy = "removal";
    this.removalTask = this.store
      .remove()
      .then(() => {
        this.bytes = 0;
        this.error = null;
      })
      .catch((error: unknown) => {
        this.error = safeCode(error);
        throw new Error(this.error);
      })
      .finally(() => {
        this.busy = null;
        this.removalTask = null;
      });
    return this.removalTask;
  }
  generate(
    attempt: LearningAttempt,
    isActive: () => boolean,
    onRunning?: () => void,
  ): Promise<string> {
    if (this.paused || this.busy) fail("BUSY");
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
        onRunning,
      )
      .catch((error: unknown) => {
        const code = safeCode(error);
        this.error = controller.signal.aborted || attempt.signal?.aborted ? null : code;
        throw new Error(code);
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
    await this.removalTask?.catch(() => undefined);
  }
}

export type { OfflineSnapshot } from "@call-nina/contracts";
export { offlineCatalog, offlineSelection } from "./catalog.js";
export { OfflineGenerationService } from "./service.js";
