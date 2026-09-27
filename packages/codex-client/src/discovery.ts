import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveCodexExecutable } from "./desktop-runtime.js";

import { scrubCodexEnvironment } from "./environment.js";

export { resolveCodexExecutable } from "./desktop-runtime.js";

const execFileAsync = promisify(execFile);
const codexVersionPattern = /^(?:codex-cli\s+|v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u;

export type CodexDiscovery =
  | Readonly<{ status: "available"; version: string }>
  | Readonly<{
      status: "unavailable";
      reason: "missing" | "unsupported-version" | "app-server-unavailable";
    }>;

// Version is diagnostic metadata. Availability is established by the command and
// the runtime handshake, not an exact release allowlist.
export function classifyCodexVersion(rawVersion: string): CodexDiscovery {
  const match = codexVersionPattern.exec(rawVersion.trim());
  if (!match?.[1]) return Object.freeze({ status: "unavailable", reason: "unsupported-version" });
  return Object.freeze({ status: "available", version: match[1] });
}

export async function discoverCodex(
  options: {
    executable?: string;
    timeoutMilliseconds?: number;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<CodexDiscovery> {
  const timeout = options.timeoutMilliseconds ?? 3_000;
  const environment = scrubCodexEnvironment(options.environment ?? process.env);
  const executable = await resolveCodexExecutable(options.executable, environment);
  if (!executable) return Object.freeze({ status: "unavailable", reason: "missing" });
  let versionOutput: string;
  try {
    const result = await execFileAsync(executable, ["--version"], {
      encoding: "utf8",
      timeout,
      killSignal: "SIGKILL",
      env: environment,
      maxBuffer: 16 * 1024,
    });
    versionOutput = result.stdout;
  } catch (error) {
    const code =
      error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
    return Object.freeze({
      status: "unavailable",
      reason: code === "ENOENT" ? "missing" : "app-server-unavailable",
    });
  }
  const version = classifyCodexVersion(versionOutput);
  if (version.status === "unavailable") return version;
  try {
    await execFileAsync(executable, ["app-server", "--help"], {
      encoding: "utf8",
      timeout,
      killSignal: "SIGKILL",
      env: environment,
      maxBuffer: 64 * 1024,
    });
    return version;
  } catch {
    return Object.freeze({ status: "unavailable", reason: "app-server-unavailable" });
  }
}
