import { parseArgs } from "node:util";
import { open } from "node:fs/promises";

const ranks = { debug: 0, info: 1, warn: 2, error: 3 };
const maximumReadBytes = 512 * 1024;
const maximumLineBytes = 16 * 1024;

export function logViewOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      follow: { type: "boolean" },
      errors: { type: "boolean" },
      ...Object.fromEntries(
        ["level", "format", "scope", "lines", "component", "correlation"].map((key) => [
          key,
          { type: "string" },
        ]),
      ),
    },
  });
  const level = values.errors ? "warn" : (values.level ?? "info");
  const format = values.format ?? "pretty";
  const scope = values.scope ?? "current";
  const lines = values.lines ?? "50";
  const component = values.component;
  const correlation = values.correlation;
  if (!Object.hasOwn(ranks, level)) throw new Error("LEVEL must be debug, info, warn or error.");
  if (!["pretty", "raw"].includes(format)) throw new Error("FORMAT must be pretty or raw.");
  if (!["current", "history"].includes(scope)) throw new Error("SCOPE must be current or history.");
  if (!/^\d{1,4}$/u.test(lines) || Number(lines) > 1000)
    throw new Error("LINES must be between 0 and 1000.");
  if (component && !/^[a-z][a-z-]{0,30}$/u.test(component))
    throw new Error("Invalid COMPONENT filter.");
  if (correlation && !/^correlation_[A-Za-z0-9_-]{1,100}$/u.test(correlation))
    throw new Error("Use the full correlation ID from the diagnostic reference.");
  return {
    level,
    format,
    scope,
    lines: Number(lines),
    component,
    correlation,
    follow: args.includes("--follow"),
  };
}

// Recognize failures even when a compiler writes diagnostics to stdout.
export function processOutputLevel(line, stream, stopping = false) {
  if (stopping && /SIGTERM|SIGINT|ELIFECYCLE/u.test(line)) return "debug";
  if (
    /\berror TS\d+\b|\bFound [1-9]\d* errors?\b|\bERROR\b|\bError:|\bERR_PNPM_|\bELIFECYCLE\b|\bfailed\b/iu.test(
      line,
    )
  ) {
    // "Found 0 errors" is routine watcher output.
    if (!/Found 0 errors/u.test(line)) return "error";
  }
  if (/\bwarn(?:ing)?\b/iu.test(line)) return "warn";
  return stream === "stderr" ? "warn" : "debug";
}

function cleanLine(line) {
  return (
    line
      // eslint-disable-next-line no-control-regex -- Strip terminal controls before displaying redacted logs.
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
      // eslint-disable-next-line no-control-regex -- Strip terminal controls before displaying redacted logs.
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, "")
      .replaceAll(process.cwd(), "<workspace>")
      .replace(/\/(?:home|Users|tmp)\/[^\s:]+/gu, "<private-path>")
      .slice(0, maximumLineBytes)
  );
}

