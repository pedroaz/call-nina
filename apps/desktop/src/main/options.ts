import path from "node:path";

/** Explicit desktop overrides; internal lifecycle metadata remains process-owned. */
export function desktopPathOption(name: "config-dir" | "codex-executable"): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value !== undefined && (!path.isAbsolute(value) || value.includes("\0")))
    throw new Error("OD_OPTION_PATH_INVALID");
  return value;
}
