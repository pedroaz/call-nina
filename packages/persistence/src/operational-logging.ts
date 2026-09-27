import { appendFile, lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import { operationalLogRecordSchema, type OperationalLogRecord } from "@call-nina/contracts";

const maximumLogBytes = 5 * 1024 * 1024;
const retainedLogFiles = 10;
const safeMetadataKeys = new Set([
  "action",
  "answerLength",
  "attempt",
  "channel",
  "code",
  "count",
  "durationMs",
  "effort",
  "errorCode",
  "exerciseIndex",
  "exitCode",
  "fileCount",
  "itemCount",
  "kind",
  "model",
  "reason",
  "repaired",
  "replayed",
  "signal",
  "stage",
  "status",
  "stderrBytes",
  "stderrTruncated",
  "tool",
  "validationField",
  "version",
]);

async function rotateIfNeeded(logFile: string): Promise<void> {
  const current = await lstat(logFile).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (!current) return;
  if (!current.isFile() || current.isSymbolicLink()) throw new Error("OD_LOG_FILE_INVALID");
  if (current.size < maximumLogBytes) return;
  await rm(`${logFile}.${String(retainedLogFiles - 1)}`, { force: true });
  for (let index = retainedLogFiles - 2; index >= 1; index -= 1) {
    const rotated = `${logFile}.${String(index)}`;
    const rotatedInfo = await lstat(rotated).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (!rotatedInfo) continue;
    if (!rotatedInfo.isFile() || rotatedInfo.isSymbolicLink()) {
      throw new Error("OD_LOG_FILE_INVALID");
    }
    await rename(rotated, `${logFile}.${String(index + 1)}`);
  }
  await rename(logFile, `${logFile}.1`);
}

function metadataText(metadata: OperationalLogRecord["metadata"]): string {
  if (!metadata) return "";
  const safe = Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => safeMetadataKeys.has(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 200) : value]),
  );
  return Object.keys(safe).length > 0 ? ` metadata=${JSON.stringify(safe)}` : "";
}

function field(value: string | number | undefined): string {
  return value === undefined ? "-" : String(value);
}

async function appendRecord(
  logsDirectory: string,
  fileName: string,
  record: OperationalLogRecord,
): Promise<void> {
  const parsed = operationalLogRecordSchema.parse(record);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.log$/u.test(fileName)) {
    throw new Error("OD_LOG_FILE_NAME_INVALID");
  }
  await mkdir(logsDirectory, { recursive: true, mode: 0o700 });
  if ((await realpath(logsDirectory)) !== logsDirectory) {
    throw new Error("OD_LOG_DIRECTORY_INVALID");
  }
  const logFile = path.join(logsDirectory, fileName);
  await rotateIfNeeded(logFile);
  const line = [
    parsed.timestamp,
    parsed.severity.toUpperCase(),
    parsed.component,
    parsed.code,
    `run=${field(parsed.runId)}`,
    `session=${field(parsed.sessionId)}`,
    `correlation=${field(parsed.correlationId)}`,
    `action=${field(parsed.action)}`,
    `phase=${field(parsed.phase)}`,
    `outcome=${field(parsed.outcome)}`,
    `duration_ms=${field(parsed.durationMs)}`,
    metadataText(parsed.metadata),
    parsed.message,
  ]
    .filter(Boolean)
    .join(" ");
  await appendFile(logFile, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

// Serialize appends and rotation per file within this process. A rejected write does
// not poison subsequent diagnostics; callers still receive their own write error.
const pendingWrites = new Map<string, Promise<void>>();

export async function appendOperationalLog(
  logsDirectory: string,
  fileName: string,
  record: OperationalLogRecord,
): Promise<void> {
  const parsed = operationalLogRecordSchema.parse(record);
  const key = path.join(logsDirectory, fileName);
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const write = previous
    .catch(() => undefined)
    .then(() => appendRecord(logsDirectory, fileName, parsed));
  pendingWrites.set(key, write);
  try {
    await write;
  } finally {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  }
}
