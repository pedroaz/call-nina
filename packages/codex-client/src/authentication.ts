import { randomBytes } from "node:crypto";

import {
  accountStateSchema,
  correlationIdSchema,
  type CorrelationId,
  type z,
} from "@call-nina/contracts";

import {
  AppServerProjectionError,
  isHttpsUrl,
  isJsonObject,
  requiredNonblankString,
  type AppServerRequester,
} from "./projections.js";

export type ManagedLoginMethod = "browser" | "device-code";
export type AccountState = z.output<typeof accountStateSchema>;
export type ManagedLoginState =
  | Readonly<{ status: "opening-browser" | "waiting" | "complete" | "cancelled" }>
  | Readonly<{ status: "failed"; reason: "login-failed" | "invalid-response" }>;

export type ManagedAuthenticationOptions = Readonly<{
  requester: AppServerRequester;
  openExternal?: (url: string) => Promise<void> | void;
  presentDeviceCode?: (
    value: Readonly<{ verificationUrl: string; userCode: string }>,
  ) => Promise<void> | void;
  onAccountChanged?: (state: AccountState) => void;
  onLoginChanged?: (loginId: CorrelationId, state: ManagedLoginState) => void;
  requestTimeoutMilliseconds?: number;
  settleAttempts?: number;
  settleDelayMilliseconds?: number;
}>;

type PendingLogin = Readonly<{ publicId: CorrelationId; runtimeId: string }>;
type EarlyCompletion = Readonly<{ runtimeId: string; success: boolean; errorPresent: boolean }>;

function newCorrelationId(): CorrelationId {
  return correlationIdSchema.parse(`correlation_${randomBytes(16).toString("hex")}`);
}

export function projectAccountState(value: unknown): AccountState {
  if (!isJsonObject(value) || typeof value["requiresOpenaiAuth"] !== "boolean") {
    return { status: "unsupported", reason: "account-shape" };
  }
  const account = value["account"];
  if (account === null) return { status: "signed-out" };
  if (!isJsonObject(account)) return { status: "unsupported", reason: "account-shape" };
  if (account["type"] !== "chatgpt") {
    return { status: "unsupported", reason: "authentication-method" };
  }
  const planType = account["planType"];
  if (
    planType !== null &&
    planType !== undefined &&
    (typeof planType !== "string" || !planType.trim())
  ) {
    return { status: "unsupported", reason: "account-shape" };
  }
  return accountStateSchema.parse({
    status: "signed-in",
    planType: typeof planType === "string" ? planType.trim() : null,
  });
}

