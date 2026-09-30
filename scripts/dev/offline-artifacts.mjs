#!/usr/bin/env node
// Explicit artifact maintenance only. This command never starts native inference.
import path from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { OfflineRuntime } from "../../packages/offline-runtime/dist/index.js";

const { values, positionals } = parseArgs({
  options: { "config-dir": { type: "string" } },
  allowPositionals: true,
});
const action = positionals[0];
const deviceRoot = values["config-dir"];
if (
  positionals.length !== 1 ||
  !["inspect", "install", "remove"].includes(action) ||
  !deviceRoot ||
  !path.isAbsolute(deviceRoot)
) {
  process.stderr.write(
    "Usage: make offline-artifacts ARGS='inspect|install|remove --config-dir /absolute/device-config-directory'\n",
  );
  process.exitCode = 1;
} else {
  // Always a fixed owned child of the explicit device config, never the selected learner root.
  const runtime = new OfflineRuntime({ artifactRoot: path.join(deviceRoot, "offline") });
  const cancel = () => {
    void runtime.cancelDownload();
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    if (action === "install") {
      runtime.install();
      for (;;) {
        const snapshot = await runtime.inspect();
        process.stdout.write(`${JSON.stringify(snapshot)}\n`);
        if (!["downloading", "verifying"].includes(snapshot.state)) {
          if (snapshot.state !== "installed") process.exitCode = 1;
          break;
        }
        await delay(1000);
      }
    } else if (action === "remove") await runtime.remove();
    process.stdout.write(`${JSON.stringify(await runtime.inspect())}\n`);
  } catch {
    process.stderr.write("OD_OFFLINE_MAINTENANCE_FAILED\n");
    process.exitCode = 1;
  } finally {
    await runtime.stop();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
