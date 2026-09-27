import { readFileSync } from "node:fs";
import path from "node:path";
export const root = path.resolve(import.meta.dirname, "../..");
export function developmentConfig() {
  const config = JSON.parse(readFileSync(path.join(root, "development.json"), "utf8"));
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(config.github?.repository) ||
    !Number.isInteger(config.workers?.maximum) ||
    config.workers.maximum < 1 ||
    !Number.isInteger(config.workers?.writers) ||
    config.workers.writers < 1 ||
    config.workers.writers > config.workers.maximum ||
    typeof config.intake?.enabled !== "boolean" ||
    !Number.isInteger(config.intake.intervalMinutes) ||
    config.intake.intervalMinutes < 1
  )
    throw new Error("DEVELOPMENT_CONFIG_INVALID");
  for (const value of Object.values(config.executables))
    if (value !== null && (typeof value !== "string" || !path.isAbsolute(value)))
      throw new Error("EXECUTABLE_OVERRIDE_MUST_BE_ABSOLUTE");
  return config;
}
