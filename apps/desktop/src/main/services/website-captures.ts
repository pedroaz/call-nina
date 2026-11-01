import {
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type WebsiteSource,
} from "@call-nina/contracts";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";
import { importWebsite } from "./website-import.js";

export class WebsiteCaptures {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "scheduler" | "root">;
  readonly #websiteReaders = new Map<string, AbortController>();
  readonly #websiteCaptures = new Map<
    string,
    { source: WebsiteSource; rootGeneration: number; language: string }
  >();
  get #scheduler() {
    return this.#services().scheduler;
  }
  get #root() {
    return this.#services().root;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "scheduler" | "root">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async captureWebsite(
    request: Extract<DesktopIpcRequest, { channel: "material/import-web" }>,
  ): Promise<DesktopIpcResponse> {
    const { importId, rootGeneration, language, url } = request.payload;
    if (
      this.#scheduler.closing ||
      this.#websiteReaders.size >= 4 ||
      this.#websiteReaders.has(importId)
    )
      return this.#environment.failure(request, "conflict");
    const controller = new AbortController();
    this.#websiteReaders.set(importId, controller);
    try {
      const ready = await this.#scheduler.enqueue(async () => {
        const root = await this.#root.dataRootState(request.requestId);
        return (
          root.status === "ready" &&
          root.generation === rootGeneration &&
          (await this.#root.repository?.requireLearningScope())?.targetLanguage === language
        );
      });
      if (!ready) return this.#environment.failure(request, "stale-data-root");
      controller.signal.throwIfAborted();
      const source = await importWebsite(url, controller.signal);
      return await this.#scheduler.enqueue(async () => {
        if (controller.signal.aborted || this.#scheduler.closing)
          return this.#environment.failure(request, "cancellation");
        if (this.#root.database?.rootGeneration !== rootGeneration)
          return this.#environment.failure(request, "stale-data-root");
        if ((await this.#root.repository?.requireLearningScope())?.targetLanguage !== language)
          return this.#environment.failure(request, "conflict");
        while (this.#websiteCaptures.size >= 32) {
          const oldest = this.#websiteCaptures.keys().next().value;
          if (oldest !== undefined) this.#websiteCaptures.delete(oldest);
        }
        this.#websiteCaptures.set(importId, { source, rootGeneration, language });
        return this.#environment.success(request, { captureId: importId, source });
      });
    } catch {
      return this.#environment.failure(
        request,
        controller.signal.aborted ? "cancellation" : "website-import",
      );
    } finally {
      this.#websiteReaders.delete(importId);
    }
  }
  cancel(id: string) {
    const reader = this.#websiteReaders.get(id);
    reader?.abort();
    this.#websiteCaptures.delete(id);
    return Boolean(reader);
  }
  capture(id: string) {
    return structuredClone(this.#websiteCaptures.get(id));
  }
  clear() {
    for (const c of this.#websiteReaders.values()) c.abort();
    this.#websiteReaders.clear();
    this.#websiteCaptures.clear();
  }
}
