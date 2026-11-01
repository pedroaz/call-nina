import { interfaceMessage } from "./localization.js";
import {
  accountStateSchema,
  chatgptAccountsSchema,
  chatgptRegistrationIdSchema,
  correlationIdSchema,
  z,
  type CorrelationId,
  type Language,
  type DesktopIpcEvent,
} from "@call-nina/contracts";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { safeError } from "./backend-support.js";
import { ChatgptCatalog } from "./chatgpt/catalog.js";
import {
  apiOrigin,
  authOrigin,
  boundedBody,
  ChatgptError,
  chatgptFailure,
  equal,
  jsonRequest,
  random,
  scopes,
} from "./chatgpt/http.js";
import { validateIdentity } from "./chatgpt/identity.js";
import { ChatgptStore, tokenSchema, type Registration } from "./chatgpt/store.js";
import type { ConnectionSecretStorage } from "./secret-storage.js";

export { boundedBody, ChatgptError, chatgptFailure, responseFailure } from "./chatgpt/http.js";

type LoginState = Extract<DesktopIpcEvent, { event: "account-login" }>["state"];
type Pending = {
  id: CorrelationId;
  state: string;
  nonce: string;
  verifier: string;
  registrationId: string | null;
  server: Server;
  redirectUri: string;
  expires: ReturnType<typeof setTimeout>;
  controller: AbortController;
  claimed: boolean;
};

