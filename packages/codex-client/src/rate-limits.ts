import { rateLimitStateSchema, type z } from "@call-nina/contracts";

import {
  AppServerProjectionError,
  isJsonObject,
  optionalNonblankString,
  requiredNonblankString,
  type AppServerRequester,
} from "./projections.js";

export type RateLimitState = z.output<typeof rateLimitStateSchema>;
type RateLimitBucket = Extract<RateLimitState, { status: "available" }>["buckets"][number];
type ResetCredits = Extract<RateLimitState, { status: "available" }>["resetCredits"];

function nullableNumber(
  value: unknown,
  options: Readonly<{ integer?: boolean; positive?: boolean; maximum?: number }> = {},
): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.integer === true && !Number.isInteger(value)) ||
    (options.positive === true ? value <= 0 : value < 0) ||
    value > (options.maximum ?? Number.MAX_SAFE_INTEGER)
  ) {
    throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  }
  return value;
}

function projectWindow(value: unknown): RateLimitBucket["primary"] {
  if (value === undefined || value === null) return null;
  if (!isJsonObject(value)) throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  const usedPercent = nullableNumber(value["usedPercent"], { maximum: 100 });
  const resetsAt = nullableNumber(value["resetsAt"]);
  const windowDurationMinutes = nullableNumber(value["windowDurationMins"], {
    integer: true,
    positive: true,
    maximum: 525_600,
  });
  return { usedPercent, resetsAt, windowDurationMinutes };
}

function projectResetCredits(value: unknown): ResetCredits {
  if (value === undefined || value === null) return { status: "unavailable" };
  if (!isJsonObject(value)) {
    throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  }
  const availableCount = value["availableCount"];
  if (
    typeof availableCount !== "number" ||
    !Number.isSafeInteger(availableCount) ||
    availableCount < 0
  ) {
    throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  }
  return { status: "available", availableCount };
}

function projectBucket(value: unknown, fallbackId: string | null): RateLimitBucket {
  if (!isJsonObject(value)) throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  const limitId = optionalNonblankString(value["limitId"], 100) ?? fallbackId;
  if (limitId === null) throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  const planType = optionalNonblankString(value["planType"], 100);
  return {
    limitId,
    planType,
    primary: projectWindow(value["primary"]),
    secondary: projectWindow(value["secondary"]),
  };
}

export function projectRateLimits(value: unknown): RateLimitState {
  if (!isJsonObject(value)) throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  const byId = value["rateLimitsByLimitId"];
  const rawBuckets: { value: unknown; fallbackId: string | null }[] = [];
  if (byId !== undefined && byId !== null) {
    if (!isJsonObject(byId)) throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
    for (const [id, bucket] of Object.entries(byId)) {
      rawBuckets.push({ value: bucket, fallbackId: requiredNonblankString(id, 100) });
    }
  }
  if (
    rawBuckets.length === 0 &&
    value["rateLimits"] !== undefined &&
    value["rateLimits"] !== null
  ) {
    rawBuckets.push({ value: value["rateLimits"], fallbackId: null });
  }
  if (rawBuckets.length === 0) return { status: "unavailable", reason: "not-reported" };
  if (rawBuckets.length > 20) throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  const buckets = rawBuckets.map(({ value: bucket, fallbackId }) =>
    projectBucket(bucket, fallbackId),
  );
  if (new Set(buckets.map(({ limitId }) => limitId)).size !== buckets.length) {
    throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
  }
  const reachedTypes = new Set([
    "rate_limit_reached",
    "workspace_owner_credits_depleted",
    "workspace_member_credits_depleted",
    "workspace_owner_usage_limit_reached",
    "workspace_member_usage_limit_reached",
  ]);
  const authoritativeReached = rawBuckets.some(({ value: raw }) => {
    if (!isJsonObject(raw)) return false;
    const reached = optionalNonblankString(raw["rateLimitReachedType"], 100);
    if (reached !== null && !reachedTypes.has(reached)) {
      throw new AppServerProjectionError("APP_SERVER_RATE_LIMITS_INVALID");
    }
    return reached !== null;
  });
  const primary = buckets.some(({ primary: window }) => window?.usedPercent === 100);
  const secondary = buckets.some(({ secondary: window }) => window?.usedPercent === 100);
  const resetCredits = projectResetCredits(value["rateLimitResetCredits"]);
  return rateLimitStateSchema.parse(
    primary || secondary || authoritativeReached
      ? {
          status: "limited",
          reached:
            primary && secondary
              ? "both"
              : primary
                ? "primary"
                : secondary
                  ? "secondary"
                  : "unknown",
          buckets,
          resetCredits,
        }
      : { status: "available", buckets, resetCredits },
  );
}

export type RateLimitClientOptions = Readonly<{
  requester: AppServerRequester;
  requestTimeoutMilliseconds?: number;
  onRateLimitsChanged?: (state: RateLimitState) => void;
}>;

export class RateLimitClient {
  readonly #options: RateLimitClientOptions;

  constructor(options: RateLimitClientOptions) {
    this.#options = options;
  }

  async refresh(): Promise<RateLimitState> {
    let state: RateLimitState;
    try {
      state = projectRateLimits(
        await this.#options.requester.request("account/rateLimits/read", undefined, {
          timeoutMilliseconds: this.#options.requestTimeoutMilliseconds ?? 10_000,
        }),
      );
    } catch {
      state = { status: "unavailable", reason: "read-failed" };
    }
    this.#options.onRateLimitsChanged?.(state);
    return state;
  }

  async handleNotification(method: string): Promise<boolean> {
    if (method !== "account/rateLimits/updated") return false;
    await this.refresh();
    return true;
  }
}
