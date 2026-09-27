import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";

export async function publishRendererReadiness(): Promise<void> {
  const target = process.env["CALL_NINA_READY_FILE"];
  const runId = process.env["CALL_NINA_RUN_ID"];
  if (!target || !runId) return;
  if (
    !path.isAbsolute(target) ||
    !target.endsWith(".ready.json") ||
    !/^[0-9a-f-]{36}$/u.test(runId)
  ) {
    throw new Error("OD_DESKTOP_READINESS_ENVIRONMENT_INVALID");
  }
  const temporary = `${target}.${String(process.pid)}.next`;
  let published = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({ status: "ready", runId })}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    published = true;
  } finally {
    if (!published) await unlink(temporary).catch(() => undefined);
  }
}