/** Device-owned OAuth state. Never reads external Codex homes or portable learner files. */
export class ChatgptSession {
  readonly #interfaceLocale: () => Promise<Language | undefined>;
  readonly #openExternal: (url: string) => Promise<void>;
  #emit: (event: DesktopIpcEvent) => void = () => undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #pending: Pending | undefined;
  readonly #store: ChatgptStore;
  readonly #catalog: ChatgptCatalog;
  #closed = false;
  constructor(options: {
    configDirectory: string;
    interfaceLocale: () => Promise<Language | undefined>;
    secrets: ConnectionSecretStorage;
    openExternal: (url: string) => Promise<void>;
  }) {
    this.#store = new ChatgptStore(options.configDirectory, options.secrets);
    this.#catalog = new ChatgptCatalog({
      selectedRegistration: () => this.selectedRegistration(),
      token: (signal, id) => this.token(signal, id),
      closed: () => this.#closed,
    });
    this.#openExternal = options.openExternal;
    this.#interfaceLocale = options.interfaceLocale;
  }
  subscribe(emit: (event: DesktopIpcEvent) => void) {
    this.#emit = emit;
  }
  get pendingLoginId() {
    return this.#pending?.id;
  }
  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #changed() {
    this.#catalog.reset();
    for (const scope of ["account", "models", "ai-connections"] as const)
      this.#emit({ event: "state-invalidated", scope });
  }
  #loginEvent(id: CorrelationId, state: LoginState) {
    this.#emit({ event: "account-login", loginId: id, state });
  }
  async accounts() {
    return this.#exclusive(async () => {
      if (this.#store.state().status !== "available")
        return chatgptAccountsSchema.parse({
          state: { status: "unavailable", reason: "account-read-failed" },
          selectedId: null,
          registrations: [],
          remoteRevocationPending: false,
        });
      const store = await this.#store.read();
      const selected = store.registrations.find((entry) => entry.id === store.selectedId);
      return chatgptAccountsSchema.parse({
        state: selected?.tokens
          ? { status: selected.invalid ? "expired" : "signed-in", planType: null }
          : { status: "signed-out" },
        selectedId: store.selectedId,
        registrations: store.registrations.map(({ id, label }) => ({ id, label })),
        remoteRevocationPending: store.remoteRevocationPending,
      });
    });
  }
  async account() {
    return (await this.accounts()).state;
  }
  async selectedRegistration() {
    return (await this.accounts()).selectedId;
  }
  async token(signal: AbortSignal, expectedId?: string): Promise<string> {
    return this.#exclusive(async () => {
      signal.throwIfAborted();
      if (this.#closed || this.#pending)
        throw new ChatgptError("authentication", "OD_CHATGPT_SIGN_IN_PENDING");
      const store = await this.#store.read();
      const selected = store.registrations.find((entry) => entry.id === store.selectedId);
      if (
        !selected?.tokens ||
        selected.invalid ||
        (expectedId !== undefined && expectedId !== selected.id)
      )
        throw new ChatgptError("authentication", "OD_CHATGPT_SIGN_IN_REQUIRED");
      if (Date.now() < selected.savedAt + selected.tokens.expires_in * 1000 - 60000)
        return selected.tokens.access_token;
      if (
        selected.tokens.earliest_refresh_at !== undefined &&
        Date.now() / 1000 < selected.tokens.earliest_refresh_at
      )
        throw new ChatgptError("authentication", "OD_CHATGPT_REFRESH_NOT_YET_ELIGIBLE");
      const response = await fetch(`${authOrigin}/api/accounts/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: selected.id,
          refresh_token: selected.tokens.refresh_token,
          resource: `${apiOrigin}/v1`,
        }),
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(20000),
      });
      // Refresh rotation must settle and be saved even if its original learning request cancels.
      const raw = await boundedBody(response, 131072);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ChatgptError("app-server", "OD_CHATGPT_REFRESH_INVALID");
      }
      if (!response.ok) {
        const code = z.object({ error: z.string().optional() }).safeParse(parsed);
        if (
          code.success &&
          [
            "invalid_grant",
            "invalid_refresh_token",
            "token_expired",
            "refresh_token_expired",
            "refresh_token_invalidated",
            "refresh_token_reused",
          ].includes(code.data.error ?? "")
        ) {
          selected.tokens = null;
          selected.invalid = true;
          await this.#store.write(store);
          this.#changed();
          throw new ChatgptError("authentication", "OD_CHATGPT_SIGN_IN_REQUIRED");
        }
        throw chatgptFailure(response.status);
      }
      const next = tokenSchema.parse({
        ...z.looseObject({}).parse(parsed),
        scope:
          z.object({ scope: z.string().optional() }).parse(parsed).scope ?? selected.tokens.scope,
        id_token:
          z.object({ id_token: z.string().optional() }).parse(parsed).id_token ??
          selected.tokens.id_token,
      });
      if (!next.scope.split(" ").includes("chatgpt.tokens.use.direct"))
        throw new ChatgptError("authentication", "OD_CHATGPT_PLAN_PERMISSION_REQUIRED");
      selected.tokens = next;
      selected.savedAt = Date.now();
      await this.#store.write(store);
      signal.throwIfAborted();
      return next.access_token;
    });
  }
  models(signal?: AbortSignal) {
    return this.#catalog.models(signal);
  }
  async startLogin(registrationId: string | null, uiLocale: Language): Promise<CorrelationId> {
    return this.#exclusive(async () => {
      if (this.#pending || this.#closed) throw new Error("OD_CHATGPT_LOGIN_CONFLICT");
      const store = await this.#store.read();
      if (
        registrationId !== null &&
        !store.registrations.some((entry) => entry.id === registrationId)
      )
        throw new Error("OD_CHATGPT_REGISTRATION_UNKNOWN");
      if (registrationId === null && store.registrations.length >= 20)
        throw new Error("OD_CHATGPT_ACCOUNT_LIMIT");
      const id = correlationIdSchema.parse(`correlation_${randomBytes(16).toString("hex")}`);
      const server = createServer((request, response) => {
        const attempt = this.#pending;
        const finish = (status: number, key: Parameters<typeof interfaceMessage>[1]) => {
          void this.#interfaceLocale()
            .catch(() => undefined)
            .then((language) => {
              response.writeHead(status, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
                "X-Content-Type-Options": "nosniff",
              });
              response.end(interfaceMessage(language ?? uiLocale, key));
            });
        };
        if (
          !attempt ||
          attempt.id !== id ||
          request.method !== "GET" ||
          request.url === undefined ||
          request.url.length > 16384 ||
          request.headers.host !== new URL(attempt.redirectUri).host
        ) {
          finish(400, "invalidCallback");
          return;
        }
        const url = new URL(request.url, attempt.redirectUri);
        const single = (key: string) =>
          url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null;
        if (
          url.pathname !== "/auth/callback" ||
          attempt.claimed ||
          !equal(single("state"), attempt.state)
        ) {
          finish(400, "expiredCallback");
          return;
        }
        attempt.claimed = true;
        void this.#completeLogin(attempt, url).then(
          () => {
            finish(200, "connected");
          },
          () => {
            finish(400, "loginFailed");
          },
        );
      });
      server.requestTimeout = 15000;
      server.headersTimeout = 10000;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      server.on("error", () => {
        void this.cancelLogin(id);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("OD_CHATGPT_CALLBACK_UNAVAILABLE");
      const attempt: Pending = {
        id,
        state: random(),
        nonce: random(),
        verifier: random(),
        registrationId,
        server,
        redirectUri: `http://127.0.0.1:${String(address.port)}/auth/callback`,
        controller: new AbortController(),
        claimed: false,
        expires: setTimeout(() => {
          void this.cancelLogin(id);
        }, 10 * 60000),
      };
      attempt.expires.unref();
      this.#pending = attempt;
      const parameters: Record<string, string> = {
        client_id: registrationId ?? "dynamic_agent_client",
        ext_agent_host_id: `urn:uuid:${store.hostId}`,
        redirect_uri: attempt.redirectUri,
        response_type: "code",
        scope: scopes,
        resource: `${apiOrigin}/v1`,
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
      };
      if (registrationId === null) parameters["agent_name_hint"] = "Call Nina";
      // Browser account selection avoids placing identity-bearing ID-token hints in URLs.
      try {
        await this.#openExternal(
          `${authOrigin}/api/accounts/authorize?${new URLSearchParams(parameters).toString()}`,
        );
      } catch {
        this.#finishLogin(attempt);
        throw new Error("OD_CHATGPT_BROWSER_UNAVAILABLE");
      }
      return id;
    });
  }

  async #completeLogin(attempt: Pending, url: URL) {
    try {
      if (url.searchParams.has("error")) throw new Error("OD_CHATGPT_LOGIN_DECLINED");
      const values = (key: string) =>
        url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null;
      const id = chatgptRegistrationIdSchema.parse(values("client_id") ?? attempt.registrationId);
      if (attempt.registrationId !== null && attempt.registrationId !== id)
        throw new Error("OD_CHATGPT_ACCOUNT_CHANGED");
      const code = values("code");
      if (!code || code.length > 8192) throw new Error("OD_CHATGPT_CODE_INVALID");
      const signal = AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(30000)]);
      const tokens = tokenSchema.parse(
        await jsonRequest(`${authOrigin}/api/accounts/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: id,
            code,
            code_verifier: attempt.verifier,
            redirect_uri: attempt.redirectUri,
            resource: `${apiOrigin}/v1`,
          }),
          signal,
        }),
      );
      const identity = await validateIdentity(tokens.id_token, id, attempt.nonce, signal);
      if (!tokens.scope.split(" ").includes("chatgpt.tokens.use.direct"))
        throw new Error("OD_CHATGPT_PLAN_PERMISSION_REQUIRED");
      await this.#exclusive(async () => {
        signal.throwIfAborted();
        if (this.#pending !== attempt || this.#closed)
          throw new Error("OD_CHATGPT_LOGIN_CANCELLED");
        const store = await this.#store.read();
        const prior = store.registrations.find((entry) => entry.id === id);
        if (prior && prior.subject !== identity.sub) throw new Error("OD_CHATGPT_ACCOUNT_CHANGED");
        const next: Registration = {
          id,
          subject: identity.sub,
          label: `${identity.email ?? "ChatGPT"} · ${id.slice(-8)}`,
          tokens,
          savedAt: Date.now(),
          invalid: false,
        };
        store.registrations = [...store.registrations.filter((entry) => entry.id !== id), next];
        store.selectedId = id;
        await this.#store.write(store);
        this.#finishLogin(attempt);
        this.#changed();
        this.#loginEvent(attempt.id, { status: "complete" });
      });
    } catch {
      if (this.#pending === attempt) {
        this.#finishLogin(attempt);
        this.#loginEvent(attempt.id, {
          status: "failed",
          error: safeError("authentication", attempt.id),
        });
      }
      throw new Error("OD_CHATGPT_LOGIN_FAILED");
    }
  }
  #finishLogin(attempt: Pending) {
    clearTimeout(attempt.expires);
    attempt.controller.abort();
    attempt.server.close();
    attempt.server.closeIdleConnections();
    if (this.#pending === attempt) this.#pending = undefined;
  }
  cancelLogin(id: CorrelationId) {
    const attempt = this.#pending;
    if (!attempt || attempt.id !== id) return false;
    // Invalidate before waiting for an in-flight token exchange to settle.
    this.#finishLogin(attempt);
    this.#loginEvent(id, { status: "cancelled" });
    return true;
  }
  async logout() {
    return this.#exclusive(async () => {
      if (this.#pending) throw new Error("OD_CHATGPT_LOGIN_CONFLICT");
      const store = await this.#store.read();
      const selected = store.registrations.find((entry) => entry.id === store.selectedId);
      if (selected?.tokens) {
        let revoked = false;
        try {
          const discovery = z
            .object({ issuer: z.literal(authOrigin), revocation_endpoint: z.url() })
            .parse(await jsonRequest(`${authOrigin}/.well-known/openid-configuration`));
          if (new URL(discovery.revocation_endpoint).origin !== authOrigin)
            throw new Error("OD_CHATGPT_ISSUER_INVALID");
          const response = await fetch(discovery.revocation_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: selected.tokens.refresh_token,
              token_type_hint: "refresh_token",
              client_id: selected.id,
            }),
            redirect: "error",
            credentials: "omit",
            signal: AbortSignal.timeout(15000),
          });
          revoked = response.status === 200;
          await response.body?.cancel();
        } catch {
          /* Local sign-out still clears tokens; the UI reports unconfirmed revocation. */
        }
        store.remoteRevocationPending = !revoked;
        selected.tokens = null;
        selected.invalid = false;
        await this.#store.write(store);
      }
      this.#changed();
      return accountStateSchema.parse({ status: "signed-out" });
    });
  }
  async shutdown() {
    this.#closed = true;
    if (this.#pending) this.cancelLogin(this.#pending.id);
    await this.#queue;
  }
}
