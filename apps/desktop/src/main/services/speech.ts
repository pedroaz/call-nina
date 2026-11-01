import { type DesktopIpcRequest, type DesktopIpcResponse } from "@call-nina/contracts";
import {
  readBootstrapPointer,
  readSpeechPreferences,
  saveSpeechPreferences,
} from "@call-nina/persistence";
import type { DesktopEnvironment } from "../desktop-environment.js";
import { managedSpeech } from "../speech-client.js";
import type { DesktopServices } from "./desktop-services.js";

export class SpeechController {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "scheduler" | "root" | "assets">;

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
      { channel: "speech/availability" | "speech/read" | "speech/manage" | "speech/synthesize" }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "speech/availability":
      case "speech/read":
      case "speech/manage":
      case "speech/synthesize": {
        const speech = await this.#scheduler.enqueue(async () => {
          const root = await this.#root.dataRootState(request.requestId);
          const pointer = await readBootstrapPointer(this.#environment.bootstrapFile);
          if (
            root.status !== "ready" ||
            pointer.status !== "ready" ||
            !this.#root.database ||
            this.#assets.storageRoot !== pointer.dataRoot
          )
            return null;
          this.#assets.speech.setRoot(
            pointer.dataRoot,
            await readSpeechPreferences(this.#root.database),
          );
          if (request.channel === "speech/manage" && request.payload.action === "preferences")
            await saveSpeechPreferences(
              this.#root.database,
              this.#assets.speech.validatePreferences(request.payload.preferences),
            );
          if (request.channel === "speech/manage" && request.payload.action === "playback-rate")
            await saveSpeechPreferences(this.#root.database, {
              ...this.#assets.speech.preferences,
              playbackRate: request.payload.rate,
            });
          return this.#assets.speech;
        });
        if (!speech) return this.#environment.failure(request, "stale-data-root");
        if (request.channel === "speech/availability")
          return this.#environment.success(
            request,
            await speech.availability(
              request.payload,
              request.payload.online,
              this.#environment.nina.state.access?.speech ?? null,
            ),
          );
        if (request.channel === "speech/synthesize")
          return this.#environment.success(
            request,
            await speech.synthesize(
              request.payload,
              (input, signal, save) => managedSpeech(this.#environment.nina, input, signal, save),
              (audio) => {
                this.#environment.emitEvent({
                  event: "speech-audio",
                  id: request.payload.id,
                  audio: audio.toString("base64"),
                });
              },
            ),
          );
        if (request.channel === "speech/manage") {
          await speech.manage(request.payload);
          if (request.payload.action !== "cancel")
            this.#environment.emitEvent({
              event: "state-invalidated",
              scope: request.payload.action === "playback-rate" ? "speech-playback" : "settings",
            });
        }
        return this.#environment.success(request, await speech.inspect());
      }
    }
  }
}
