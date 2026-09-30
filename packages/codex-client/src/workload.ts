import { randomBytes } from "node:crypto";
import {
  type GenerationInput,
  type GenerationKind,
  type GenerationCandidateOutputMap,
  type GenerationProvenance,
} from "@call-nina/contracts";
import {
  runLearningWorkflow,
  reportTiming,
  type LearningAttempt,
  type LearningWorkflowTiming,
} from "@call-nina/learning-workflows";
import { standaloneConfig } from "./standalone-runtime.js";
import { OperationRateLimitedError } from "./operation-controller.js";
import { assertOwnedSandboxPolicy, createOwnedTurnSandbox } from "./sandbox.js";

type WorkloadTiming = Omit<LearningWorkflowTiming, "stage"> &
  Readonly<{
    stage:
      "thread-start" | "turn-start" | "first-response" | "generation" | "validation" | "repair";
  }>;

const maximumObservedEvents = 256;

const forbiddenItemCategories = new Map([
  ["commandExecution", "COMMAND"],
  ["fileChange", "FILE_CHANGE"],
  ["mcpToolCall", "MCP_TOOL"],
  ["dynamicToolCall", "DYNAMIC_TOOL"],
  ["collabToolCall", "COLLAB_TOOL"],
  ["webSearch", "WEB_SEARCH"],
  ["imageView", "IMAGE_VIEW"],
]);

type RequestOptions = Readonly<{ timeoutMilliseconds?: number; signal?: AbortSignal }>;

export type WorkloadRequestClient = Readonly<{
  request(method: string, params?: unknown, options?: RequestOptions): Promise<unknown>;
  subscribeNotifications(listener: (method: string, params: unknown) => void): () => void;
  subscribeServerRequests(listener: (method: string, params: unknown) => void): () => void;
  shutdown(): Promise<void>;
}>;

export type BoundedWorkloadRun<Kind extends GenerationKind> = Readonly<{
  input: Extract<GenerationInput, { kind: Kind }>;
  model: string;
  effort: string;
  forbiddenRoots: readonly string[];
  signal?: AbortSignal;
  absoluteDeadlineMilliseconds?: number;
  onProgress?: (stage: "starting" | "running" | "validating", attempt: 1 | 2) => void;
  onTiming?: (event: WorkloadTiming) => void;
}>;

export type BoundedWorkloadResult<Kind extends GenerationKind> = Readonly<{
  modelRequestId: string;
  output: GenerationCandidateOutputMap[Kind];
  repaired: boolean;
  provenance: GenerationProvenance;
}>;

type Observed = Readonly<{
  kind: "notification" | "server-request";
  method: string;
  params: unknown;
}>;

class EventQueue {
  readonly #events: Observed[] = [];
  readonly #waiters: ((event: Observed) => void)[] = [];
  #overflowed = false;

