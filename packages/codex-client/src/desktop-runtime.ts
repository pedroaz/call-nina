import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";

async function executableCandidate(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    const information = await stat(canonical);
    if (!information.isFile()) return undefined;
    await access(canonical, constants.X_OK);
    return canonical;
  } catch {
    return undefined;
  }
}

export async function resolveCodexExecutable(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (configured !== undefined) {
    if (!isAbsolute(configured)) return undefined;
    return executableCandidate(configured);
  }
  // Resolve the desktop installation on every launch so app updates carry their
  // bundled runtime with them. Never silently substitute the independent CLI.
  const candidates: string[] = [];
  for (const directory of (environment["PATH"] ?? "").split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const desktop = await executableCandidate(
      join(directory, process.platform === "win32" ? "ChatGPT.exe" : "chatgpt"),
    );
    if (desktop) candidates.push(join(dirname(desktop), "resources", "codex"));
  }
  if (process.platform === "darwin") {
    for (const root of ["/Applications", join(homedir(), "Applications")]) {
      for (const name of ["ChatGPT", "Codex"])
        candidates.push(join(root, `${name}.app`, "Contents", "Resources", "codex"));
    }
  } else if (process.platform === "win32") {
    for (const root of [environment["LOCALAPPDATA"], environment["ProgramFiles"]]) {
      if (!root) continue;
      for (const name of ["ChatGPT", "Codex"])
        candidates.push(
          join(root, "Programs", name, "resources", "codex.exe"),
          join(root, name, "resources", "codex.exe"),
        );
    }
    try {
      const { stdout } = await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-AppxPackage | Where-Object { $_.Name -match '^OpenAI\\.(ChatGPT|Codex)' } | Select-Object -ExpandProperty InstallLocation",
        ],
        { timeout: 10_000, windowsHide: true },
      );
      for (const root of stdout.split(/\r?\n/u).filter((value) => isAbsolute(value)))
        candidates.push(
          join(root.trim(), "app", "resources", "codex.exe"),
          join(root.trim(), "resources", "codex.exe"),
        );
    } catch {
      /* An explicit desktop executable override remains available. */
    }
  } else candidates.push("/usr/lib/chatgpt/resources/codex", "/opt/ChatGPT/resources/codex");
  for (const candidate of candidates) {
    const executable = await executableCandidate(candidate);
    if (executable) return executable;
  }
  return undefined;
}
