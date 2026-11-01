// Bump the notice version whenever the purposes or collected data materially change.
export const consentNoticeVersion = "2026-11-01";
export const consentStorageKey = "nina.website.consent.v1";
export type ConsentChoice = "accepted" | "rejected" | "unknown";
type ConsentRecord = {
  version: 1;
  notice: string;
  choice: Exclude<ConsentChoice, "unknown">;
  timestamp: number;
  expires: number;
};
const listeners = new Set<() => void>();
let memoryOnly = false;
let telemetryStarted = false;
let record = readRecord();
let timer: ReturnType<typeof setTimeout> | undefined;

function readRecord(): ConsentRecord | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(consentStorageKey) ?? "null");
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<ConsentRecord>;
    if (
      item.version !== 1 ||
      item.notice !== consentNoticeVersion ||
      (item.choice !== "accepted" && item.choice !== "rejected") ||
      typeof item.timestamp !== "number" ||
      !Number.isSafeInteger(item.timestamp) ||
      item.timestamp < 0 ||
      typeof item.expires !== "number" ||
      !Number.isSafeInteger(item.expires) ||
      item.timestamp > Date.now() ||
      item.expires <= Date.now() ||
      item.expires <= item.timestamp ||
      item.expires > expiry(item.timestamp)
    )
      return null;
    return item as ConsentRecord;
  } catch {
    return null;
  }
}
function expiry(timestamp: number) {
  const date = new Date(timestamp);
  date.setUTCMonth(date.getUTCMonth() + 6);
  return date.getTime();
}
export function getConsent(): ConsentChoice {
  return record && record.expires > Date.now() ? record.choice : "unknown";
}
// Re-read persisted consent at the actual send boundary, including before storage events arrive.
export function analyticsAllowed() {
  if (!memoryOnly) record = readRecord();
  return getConsent() === "accepted";
}
function notify() {
  clearTimeout(timer);
  for (const listener of listeners) listener();
  if (record && record.expires > Date.now()) {
    timer = setTimeout(refresh, Math.min(record.expires - Date.now(), 2147483647));
  }
}
export function markTelemetryStarted() {
  telemetryStarted = true;
}
function refresh() {
  if (!memoryOnly) record = readRecord();
  notify();
  if (telemetryStarted && getConsent() !== "accepted" && !memoryOnly) window.location.reload();
}
export function subscribeConsent(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
  }
  listeners.add(listener);
  notify();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    }
  };
}
function onStorage(event: StorageEvent) {
  if (event.key === consentStorageKey || event.key === null) {
    memoryOnly = false;
    refresh();
  }
}
export function chooseConsent(choice: Exclude<ConsentChoice, "unknown">) {
  const timestamp = Date.now();
  record = {
    version: 1,
    notice: consentNoticeVersion,
    choice,
    timestamp,
    expires: expiry(timestamp),
  };
  try {
    localStorage.setItem(consentStorageKey, JSON.stringify(record));
    memoryOnly = false;
  } catch {
    // A failed write must still revoke consent for this document. Avoid a reload that could
    // restore a previously accepted record when storage is readable but not writable.
    memoryOnly = true;
    // Removing an old acceptance can still work when a quota prevents replacement.
    try {
      localStorage.removeItem(consentStorageKey);
    } catch {
      // Send callbacks continue to enforce the in-memory choice.
    }
  }
  notify();
  if (telemetryStarted && choice === "rejected" && !memoryOnly) window.location.reload();
  return !memoryOnly;
}
