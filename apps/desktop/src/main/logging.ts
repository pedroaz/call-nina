import path from "node:path";

import type { AppServerLogRecord } from "@call-nina/codex-client";
import {
  appendOperationalLog,
  readBootstrapPointer,
  resolveDataRootLayout,
} from "@call-nina/persistence";

function fileForComponent(component: AppServerLogRecord["component"]): string {
  return component === "app-server" ? "app-server.log" : "desktop.log";
}

export async function appendDesktopLog(
  bootstrapFile: string,
  record: AppServerLogRecord,
): Promise<void> {
  const pointer = await readBootstrapPointer(bootstrapFile);
  if (pointer.status !== "ready") {
    await appendOperationalLog(path.dirname(bootstrapFile), "bootstrap.log", {
      ...record,
      component: "desktop",
      code: record.code.startsWith("APP_SERVER_") ? "BOOTSTRAP_APP_SERVER_EVENT" : record.code,
    });
    return;
  }
  const logs = resolveDataRootLayout(pointer.dataRoot).logs;
  await appendOperationalLog(logs, fileForComponent(record.component), record);
}
