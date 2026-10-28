import { readFileSync } from "node:fs";
import path from "node:path";
export const root = path.resolve(import.meta.dirname, "../..");
export function developmentConfig() {
  const config = JSON.parse(readFileSync(path.join(root, "development.json"), "utf8"));
  if (
    !config.executables ||
    Object.keys(config).some((key) => key !== "executables") ||
    Object.keys(config.executables).sort().join(",") !== "codex,pnpmCli"
  )
    throw new Error("DEVELOPMENT_CONFIG_INVALID");
  for (const value of Object.values(config.executables))
    if (value !== null && (typeof value !== "string" || !path.isAbsolute(value)))
      throw new Error("EXECUTABLE_OVERRIDE_MUST_BE_ABSOLUTE");
  return config;
}
