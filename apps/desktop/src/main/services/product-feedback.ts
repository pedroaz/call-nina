import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  analyticsConsentSchema,
  ninaPublicConfiguration,
  z,
  type AnalyticsConsent,
  type AnalyticsScreen,
  type DesktopIpcRequest,
} from "@call-nina/contracts";
import { selectionId } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";

const preferenceSchema = z.strictObject({
  version: z.literal(1),
  consent: analyticsConsentSchema,
});
type Request = Extract<
  DesktopIpcRequest,
  {
    channel: "feedback/open" | "analytics/read" | "analytics/consent" | "analytics/screen";
  }
>;

/** Device-local consent and bounded, best-effort analytics. No learner repository access. */
export class ProductFeedback {
  readonly #environment: DesktopEnvironment;
  readonly #file: string;
  readonly #ready: Promise<void>;
  #writes: Promise<void> = Promise.resolve();
  #consent: AnalyticsConsent = "unknown";
  #closed = false;
  #started = false;
  #screen: AnalyticsScreen | null = null;
  #lastScreen: AnalyticsScreen | null = null;
  #sessionId: string | undefined;
  #lastActivity = 0;
  readonly #requests = new Set<AbortController>();

  constructor(environment: DesktopEnvironment) {
    this.#environment = environment;
    this.#file = path.join(path.dirname(environment.bootstrapFile), "usage-analytics.json");
    this.#ready = this.#load();
  }
  get #available() {
    return Boolean(ninaPublicConfiguration.aptabaseAppKey);
  }
  get #state() {
    return { available: this.#available, consent: this.#consent };
  }
  async #load() {
    try {
      this.#consent = preferenceSchema.parse(
        JSON.parse(await readFile(this.#file, "utf8")),
      ).consent;
    } catch {
      this.#consent = "unknown";
    }
    this.#start();
  }
  #start() {
    if (!this.#allowed || this.#started) return;
    this.#started = true;
    this.#send("app_started");
  }
  get #allowed() {
    return !this.#closed && this.#available && this.#consent === "enabled";
  }
  #clear() {
    for (const controller of this.#requests) controller.abort();
    this.#requests.clear();
    this.#sessionId = undefined;
    this.#lastActivity = 0;
    this.#lastScreen = null;
  }
  close() {
    this.#closed = true;
    this.#clear();
  }

  async #save(enabled: boolean) {
    if (this.#closed) return;
    // Revoke first, even if the subsequent disk write fails.
    if (!enabled) {
      this.#consent = "disabled";
      this.#clear();
    }
    const consent = enabled ? "enabled" : "disabled";
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(this.#file), { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, consent }) + "\n", {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.#file);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    this.#consent = consent;
    this.#start();
    this.#recordScreen();
  }

  #recordScreen() {
    if (!this.#allowed || !this.#screen || this.#lastScreen === this.#screen) return;
    this.#lastScreen = this.#screen;
    this.#send("screen_view", { screen: this.#screen });
  }

  #send(eventName: "app_started" | "screen_view", props: Record<string, string> = {}) {
    const key = ninaPublicConfiguration.aptabaseAppKey;
    if (!this.#allowed || !key || this.#requests.size >= 8) return;
    const now = Date.now();
    if (!this.#sessionId || now - this.#lastActivity >= 60 * 60 * 1000)
      this.#sessionId = randomUUID();
    this.#lastActivity = now;
    const controller = new AbortController();
    this.#requests.add(controller);
    const timeout = setTimeout(() => {
      controller.abort();
    }, 5000);
    timeout.unref();
    // Aptabase's public capture protocol; deliberately no SDK renderer protocol or IPC.
    void fetch("https://eu.aptabase.com/api/v0/event", {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "App-Key": key },
      body: JSON.stringify({
        timestamp: new Date(now).toISOString(),
        sessionId: this.#sessionId,
        eventName,
        systemProps: {
          isDebug: ninaPublicConfiguration.environment === "dev",
          locale: app.getLocale(),
          osName: os.type(),
          osVersion: os.release(),
          appVersion: app.getVersion(),
          engineName: "Electron",
          engineVersion: process.versions["electron"],
          sdkVersion: "call-nina-capture/1",
        },
        props,
      }),
    })
      .then(async (response) => {
        this.#environment.operationLog(
          "debug",
          response.ok ? "DESKTOP_ANALYTICS_DELIVERED" : "DESKTOP_ANALYTICS_REJECTED",
          selectionId(),
          "usage-analytics",
          undefined,
          "Usage analytics delivery completed.",
          {
            outcome: response.ok ? "ok" : "rejected",
            metadata: { eventName, status: response.status, ...props },
          },
        );
        await response.body?.cancel();
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout);
        this.#requests.delete(controller);
      });
  }

  async handle(request: Request) {
    await this.#ready;
    switch (request.channel) {
      case "analytics/read":
        await this.#writes;
        return this.#environment.success(request, this.#state);
      case "analytics/consent": {
        const write = this.#writes.then(() => this.#save(request.payload.enabled));
        this.#writes = write.catch(() => undefined);
        try {
          await write;
        } catch {
          return this.#environment.failure(request, "analytics-preference-save");
        }
        return this.#environment.success(request, this.#state);
      }
      case "analytics/screen":
        this.#screen = request.payload.screen;
        if (!this.#screen) this.#lastScreen = null;
        this.#recordScreen();
        return this.#environment.success(request, { accepted: true });
      case "feedback/open": {
        const configured = ninaPublicConfiguration.tallyFeedbackUrl;
        if (!configured || !this.#environment.openExternal)
          return this.#environment.failure(request, "unsupported-operation");
        const url = new URL(configured);
        url.searchParams.set("app_version", app.getVersion());
        url.searchParams.set("os", process.platform);
        url.searchParams.set("interface_language", request.payload.locale);
        url.searchParams.set("environment", ninaPublicConfiguration.environment ?? "unconfigured");
        try {
          await this.#environment.openExternal(url.href);
        } catch {
          return this.#environment.failure(request, "handoff");
        }
        return this.#environment.success(request, { opened: true });
      }
    }
  }
}