export function parseLogLine(raw) {
  const line = cleanLine(raw);
  // pnpm prefixes child output; find the canonical record after that prefix.
  const match =
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (DEBUG|INFO|WARN|ERROR) ([a-z-]+) ([A-Z][A-Z0-9_]+) (.*)$/u.exec(
      line,
    );
  if (!match) {
    return {
      raw: line,
      timestamp: "",
      level: processOutputLevel(line, "stdout"),
      component: "build",
      code: "PROCESS_OUTPUT",
      message: line,
      fields: {},
      metadata: {},
    };
  }
  const [, timestamp, severity, component, code, rest] = match;
  const fields = {};
  let message = rest;
  let field;
  while (
    (field = /^(run|session|correlation|action|phase|outcome|duration_ms)=([^\s]+)\s*/u.exec(
      message,
    ))
  ) {
    if (field[2] !== "-") fields[field[1]] = field[2];
    message = message.slice(field[0].length);
  }
  let metadata = {};
  const meta = /^metadata=(\{.*\})\s+(.*)$/u.exec(message);
  if (meta) {
    try {
      const parsed = JSON.parse(meta[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
      message = meta[2];
    } catch {
      /* Keep the bounded original record. */
    }
  }
  let level = severity.toLowerCase();
  if (code === "PROCESS_STDOUT" || code === "PROCESS_STDERR") {
    level = processOutputLevel(message, code === "PROCESS_STDERR" ? "stderr" : "stdout");
    if (severity === "DEBUG") level = "debug";
  }
  // Apply the same severity policy to older records without rewriting their files.
  if (
    level === "info" &&
    ([
      "DESKTOP_ACTION_STARTED",
      "APP_SERVER_OPERATION_STAGE",
      "MCP_TOOL_STARTED",
      "APP_SERVER_MODEL_CATALOG_CHANGED",
    ].includes(code) ||
      (code === "APP_SERVER_RATE_LIMITS_CHANGED" && metadata.status === "available") ||
      (code === "DESKTOP_ACTION_COMPLETED" &&
        (/\/(?:read|list|status|snapshot|readiness)$/u.test(fields.action ?? "") ||
          fields.action === "learning-operation/start")))
  )
    level = "debug";
  return {
    raw: line.slice(match.index),
    timestamp,
    level,
    component,
    code,
    fields,
    metadata,
    message,
  };
}

export function matchesLog(record, options) {
  return (
    ranks[record.level] >= ranks[options.level] &&
    (!options.component || record.component === options.component) &&
    (!options.correlation || record.fields.correlation === options.correlation)
  );
}

export function formatLog(record, options) {
  if (options.format === "raw") return record.raw;
  const { fields, metadata } = record;
  const detailed = options.level === "debug";
  const diagnostic = detailed || ranks[record.level] >= ranks.warn;
  const duration =
    fields.duration_ms === undefined
      ? ""
      : ` (${Number(fields.duration_ms) < 1000 ? `${fields.duration_ms}ms` : `${(Number(fields.duration_ms) / 1000).toFixed(2)}s`})`;
  const details = Object.entries(metadata)
    .filter(
      ([key, value]) =>
        value !== null &&
        value !== fields.action &&
        !["reason", "durationMs"].includes(key) &&
        (diagnostic || !["stage", "status"].includes(key)) &&
        (detailed || key !== "repaired" || value === true) &&
        (detailed || key !== "attempt" || value !== 1),
    )
    .map(([key, value]) => `${key}=${String(value)}`);
  if (fields.correlation)
    details.push(
      diagnostic
        ? `ref=${fields.correlation}`
        : `#${fields.correlation.replace(/^correlation_/u, "").slice(-8)}`,
    );
  if (detailed && fields.run) details.push(`run=${fields.run}`);
  if (fields.outcome && fields.outcome !== "ok") details.push(`outcome=${fields.outcome}`);
  const code =
    detailed || (diagnostic && !/^PROCESS_/u.test(record.code)) ? ` [${record.code}]` : "";
  const suffix = details.length ? ` | ${details.join(" ")}` : "";
  let message = record.message;
  if (!detailed && /^PROCESS_/u.test(record.code)) {
    message = message.replace(
      /^\[\d+:[^\]]+:(?:ERROR|WARNING|INFO):([^\]]+)\]\s*/u,
      (_, source) => `${source.split("/").at(-1)} · `,
    );
    if (message.length > 240) message = `${message.slice(0, 240)}… (full detail: --level debug)`;
  }
  const action =
    fields.action && !["lifecycle", "pnpm"].includes(fields.action) ? ` ${fields.action}` : "";
  return `${record.timestamp ? record.timestamp.slice(11, 23) : "            "} ${record.level.toUpperCase().padEnd(5)} ${record.component}${action} · ${message}${duration}${code}${suffix}`;
}

// Incremental, bounded reads; carry partial UTF-8 lines and detect replacement/rotation.
export async function readLogBatch(filename, previous) {
  let file;
  try {
    file = await open(filename, "r");
    const info = await file.stat();
    if (!info.isFile()) return { cursor: previous, lines: [] };
    const identity = `${info.dev}:${info.ino}`;
    const continued = previous?.identity === identity && info.size >= previous.offset;
    const offset = continued ? previous.offset : Math.max(0, info.size - maximumReadBytes);
    const buffer = Buffer.alloc(Math.min(maximumReadBytes, info.size - offset));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    let pending = Buffer.concat([
      continued ? previous.pending : Buffer.alloc(0),
      buffer.subarray(0, bytesRead),
    ]);
    let discarding = continued ? previous.discarding : offset > 0;
    const lines = [];
    let newline;
    while ((newline = pending.indexOf(10)) >= 0) {
      if (!discarding && newline <= maximumLineBytes)
        lines.push(pending.subarray(0, newline).toString("utf8"));
      pending = pending.subarray(newline + 1);
      discarding = false;
    }
    if (pending.length > maximumLineBytes) {
      pending = Buffer.alloc(0);
      discarding = true;
    }
    return { cursor: { identity, offset: offset + bytesRead, pending, discarding }, lines };
  } catch (error) {
    if (error.code === "ENOENT") return { cursor: previous, lines: [] };
    throw error;
  } finally {
    await file?.close();
  }
}
