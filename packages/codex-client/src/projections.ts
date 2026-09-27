export interface AppServerRequester {
  request(
    method: string,
    params?: unknown,
    options?: Readonly<{ timeoutMilliseconds?: number; signal?: AbortSignal }>,
  ): Promise<unknown>;
}

export class AppServerProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AppServerProjectionError";
  }
}

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalNonblankString(value: unknown, maximum = 200): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppServerProjectionError("APP_SERVER_SHAPE_INVALID");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new AppServerProjectionError("APP_SERVER_SHAPE_INVALID");
  }
  return normalized;
}

export function requiredNonblankString(value: unknown, maximum = 200): string {
  const normalized = optionalNonblankString(value, maximum);
  if (normalized === null) throw new AppServerProjectionError("APP_SERVER_SHAPE_INVALID");
  return normalized;
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