  push(event: Observed): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    this.#events.push(event);
    if (this.#events.length > maximumObservedEvents) {
      this.#overflowed = true;
      this.#events.length = 0;
    }
  }

  next(deadline: number, signal?: AbortSignal): Promise<Observed> {
    if (this.#overflowed) {
      return Promise.reject(new Error("OD_APP_SERVER_EVENT_LIMIT_EXCEEDED"));
    }
    const first = this.#events.shift();
    if (first) return Promise.resolve(first);
    if (signal?.aborted) return Promise.reject(new Error("OD_APP_SERVER_OPERATION_CANCELLED"));
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new Error("OD_APP_SERVER_OPERATION_TIMEOUT"));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        const index = this.#waiters.indexOf(waiter);
        if (index !== -1) this.#waiters.splice(index, 1);
        action();
      };
      const waiter = (event: Observed) => {
        finish(() => {
          resolve(event);
        });
      };
      const timer = setTimeout(() => {
        finish(() => {
          reject(new Error("OD_APP_SERVER_OPERATION_TIMEOUT"));
        });
      }, remaining);
      const abort = () => {
        finish(() => {
          reject(new Error("OD_APP_SERVER_OPERATION_CANCELLED"));
        });
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.#waiters.push(waiter);
    });
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonblank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function turnFailureCode(turn: Record<string, unknown>): string {
  const status = turn["status"];
  if (status === "interrupted") return "OD_APP_SERVER_TURN_INTERRUPTED";
  if (status !== "failed") return "OD_APP_SERVER_TURN_FAILED";
  const turnError = object(turn["error"]);
  const errorInfo = turnError?.["codexErrorInfo"];
  const category =
    typeof errorInfo === "string" ? errorInfo : Object.keys(object(errorInfo) ?? {})[0];
  const safeCategory = category
    ?.replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9_]/gu, "_")
    .toUpperCase();
  const diagnosticText = [turnError?.["message"], turnError?.["additionalDetails"]]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const diagnosticLabels = [
    ["MODEL", /\bmodel\b/u],
    ["OUTPUT_SCHEMA", /output.?schema|response.?format|structured.?output/u],
    ["JSON_SCHEMA", /json.?schema/u],
    ["EFFORT", /\beffort\b|reasoning/u],
    ["INSTRUCTIONS", /instruction/u],
    ["AUTH", /unauthori[sz]ed|authentication|credential/u],
    ["NETWORK", /network|connect|stream|timeout/u],
    ["RATE_LIMIT", /rate.?limit|usage.?limit|quota/u],
    ["SERVICE_TIER", /service.?tier/u],
    ["SANDBOX", /sandbox/u],
    ["TOOL", /\btool/u],
  ] as const;
  const details = diagnosticLabels
    .filter(([, pattern]) => pattern.test(diagnosticText))
    .map(([label]) => label)
    .join("_");
  const suffix = [safeCategory, details].filter(Boolean).join("_");
  return suffix ? `OD_APP_SERVER_TURN_FAILED_${suffix}` : "OD_APP_SERVER_TURN_FAILED_UNKNOWN";
}

function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "APP_SERVER_RATE_LIMITED"
  );
}

function violation(event: Observed): string | undefined {
  // Only fixed categories enter diagnostics; never retain method names or payloads.
  const method = event.method;
  if (event.kind === "server-request") {
    switch (method) {
      case "item/commandExecution/requestApproval":
        return "COMMAND_APPROVAL";
      case "item/fileChange/requestApproval":
        return "FILE_APPROVAL";
      case "item/tool/requestUserInput":
        return "USER_INPUT";
      case "item/tool/call":
        return "TOOL_REQUEST";
      default:
        return "SERVER_REQUEST";
    }
  }
  for (const [itemType, category] of forbiddenItemCategories) {
    if (method.startsWith(`item/${itemType}/`)) return category;
  }
  if (method === "hook/started") return "HOOK_STARTED";
  if (method === "hook/completed") return "HOOK_COMPLETED";
  if (method.startsWith("hook/")) return "HOOK";
  if (method === "turn/diff/updated") {
    const diff = object(event.params)?.["diff"];
    return typeof diff === "string"
      ? diff.trim().length === 0
        ? "TURN_DIFF_EMPTY"
        : "TURN_DIFF_NONEMPTY"
      : "TURN_DIFF_INVALID";
  }
  const item = object(object(event.params)?.["item"]);
  const itemType = item?.["type"];
  return typeof itemType === "string" ? forbiddenItemCategories.get(itemType) : undefined;
}

function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value <= 0) throw new Error("OD_APP_SERVER_OPERATION_TIMEOUT");
  return value;
}

function threadId(result: unknown): string | undefined {
  return nonblank(object(object(result)?.["thread"])?.["id"]);
}

function turnId(result: unknown): string | undefined {
  return nonblank(object(object(result)?.["turn"])?.["id"]);
}

async function interrupt(
  client: WorkloadRequestClient,
  thread: string,
  turn: string,
  deadline: number,
): Promise<void> {
  await client.request(
    "turn/interrupt",
    { threadId: thread, turnId: turn },
    { timeoutMilliseconds: remaining(deadline) },
  );
}

