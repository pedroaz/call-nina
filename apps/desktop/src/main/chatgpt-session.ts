import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import {
  randomBytes,
  randomUUID,
  createHash,
  createPublicKey,
  verify,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { safeStorage } from "electron";
import {
  accountStateSchema,
  modelCatalogSchema,
  chatgptAccountsSchema,
  chatgptRegistrationIdSchema,
  correlationIdSchema,
  z,
  type CorrelationId,
  type DesktopIpcEvent,
  type ErrorKind,
} from "@call-nina/contracts";
import type { ConnectionSecretStorage } from "./secret-storage.js";
import { safeError } from "./backend-support.js";

const authOrigin = "https://auth.openai.com";
const apiOrigin = "https://api.openai.com";
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const tokenSchema = z.object({
  access_token: z.string().min(1).max(32000),
  refresh_token: z.string().min(1).max(32000),
  id_token: z.string().min(1).max(32000),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  expires_in: z.number().positive().max(86400),
  scope: z.string().max(2000),
  earliest_refresh_at: z.number().nonnegative().optional(),
});
const registrationSchema = z.strictObject({
  id: chatgptRegistrationIdSchema,
  subject: z.string().min(1).max(512),
  label: z.string().min(1).max(320),
  tokens: tokenSchema.nullable(),
  savedAt: z.number().nonnegative(),
  invalid: z.boolean(),
});
const storeSchema = z
  .strictObject({
    version: z.literal(1),
    hostId: z.uuid(),
    selectedId: chatgptRegistrationIdSchema.nullable(),
    registrations: z.array(registrationSchema).max(20),
    remoteRevocationPending: z.boolean(),
  })
  .superRefine((value, context) => {
    const ids = value.registrations.map((entry) => entry.id);
    if (
      new Set(ids).size !== ids.length ||
      (value.selectedId !== null && !ids.includes(value.selectedId))
    )
      context.addIssue({ code: "custom", message: "OD_CHATGPT_STORE_INVALID" });
  });
type Store = z.infer<typeof storeSchema>;
type Registration = Store["registrations"][number];
type Catalog = z.infer<typeof modelCatalogSchema>;
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
const random = () => randomBytes(32).toString("base64url");
const equal = (left: unknown, right: string) =>
  typeof left === "string" &&
  Buffer.byteLength(left) === Buffer.byteLength(right) &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));

