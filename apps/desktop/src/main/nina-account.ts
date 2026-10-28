import { readBounded } from "@call-nina/managed-generation/client";
import {
  ninaAccessSchema,
  ninaPublicConfiguration,
  type NinaAccountState,
} from "@call-nina/contracts";

/** Only the server establishes identity. Session JWTs are short-lived and memory-only here. */
export class NinaAccount {
  state: NinaAccountState = { status: "signed-out", access: null };
  epoch = 0;
  #token: string | null = null;
  #expires = 0;
  constructor(private readonly invalidate: () => Promise<void>) {}
  #queue: Promise<unknown> = Promise.resolve();
  update(status: NinaAccountState["status"], token: string | null): Promise<NinaAccountState> {
    const work = this.#queue.then(() => this.#update(status, token));
    this.#queue = work.catch(() => undefined);
    return work;
  }
  async #update(
    status: NinaAccountState["status"],
    token: string | null,
  ): Promise<NinaAccountState> {
    if (status !== "signed-in" || !token) {
      this.epoch++;
      this.#token = null;
      this.state = { status, access: null };
      await this.invalidate();
      return this.state;
    }
    const origin = ninaPublicConfiguration.serviceOrigin;
    if (!origin) return this.#update("unavailable", null);
    try {
      const signal = AbortSignal.timeout(10000);
      const response = await fetch(`${origin}/api/account`, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        credentials: "omit",
        signal,
      });
      if (response.status === 401) return this.#update("expired", null);
      if (!response.ok) return this.#update("unavailable", null);
      const body = await readBounded(response.body, 4096, signal);
      const access = ninaAccessSchema.parse(JSON.parse(body));
      const encoded = token.split(".")[1];
      const claims: unknown = JSON.parse(Buffer.from(encoded ?? "", "base64url").toString("utf8"));
      const exp =
        typeof claims === "object" && claims !== null && "exp" in claims ? claims.exp : undefined;
      if (typeof exp !== "number" || exp * 1000 <= Date.now()) return this.#update("expired", null);
      if (access.userId !== this.state.access?.userId) {
        this.epoch++;
        this.#token = null;
        this.state = { status: "signing-in", access: null };
        await this.invalidate();
      }
      if (this.state.access?.hostedAiEnabled && !access.hostedAiEnabled) await this.invalidate();
      this.#token = token;
      this.#expires = exp * 1000;
      this.state = { status: "signed-in", access };
      return this.state;
    } catch {
      return this.#update("unavailable", null);
    }
  }
  async token(epoch: number): Promise<string> {
    this.assert(epoch);
    if (!this.#token || Date.now() >= this.#expires) throw new Error("OD_NINA_SESSION_EXPIRED");
    return this.#token;
  }
  assertAi(epoch: number): void {
    this.assert(epoch);
    if (!this.state.access?.hostedAiEnabled || !this.state.access.inferenceEnabled)
      throw new Error("OD_NINA_AI_DISABLED");
  }
  assert(epoch: number): void {
    if (epoch !== this.epoch || this.state.status !== "signed-in" || !this.state.access)
      throw new Error("OD_NINA_ACCOUNT_UNAVAILABLE");
  }
}