async function runAttempt(
  options: LearningAttempt & {
    client: WorkloadRequestClient;
    model: string;
    effort: string;
    forbiddenRoots: readonly string[];
    onProgress?: BoundedWorkloadRun<GenerationKind>["onProgress"];
    onTiming?: BoundedWorkloadRun<GenerationKind>["onTiming"];
  },
): Promise<string> {
  const attempt = options.attempt;
  const timing = (
    stage: WorkloadTiming["stage"],
    since: number,
    outcome: "ok" | "error" = "ok",
    error?: unknown,
  ) => {
    const code =
      error instanceof Error && /^(?:OD|APP_SERVER)_[A-Z0-9_]{3,100}$/u.test(error.message)
        ? error.message
        : undefined;
    reportTiming(options.onTiming, {
      stage,
      durationMs: Math.max(0, Math.round(performance.now() - since)),
      attempt,
      outcome,
      ...(code === undefined ? {} : { code }),
    });
  };
  const measured = async <Result>(
    stage: WorkloadTiming["stage"],
    action: () => Result | Promise<Result>,
  ): Promise<Result> => {
    const since = performance.now();
    try {
      const result = await action();
      timing(stage, since);
      return result;
    } catch (error) {
      timing(stage, since, "error", error);
      throw error;
    }
  };
  const sandbox = await createOwnedTurnSandbox({ forbiddenRoots: options.forbiddenRoots });
  const queue = new EventQueue();
  const unsubscribeNotification = options.client.subscribeNotifications((method, params) => {
    queue.push({ kind: "notification", method, params });
  });
  const unsubscribeRequest = options.client.subscribeServerRequests((method, params) => {
    queue.push({ kind: "server-request", method, params });
  });
  let activeThread: string | undefined;
  let activeTurn: string | undefined;
  let startingThread = false;
  let startingTurn = false;
  let sandboxSettled = true;
  try {
    const policy = assertOwnedSandboxPolicy(sandbox.policy);
    options.onProgress?.("starting", attempt);
    startingThread = true;
    sandboxSettled = false;
    const startedThread = await measured("thread-start", () =>
      options.client.request(
        "thread/start",
        {
          cwd: policy.workspaceRoot,
          model: options.model,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          ephemeral: true,
          serviceName: "open_deutsch",
          baseInstructions: options.instructions,
          developerInstructions: options.teachingInstructions,
          config: {
            ...standaloneConfig,
            mcp_servers: {},
          },
        },
        {
          timeoutMilliseconds: remaining(options.deadline),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      ),
    );
    startingThread = false;
    activeThread = threadId(startedThread);
    if (!activeThread || options.signal?.aborted) {
      await options.client.shutdown();
      sandboxSettled = true;
      throw new Error("OD_APP_SERVER_THREAD_START_INVALID");
    }

    const generationStartedAt = performance.now();
    let firstResponse = false;
    startingTurn = true;
    const startedTurn = await measured("turn-start", () =>
      options.client.request(
        "turn/start",
        {
          threadId: activeThread,
          input: [
            {
              type: "text",
              text: options.prompt,
            },
          ],
          cwd: policy.workspaceRoot,
          approvalPolicy: "never",
          sandboxPolicy: policy.sandboxPolicy,
          model: options.model,
          effort: options.effort,
          outputSchema: options.outputSchema,
        },
        {
          timeoutMilliseconds: remaining(options.deadline),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      ),
    );
    startingTurn = false;
    activeTurn = turnId(startedTurn);
    if (!activeTurn || options.signal?.aborted) {
      await options.client.shutdown();
      sandboxSettled = true;
      throw new Error("OD_APP_SERVER_TURN_START_INVALID");
    }
    options.onProgress?.("running", attempt);

    const completedItems: string[] = [];
    for (;;) {
      const event = await queue.next(options.deadline, options.signal);
      const policyViolation = violation(event);
      if (policyViolation) {
        throw new Error(`OD_APP_SERVER_POLICY_VIOLATION_${policyViolation}`);
      }
      if (event.kind !== "notification") continue;
      const params = object(event.params);
      if (
        !firstResponse &&
        params?.["threadId"] === activeThread &&
        params["turnId"] === activeTurn &&
        (event.method === "item/agentMessage/delta" ||
          (event.method === "item/completed" &&
            object(params["item"])?.["type"] === "agentMessage"))
      ) {
        firstResponse = true;
        timing("first-response", generationStartedAt);
      }
      if (event.method === "item/completed") {
        if (params?.["threadId"] !== activeThread || params["turnId"] !== activeTurn) continue;
        const item = object(params["item"]);
        if (item?.["type"] === "agentMessage") {
          const text = nonblank(item["text"]);
          if (!text || completedItems.length > 0) {
            throw new Error("OD_APP_SERVER_FINAL_OUTPUT_AMBIGUOUS");
          }
          completedItems.push(text);
        }
      }
      if (event.method === "turn/completed") {
        if (params?.["threadId"] !== activeThread) continue;
        const turn = object(params["turn"]);
        if (turn?.["id"] !== activeTurn) continue;
        activeTurn = undefined;
        sandboxSettled = true;
        timing("generation", generationStartedAt, turn["status"] === "completed" ? "ok" : "error");
        if (turn["status"] !== "completed") throw new Error(turnFailureCode(turn));
        if (completedItems.length !== 1) throw new Error("OD_APP_SERVER_FINAL_OUTPUT_MISSING");
        const finalOutput = completedItems[0];
        if (finalOutput === undefined) throw new Error("OD_APP_SERVER_FINAL_OUTPUT_MISSING");
        return finalOutput;
      }
    }
  } catch (error) {
    if (activeThread && activeTurn) {
      try {
        const settlementDeadline = Math.min(options.deadline, Date.now() + 2_000);
        await interrupt(options.client, activeThread, activeTurn, settlementDeadline);
        // An interrupt acknowledgement is not termination. Keep the disposable
        // workspace owned until the exact turn completes or the process stops.
        for (;;) {
          const event = await queue.next(settlementDeadline);
          const params = object(event.params);
          if (
            event.method === "turn/completed" &&
            params?.["threadId"] === activeThread &&
            object(params["turn"])?.["id"] === activeTurn
          ) {
            sandboxSettled = true;
            break;
          }
        }
      } catch {
        await options.client.shutdown();
        sandboxSettled = true;
      }
    } else if (startingThread || startingTurn) {
      // A cancelled RPC may still create a thread/turn whose ID was never delivered.
      await options.client.shutdown();
      sandboxSettled = true;
    }
    throw error;
  } finally {
    unsubscribeRequest();
    unsubscribeNotification();
    if (sandboxSettled) await sandbox.cleanup();
  }
}

export async function runBoundedWorkload<Kind extends GenerationKind>(
  client: WorkloadRequestClient,
  run: BoundedWorkloadRun<Kind>,
): Promise<BoundedWorkloadResult<Kind>> {
  if (!nonblank(run.model) || !nonblank(run.effort))
    throw new Error("OD_APP_SERVER_MODEL_SELECTION_INVALID");
  const modelRequestId = `model-request_${randomBytes(16).toString("hex")}`;
  try {
    const result = await runLearningWorkflow(run, (attempt) =>
      runAttempt({
        ...attempt,
        client,
        model: run.model,
        effort: run.effort,
        forbiddenRoots: run.forbiddenRoots,
        ...(run.onProgress === undefined ? {} : { onProgress: run.onProgress }),
        ...(run.onTiming === undefined ? {} : { onTiming: run.onTiming }),
      }),
    );
    return Object.freeze({
      ...result,
      modelRequestId,
      provenance: { producer: "codex", modelId: run.model, effortId: run.effort },
    });
  } catch (error) {
    if (isRateLimitError(error)) throw new OperationRateLimitedError();
    throw error;
  }
}
