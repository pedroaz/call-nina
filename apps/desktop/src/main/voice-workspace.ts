import { app } from "electron";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

// Keep practice chats outside the source checkout and application/learner storage.
export function codexVoiceWorkspacePath(): string {
  return path.join(app.getPath("documents"), "Call Nina Practice");
}

export async function ensureCodexVoiceWorkspace(): Promise<void> {
  const workspace = codexVoiceWorkspacePath();
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const entry = await lstat(workspace);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("OD_ACTIVITY_HANDOFF_FAILED");
}
