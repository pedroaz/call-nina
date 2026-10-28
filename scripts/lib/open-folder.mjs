import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "./environment.mjs";

export function openRepositoryFolder() {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const child = spawnSync(command, [fileURLToPath(new URL("../../", import.meta.url))], {
    env: childEnvironment(),
    stdio: "ignore",
  });
  if (child.error || child.status !== 0)
    throw new Error("Could not open the repository folder in the system file manager");
}