export class ChatgptError extends Error {
  constructor(
    readonly kind: ErrorKind,
    code: string,
  ) {
    super(code);
  }
}
export function chatgptFailure(status: number, code?: string): ChatgptError {
  if (code === "subscription_sharing_usage_limit_exceeded" || status === 429)
    return new ChatgptError("rate-limit", "OD_CHATGPT_USAGE_LIMIT");
  if (
    [
      "subscription_sharing_user_not_eligible",
      "subscription_sharing_unsupported_capability",
      "subscription_sharing_route_not_supported",
    ].includes(code ?? "")
  )
    return new ChatgptError("ai-policy", "OD_CHATGPT_POLICY_REJECTED");
  if (
    status === 401 ||
    [
      "subscription_sharing_invalid_user",
      "chatpass_v2_scope_not_authorized",
      "chatpass_v2_invalid_authorization_context",
    ].includes(code ?? "")
  )
    return new ChatgptError("authentication", "OD_CHATGPT_AUTHENTICATION_REQUIRED");
  if (status === 400 || status === 403)
    return new ChatgptError("ai-policy", "OD_CHATGPT_REQUEST_REJECTED");
  return new ChatgptError("app-server", "OD_CHATGPT_UNAVAILABLE");
}
export async function boundedBody(response: Response, maximum: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ChatgptError("app-server", "OD_CHATGPT_RESPONSE_EMPTY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const value: unknown = part.value;
      if (!(value instanceof Uint8Array))
        throw new ChatgptError("app-server", "OD_CHATGPT_RESPONSE_INVALID");
      size += value.byteLength;
      if (size > maximum) throw new ChatgptError("model-output", "OD_CHATGPT_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
const failureBodySchema = z.object({
  error: z.object({ code: z.string().max(160).optional() }).optional(),
});
export async function responseFailure(response: Response) {
  let code: string | undefined;
  try {
    code = failureBodySchema.parse(JSON.parse(await boundedBody(response, 65536))).error?.code;
  } catch {
    /* Never expose untrusted error bodies. */
  }
  return chatgptFailure(response.status, code);
}
async function jsonRequest(url: string, options: RequestInit = {}) {
  if (new URL(url).origin !== authOrigin && new URL(url).origin !== apiOrigin)
    throw new ChatgptError("ai-policy", "OD_CHATGPT_DESTINATION_REJECTED");
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    credentials: "omit",
    signal: options.signal ?? AbortSignal.timeout(20000),
  });
  if (!response.ok) throw await responseFailure(response);
  return JSON.parse(await boundedBody(response, 2 * 1024 * 1024)) as unknown;
}

/** Device-owned OAuth state. Never reads external Codex homes or portable learner files. */
export class ChatgptSession {
  readonly #configDirectory: string;
  readonly #secrets: ConnectionSecretStorage;
  readonly #openExternal: (url: string) => Promise<void>;
  #emit: (event: DesktopIpcEvent) => void = () => undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #pending: Pending | undefined;
  #catalog: { registrationId: string; value: Catalog; expires: number } | undefined;
  #closed = false;
  constructor(options: {
    configDirectory: string;
    secrets: ConnectionSecretStorage;
    openExternal: (url: string) => Promise<void>;
  }) {
    this.#configDirectory = options.configDirectory;
    this.#secrets = options.secrets;
    this.#openExternal = options.openExternal;
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
  async #directory() {
    const directory = path.join(this.#configDirectory, "chatgpt-plan");
    let cursor = path.parse(directory).root;
    for (const part of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error("OD_CHATGPT_STORAGE_UNSAFE");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new Error("OD_CHATGPT_STORAGE_UNSAFE");
    return directory;
  }
  async #read(): Promise<Store> {
    if (this.#secrets.state().status !== "available")
      throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    const filename = path.join(await this.#directory(), "accounts.enc");
    let file;
    try {
      file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      const created: Store = {
        version: 1,
        hostId: randomUUID(),
        selectedId: null,
        registrations: [],
        remoteRevocationPending: false,
      };
      await this.#write(created);
      return created;
    }
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size > 2 * 1024 * 1024 ||
        (process.platform !== "win32" &&
          ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
      )
        throw new Error("OD_CHATGPT_STORAGE_UNSAFE");
      const bytes = await file.readFile();
      try {
        return storeSchema.parse(JSON.parse(safeStorage.decryptString(bytes)));
      } finally {
        bytes.fill(0);
      }
    } finally {
      await file.close();
    }
  }
  async #write(value: Store) {
    if (this.#secrets.state().status !== "available")
      throw new Error("OD_SECURE_STORAGE_UNAVAILABLE");
    const directory = await this.#directory();
    const bytes = safeStorage.encryptString(JSON.stringify(storeSchema.parse(value)));
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path.join(directory, "accounts.enc"));
      if (process.platform !== "win32") {
        const handle = await open(directory, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    } finally {
      bytes.fill(0);
      await unlink(temporary).catch(() => undefined);
    }
  }
  #changed() {
    this.#catalog = undefined;
    for (const scope of ["account", "models", "ai-connections"] as const)
      this.#emit({ event: "state-invalidated", scope });
  }
  #loginEvent(id: CorrelationId, state: LoginState) {
    this.#emit({ event: "account-login", loginId: id, state });
  }
  async accounts() {
    return this.#exclusive(async () => {
      if (this.#secrets.state().status !== "available")
        return chatgptAccountsSchema.parse({
          state: { status: "unavailable", reason: "account-read-failed" },
          selectedId: null,
          registrations: [],
          remoteRevocationPending: false,
        });
      const store = await this.#read();
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
      const store = await this.#read();
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
          await this.#write(store);
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
      await this.#write(store);
      signal.throwIfAborted();
      return next.access_token;
    });
  }
  async models(signal: AbortSignal = AbortSignal.timeout(20000)): Promise<Catalog> {
    const id = await this.selectedRegistration();
    if (!id) throw new ChatgptError("authentication", "OD_CHATGPT_SIGN_IN_REQUIRED");
    if (this.#catalog?.registrationId === id && this.#catalog.expires > Date.now())
      return structuredClone(this.#catalog.value);
    const token = await this.token(signal, id);
    const response = await jsonRequest(`${apiOrigin}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    const modelSchema = z.object({
      slug: z.string().min(1).max(200),
      display_name: z.string().min(1).max(200),
      visibility: z.string(),
      input_modalities: z.array(z.string()).optional(),
      default_reasoning_level: z.string().nullable().optional(),
      supported_reasoning_levels: z
        .array(z.object({ effort: z.string().min(1).max(100) }))
        .max(20)
        .optional(),
    });
    const listed = z
      .object({ models: z.array(modelSchema).max(500) })
      .parse(response)
      .models.filter(
        (entry) =>
          entry.visibility === "list" && (entry.input_modalities ?? ["text"]).includes("text"),
      );
    const models = listed.map((entry, index) => ({
      id: entry.slug,
      displayName: entry.display_name,
      isDefault: index === 0,
      defaultReasoningEffort: entry.default_reasoning_level ?? null,
      supportedReasoningEfforts: (entry.supported_reasoning_levels ?? []).map(
        (level) => level.effort,
      ),
      inputModalities: (entry.input_modalities ?? ["text"]).filter(
        (value) => value === "text" || value === "image",
      ),
      upgrade: null,
    }));
    const value = modelCatalogSchema.parse({
      models,
      runtimeDefaultModelId: models[0]?.id ?? null,
      missingReasoningMetadata: models
        .filter((entry) => !entry.defaultReasoningEffort || !entry.supportedReasoningEfforts.length)
        .map((entry) => entry.id),
    });
    if ((await this.selectedRegistration()) !== id || this.#closed)
      throw new ChatgptError("authentication", "OD_CHATGPT_ACCOUNT_CHANGED");
    this.#catalog = { registrationId: id, value, expires: Date.now() + 60000 };
    return value;
  }
  async startLogin(registrationId: string | null): Promise<CorrelationId> {
    return this.#exclusive(async () => {
      if (this.#pending || this.#closed) throw new Error("OD_CHATGPT_LOGIN_CONFLICT");
      const store = await this.#read();
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
        const finish = (status: number, message: string) => {
          response.writeHead(status, {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(message);
        };
        if (
          !attempt ||
          attempt.id !== id ||
          request.method !== "GET" ||
          request.url === undefined ||
          request.url.length > 16384 ||
          request.headers.host !== new URL(attempt.redirectUri).host
        ) {
          finish(400, "Invalid sign-in callback.");
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
          finish(400, "Invalid or expired sign-in callback.");
          return;
        }
        attempt.claimed = true;
        void this.#completeLogin(attempt, url).then(
          () => {
            finish(200, "Call Nina is connected. You can close this tab and return to the app.");
          },
          () => {
            finish(400, "Sign-in did not complete. Return to Call Nina and try again.");
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
  async #validateIdentity(token: string, clientId: string, nonce: string, signal: AbortSignal) {
    const parts = token.split(".");
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    if (parts.length !== 3 || !encodedHeader || !encodedClaims || !encodedSignature)
      throw new Error("OD_CHATGPT_ID_TOKEN_INVALID");
    const header = z
      .object({ alg: z.literal("RS256"), kid: z.string(), crit: z.never().optional() })
      .parse(JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")));
    const discovery = z
      .object({ issuer: z.literal(authOrigin), jwks_uri: z.url() })
      .parse(await jsonRequest(`${authOrigin}/.well-known/openid-configuration`, { signal }));
    if (new URL(discovery.jwks_uri).origin !== authOrigin)
      throw new Error("OD_CHATGPT_ISSUER_INVALID");
    const keys = z
      .object({
        keys: z
          .array(
            z
              .object({
                kid: z.string().optional(),
                kty: z.string(),
                use: z.string().optional(),
                alg: z.string().optional(),
              })
              .loose(),
          )
          .max(100),
      })
      .parse(await jsonRequest(discovery.jwks_uri, { signal }))
      .keys.filter(
        (key) =>
          key.kid === header.kid &&
          key.kty === "RSA" &&
          (!key.use || key.use === "sig") &&
          (!key.alg || key.alg === "RS256"),
      );
    const signingKey = keys[0];
    if (
      keys.length !== 1 ||
      !signingKey ||
      !verify(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        createPublicKey({ key: signingKey, format: "jwk" }),
        Buffer.from(encodedSignature, "base64url"),
      )
    )
      throw new Error("OD_CHATGPT_ID_TOKEN_SIGNATURE_INVALID");
    const claims = z
      .object({
        iss: z.literal(authOrigin),
        aud: z.union([z.string(), z.array(z.string()).min(1)]),
        azp: z.string().optional(),
        sub: z.string().min(1).max(512),
        exp: z.number(),
        iat: z.number(),
        nbf: z.number().optional(),
        nonce: z.string(),
        email: z.string().max(320).optional(),
      })
      .parse(JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")));
    const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    const now = Date.now() / 1000;
    if (
      !audiences.includes(clientId) ||
      (audiences.length > 1 && claims.azp !== clientId) ||
      (claims.azp !== undefined && claims.azp !== clientId) ||
      claims.exp <= now ||
      claims.iat > now + 5 ||
      (claims.nbf !== undefined && claims.nbf > now + 5) ||
      !equal(claims.nonce, nonce)
    )
      throw new Error("OD_CHATGPT_ID_TOKEN_CLAIMS_INVALID");
    return claims;
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
      const identity = await this.#validateIdentity(tokens.id_token, id, attempt.nonce, signal);
      if (!tokens.scope.split(" ").includes("chatgpt.tokens.use.direct"))
        throw new Error("OD_CHATGPT_PLAN_PERMISSION_REQUIRED");
      await this.#exclusive(async () => {
        signal.throwIfAborted();
        if (this.#pending !== attempt || this.#closed)
          throw new Error("OD_CHATGPT_LOGIN_CANCELLED");
        const store = await this.#read();
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
        await this.#write(store);
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
      const store = await this.#read();
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
        await this.#write(store);
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
