import { authenticate, type ClerkPolicy } from "./auth.js";
import { ninaAccessSchema, generationDeadlineMilliseconds, z } from "@call-nina/contracts";
import { type GatewayUsage, generateGatewayAttempt } from "./gateway.js";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  GenerationOutputValidationError,
  runLearningWorkflow,
} from "@call-nina/learning-workflows";
import { PostgresBudget, type BudgetSql } from "./budget.js";
import { policyIsCurrent, servicePolicySchema, type ServicePolicy } from "./policy.js";
import {
  failureCodeSchema,
  limits,
  managedRequestSchema,
  ManagedFailure,
  readBounded,
  type FailureCode,
} from "./protocol.js";

export { openBudgetSql } from "./postgres.js";
export { policyDigest, servicePolicySchema } from "./policy.js";

const statuses: Record<FailureCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
  shutdown: 503,
  exhausted: 429,
  throttled: 429,
  conflict: 409,
  "invalid-request": 400,
  cancelled: 499,
  deadline: 504,
  "invalid-output": 502,
};
function response(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
export function unavailableResponse(): Response {
  return response({ status: "failed", code: "unavailable" }, 503);
}

/** The only trusted context binding is the separate Vercel entrypoint. Never
 * populate this value from a JSON field, arbitrary proxy, cookie or install ID. */
export class ManagedService {
  readonly #policy: ServicePolicy;
  readonly #auth: ClerkPolicy;
  readonly #budget: PostgresBudget;
  readonly #apiKey: string;
  readonly #throttleKey: string;
  readonly #running = new Set<AbortController>();
  #closed = false;
  constructor(options: {
    auth: ClerkPolicy;
    policy: unknown;
    sql: BudgetSql;
    apiKey: string;
    throttleKey: string;
  }) {
    this.#auth = options.auth;
    this.#policy = servicePolicySchema.parse(options.policy);
    this.#apiKey = z.string().min(20).max(4096).regex(/^\S+$/u).parse(options.apiKey);
    this.#throttleKey = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(options.throttleKey);
    this.#budget = new PostgresBudget(options.sql, this.#policy);
  }
  async handle(request: Request, trustedNetworkAddress: string): Promise<Response> {
    const controller = new AbortController();
    const abort = () => {
      controller.abort(new ManagedFailure("cancelled"));
    };
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const timer = setTimeout(() => {
      controller.abort(new ManagedFailure("deadline"));
    }, limits.deadlineMs);
    let reservationId: string | undefined;
    let attempted = 0;
    const started = Date.now();
    let outcome = "unknown";
    const usage: GatewayUsage[] = [];
    this.#running.add(controller);
    try {
      const userId = await authenticate(request, this.#auth);
      if (this.#closed) throw new ManagedFailure("shutdown");
      if (!policyIsCurrent(this.#policy)) throw new ManagedFailure("unavailable");
      if (!isIP(trustedNetworkAddress)) throw new ManagedFailure("unavailable");
      if (
        request.method !== "POST" ||
        new URL(request.url).pathname !== "/api/generate" ||
        new URL(request.url).search ||
        request.headers.get("content-type") !== "application/json"
      )
        throw new ManagedFailure("invalid-request");
      const raw = await readBounded(request.body, limits.requestBytes, controller.signal);
      const parsed = managedRequestSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success || parsed.data.modelId !== this.#policy.model.id)
        throw new ManagedFailure("invalid-request");
      const input = parsed.data;
      controller.signal.throwIfAborted();
      // Keyed network throttle is an abuse friction, not a per-person allowance.
      // NATs share it; address rotation can evade it; the global ledger still caps spend.
      const network = createHmac("sha256", this.#throttleKey)
        .update(
          `${this.#policy.budgetId}:${new Date().toISOString().slice(0, 10)}:${trustedNetworkAddress}`,
        )
        .digest("hex");
      await this.#budget.reserve(input.requestId, network, userId, input.input.kind);
      reservationId = input.requestId;
      controller.signal.throwIfAborted();
      const workflowTimer = setTimeout(() => {
        controller.abort(new ManagedFailure("deadline"));
      }, generationDeadlineMilliseconds[input.input.kind]);
      let output;
      try {
        output = await runLearningWorkflow(
          { input: input.input, signal: controller.signal },
          async (attempt) => {
            controller.signal.throwIfAborted();
            if (!policyIsCurrent(this.#policy)) throw new ManagedFailure("unavailable");
            await this.#budget.assertEnabled(input.requestId);
            controller.signal.throwIfAborted();
            // Mark before any possible upstream send. Cancellation/refusal after this
            // line never establishes free work; only an unattempted repair is refunded.
            attempted++;
            return generateGatewayAttempt({
              userId,
              operation: input.input.kind,
              recordUsage: (value) => usage.push(value),
              policy: this.#policy,
              apiKey: this.#apiKey,
              attempt,
              signal: controller.signal,
            });
          },
        );
      } finally {
        clearTimeout(workflowTimer);
      }
      controller.signal.throwIfAborted();
      const body = {
        status: "validated",
        requestId: input.requestId,
        modelId: this.#policy.model.id,
        output: output.output,
      };
      if (Buffer.byteLength(JSON.stringify(body)) > limits.responseBytes)
        throw new ManagedFailure("invalid-output");
      outcome = "validated";
      return response(body, 200);
    } catch (error) {
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
      const code =
        reason instanceof ManagedFailure
          ? reason.code
          : reason instanceof GenerationOutputValidationError
            ? "invalid-output"
            : reason instanceof SyntaxError
              ? "invalid-request"
              : "unavailable";
      outcome = code;
      return response({ status: "failed", code: failureCodeSchema.parse(code) }, statuses[code]);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      this.#running.delete(controller);
      if (reservationId) {
        // Failure leaves the original maximum charged durably. No fire-and-forget
        // refund and no dependency on client connection staying open.
        await this.#budget
          .settle(reservationId, attempted, outcome, Date.now() - started, {
            attempts: usage,
            complete: usage.length === attempted,
          })
          .catch(() => undefined);
      }
    }
  }
  shutdown(): void {
    this.#closed = true;
    for (const controller of this.#running) controller.abort(new ManagedFailure("shutdown"));
  }
}

export { authenticate, type ClerkPolicy } from "./auth.js";
export async function accountResponse(
  request: Request,
  auth: ClerkPolicy,
  sql: BudgetSql,
  inferenceEnabled: boolean,
  speechEnabled = false,
): Promise<Response> {
  try {
    const userId = await authenticate(request, auth);
    const result = await sql.query("select * from nina_starter.access($1)", [userId]);
    const account = z
      .object({
        tier: z.enum(["free", "plus"]),
        hosted_ai_enabled: z.boolean(),
        remaining_actions: z.coerce.number().int().nonnegative(),
      })
      .optional()
      .parse(result.rows[0]);
    const speechResult = await sql.query("select * from nina_speech.access($1)", [userId]);
    const speech = z
      .object({ enabled: z.boolean(), remaining_characters: z.coerce.number().int().nonnegative() })
      .optional()
      .parse(speechResult.rows[0]);
    return response(
      ninaAccessSchema.parse({
        userId,
        tier: account?.tier ?? "free",
        hostedAiEnabled: account?.hosted_ai_enabled ?? false,
        speech: {
          enabled: speech?.enabled ?? false,
          remainingCharacters: speech?.remaining_characters ?? 0,
          serviceEnabled: speechEnabled,
        },
        remainingActions: account?.remaining_actions ?? 0,
        inferenceEnabled,
      }),
      200,
    );
  } catch (error) {
    return response(
      { status: "failed", code: error instanceof ManagedFailure ? error.code : "unavailable" },
      error instanceof ManagedFailure && error.code === "unauthenticated" ? 401 : 503,
    );
  }
}

export type { BudgetSql } from "./budget.js";
