import { developmentConfig } from "./config.mjs";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

// Avoid a shell entirely, including Windows .cmd shims. This also keeps paths
// containing spaces or shell metacharacters as single arguments.
export function pnpmCommand(args) {
  const configured = developmentConfig().executables.pnpmCli ?? process.env.NINA_INTERNAL_PNPM_CLI;
  if (configured) return [process.execPath, [configured, ...args]];
  if (process.platform !== "win32") return ["pnpm", args];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const candidate of [
      path.join(directory, "node_modules/pnpm/bin/pnpm.cjs"),
      path.join(directory, "pnpm.cjs"),
    ]) {
      if (existsSync(candidate)) return [process.execPath, [realpathSync(candidate), ...args]];
    }
  }
  throw new Error("PNPM_ENTRY_UNAVAILABLE: use install/install.ps1 to provision pnpm locally.");
}
