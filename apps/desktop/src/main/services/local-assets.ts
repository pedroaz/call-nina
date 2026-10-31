import {
  consolidateLocalAssets,
  consolidatePreparedSpeech,
  resolveDataRootLayout,
} from "@call-nina/persistence";
import { SpeechService, loadLocalSpeechBundles } from "@call-nina/speech-runtime";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

declare const __NINA_SPEECH_RUNTIMES__: string;
export class LocalAssets {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, never>;
  #speech: SpeechService;
  #storageRoot: string | null = null;
  #storageBinding: Promise<void> | null = null;

  constructor(environment: DesktopEnvironment, services: () => Pick<DesktopServices, never>) {
    this.#environment = environment;
    this.#services = services;
    this.#speech = new SpeechService(
      path.join(path.dirname(environment.bootstrapFile), "speech"),
      environment.curriculumRoot,
    );
  }
  async bindStorage(dataRoot: string): Promise<void> {
    if (this.#storageBinding) await this.#storageBinding;
    if (this.#storageRoot === dataRoot) return;
    this.#environment.offline.suspend();
    const task = (async () => {
      await this.#speech.close();
      await this.#environment.offline.stop();
      this.#storageRoot = null;
      const layout = resolveDataRootLayout(dataRoot);
      await consolidateLocalAssets(dataRoot, path.dirname(this.#environment.bootstrapFile));
      if (this.#environment.legacySpeechCandidatesDirectory)
        await consolidatePreparedSpeech(
          dataRoot,
          this.#environment.legacySpeechCandidatesDirectory,
        );
      const bundleDirectory = this.#environment.speechBundleDirectory ?? layout.preparedSpeech;
      const bundles =
        process.platform === "linux" && process.arch === "x64"
          ? await loadLocalSpeechBundles(
              path.join(layout.speech, "models"),
              bundleDirectory,
              JSON.parse(gunzipSync(Buffer.from(__NINA_SPEECH_RUNTIMES__, "base64")).toString()),
              this.#environment.speechBundleDirectory
                ? undefined
                : this.#environment.developmentSpeechBundlesDirectory,
            )
          : undefined;
      await this.#environment.offline.setRoot(layout.textModels);
      this.#speech = new SpeechService(layout.speech, this.#environment.curriculumRoot, {
        ...(bundles ? { bundles } : {}),
        onChange: () => {
          this.#environment.emitEvent({ event: "state-invalidated", scope: "settings" });
        },
        log: (code, durationMs) =>
          this.#environment.log?.({
            timestamp: new Date().toISOString(),
            severity: code === "OD_SPEECH_COMPLETED" ? "info" : "warn",
            component: "desktop",
            code,
            message: "Speech operation settled.",
            durationMs,
          }),
      });
      await this.#speech.packs.rememberInstalled();
      this.#storageRoot = dataRoot;
    })();
    this.#storageBinding = task;
    try {
      await task;
    } catch (error) {
      const code =
        error instanceof Error && /^OD_STORAGE_[A-Z_]+$/.test(error.message)
          ? error.message
          : "OD_STORAGE_MIGRATION_FAILED";
      this.#environment.log?.({
        timestamp: new Date().toISOString(),
        severity: "error",
        component: "desktop",
        code,
        message: "Local storage migration failed.",
      });
      throw error;
    } finally {
      if (this.#storageBinding === task) this.#storageBinding = null;
    }
  }
  get speech() {
    return this.#speech;
  }
  get storageRoot() {
    return this.#storageRoot;
  }
  invalidate() {
    this.#storageRoot = null;
  }
}