function isOfficialAuthenticationUrl(value: string): boolean {
  if (!isHttpsUrl(value)) return false;
  const url = new URL(value);
  return (
    ["auth.openai.com", "chatgpt.com"].includes(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.hash
  );
}

function loginParameters(method: string): Record<string, unknown> {
  if (method === "device-code") return { type: "chatgptDeviceCode" };
  if (method === "browser") {
    return { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" };
  }
  throw new AppServerProjectionError("CALL_NINA_MANAGED_CHATGPT_ONLY");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ManagedAuthenticationClient {
  readonly #options: ManagedAuthenticationOptions;
  #pending: PendingLogin | undefined;
  #startingLogin = false;
  #earlyCompletion: EarlyCompletion | undefined;

  constructor(options: ManagedAuthenticationOptions) {
    this.#options = options;
  }

  pendingLoginId(): CorrelationId | null {
    return this.#pending?.publicId ?? null;
  }

  async restore(): Promise<AccountState> {
    return this.readAccount();
  }

  async readAccount(): Promise<AccountState> {
    let state: AccountState;
    try {
      const result = await this.#options.requester.request(
        "account/read",
        { refreshToken: false },
        { timeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 10_000 },
      );
      state = projectAccountState(result);
    } catch {
      state = { status: "unavailable", reason: "account-read-failed" };
    }
    this.#options.onAccountChanged?.(state);
    return state;
  }

  async startManagedLogin(method: ManagedLoginMethod): Promise<CorrelationId> {
    if (this.#pending || this.#startingLogin)
      throw new AppServerProjectionError("APP_SERVER_LOGIN_ALREADY_PENDING");
    this.#startingLogin = true;
    let result: unknown;
    try {
      result = await this.#options.requester.request(
        "account/login/start",
        loginParameters(method),
        { timeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 10_000 },
      );
    } catch (error) {
      this.#startingLogin = false;
      this.#earlyCompletion = undefined;
      throw error;
    }
    if (!isJsonObject(result)) {
      this.#startingLogin = false;
      this.#earlyCompletion = undefined;
      throw new AppServerProjectionError("APP_SERVER_LOGIN_RESPONSE_INVALID");
    }
    let runtimeId: string;
    try {
      runtimeId = requiredNonblankString(result["loginId"]);
    } catch {
      this.#startingLogin = false;
      this.#earlyCompletion = undefined;
      throw new AppServerProjectionError("APP_SERVER_LOGIN_RESPONSE_INVALID");
    }
    const publicId = newCorrelationId();
    this.#pending = { publicId, runtimeId };
    this.#startingLogin = false;
    try {
      if (method === "browser") {
        if (result["type"] !== "chatgpt") throw new Error("type");
        const authUrl = requiredNonblankString(result["authUrl"], 2_000);
        if (!isOfficialAuthenticationUrl(authUrl) || !this.#options.openExternal)
          throw new Error("browser");
        this.#emitLogin(publicId, { status: "opening-browser" });
        await this.#options.openExternal(authUrl);
        this.#emitLogin(publicId, { status: "waiting" });
      } else {
        if (result["type"] !== "chatgptDeviceCode") throw new Error("type");
        const verificationUrl = requiredNonblankString(result["verificationUrl"], 2_000);
        const userCode = requiredNonblankString(result["userCode"], 32);
        if (!isOfficialAuthenticationUrl(verificationUrl) || !/^[A-Z0-9-]{4,32}$/u.test(userCode)) {
          throw new Error("device");
        }
        if (!this.#options.presentDeviceCode) throw new Error("device-presenter");
        await this.#options.presentDeviceCode({ verificationUrl, userCode });
        this.#emitLogin(publicId, { status: "waiting" });
      }
      const early = this.#earlyCompletion;
      this.#earlyCompletion = undefined;
      if (early?.runtimeId === runtimeId) {
        await this.#finishCompletion(this.#pending, early.success, early.errorPresent);
      }
      return publicId;
    } catch {
      try {
        await this.#options.requester.request(
          "account/login/cancel",
          { loginId: runtimeId },
          { timeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 10_000 },
        );
      } catch {
        // The invalid response remains the authoritative failure; cancellation is best effort.
      }
      this.#pending = undefined;
      this.#startingLogin = false;
      this.#earlyCompletion = undefined;
      this.#emitLogin(publicId, { status: "failed", reason: "invalid-response" });
      throw new AppServerProjectionError("APP_SERVER_LOGIN_RESPONSE_INVALID");
    }
  }

  async cancelManagedLogin(loginId: CorrelationId): Promise<void> {
    const pending = this.#pending;
    if (!pending || pending.publicId !== loginId) {
      throw new AppServerProjectionError("APP_SERVER_LOGIN_NOT_PENDING");
    }
    await this.#options.requester.request(
      "account/login/cancel",
      { loginId: pending.runtimeId },
      { timeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 10_000 },
    );
    this.#pending = undefined;
    this.#emitLogin(loginId, { status: "cancelled" });
  }

  async logout(): Promise<AccountState> {
    if (this.#pending) await this.cancelManagedLogin(this.#pending.publicId);
    await this.#options.requester.request("account/logout", undefined, {
      timeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 10_000,
    });
    return this.readAccount();
  }

  async handleNotification(method: string, params: unknown): Promise<boolean> {
    if (method === "account/updated") {
      await this.readAccount();
      return true;
    }
    if (method !== "account/login/completed" || !isJsonObject(params)) return false;
    const pending = this.#pending;
    if (
      !pending &&
      this.#startingLogin &&
      typeof params["loginId"] === "string" &&
      params["loginId"].trim().length > 0 &&
      typeof params["success"] === "boolean"
    ) {
      this.#earlyCompletion = {
        runtimeId: params["loginId"].slice(0, 200),
        success: params["success"],
        errorPresent: params["error"] !== null && params["error"] !== undefined,
      };
      return true;
    }
    if (
      !pending ||
      params["loginId"] !== pending.runtimeId ||
      typeof params["success"] !== "boolean"
    ) {
      return false;
    }
    await this.#finishCompletion(
      pending,
      params["success"],
      params["error"] !== null && params["error"] !== undefined,
    );
    return true;
  }

  async #finishCompletion(
    pending: PendingLogin | undefined,
    success: boolean,
    errorPresent: boolean,
  ): Promise<void> {
    if (!pending) return;
    this.#pending = undefined;
    if (!success) {
      this.#emitLogin(
        pending.publicId,
        errorPresent ? { status: "failed", reason: "login-failed" } : { status: "cancelled" },
      );
      return;
    }
    const state = await this.#settleSignedIn();
    this.#emitLogin(
      pending.publicId,
      state.status === "signed-in"
        ? { status: "complete" }
        : { status: "failed", reason: "login-failed" },
    );
  }

  async #settleSignedIn(): Promise<AccountState> {
    const attempts = this.#options.settleAttempts ?? 20;
    let state: AccountState = { status: "unavailable", reason: "account-read-failed" };
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      state = await this.readAccount();
      if (state.status === "signed-in" || state.status === "unsupported") return state;
      if (attempt + 1 < attempts) await wait(this.#options.settleDelayMilliseconds ?? 100);
    }
    return state;
  }

  #emitLogin(loginId: CorrelationId, state: ManagedLoginState): void {
    this.#options.onLoginChanged?.(loginId, state);
  }
}
