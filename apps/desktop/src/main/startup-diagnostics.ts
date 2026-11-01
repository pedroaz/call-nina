import { app, type BrowserWindow } from "electron";
import {
  appendFileSync,
  closeSync,
  constants,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

declare const __NINA_APP_VERSION__: string;
declare const __NINA_BUILD_COMMIT__: string;
declare const __NINA_BUILD_RUN__: string;

// Synchronous, bounded and independent of the learner pointer/database. No raw errors.
export function startupLog(code: string, fields: Record<string, string | number> = {}): void {
  if (!/^DESKTOP_[A-Z_]+$/u.test(code)) return;
  try {
    const file = path.join(app.getPath("userData"), "startup.log");
    try {
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return;
      if (info.size >= 1024 * 1024) {
        rmSync(`${file}.2`, { force: true });
        try {
          renameSync(`${file}.1`, `${file}.2`);
        } catch {
          /* No previous rotation. */
        }
        renameSync(file, `${file}.1`);
      }
    } catch {
      /* First launch. */
    }
    const safe: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (
        ["reason", "exitCode", "stage"].includes(key) &&
        /^[A-Za-z0-9_.-]{1,80}$/u.test(String(value))
      )
        safe[key] = String(value);
    }
    const descriptor = openSync(
      file,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      appendFileSync(
        descriptor,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          code,
          version: __NINA_APP_VERSION__,
          commit: __NINA_BUILD_COMMIT__,
          run: __NINA_BUILD_RUN__,
          arch: process.arch,
          electron: process.versions.electron,
          node: process.versions.node,
          os: process.getSystemVersion(),
          packaged: app.isPackaged,
          ...safe,
        })}\n`,
      );
    } finally {
      closeSync(descriptor);
    }
  } catch {
    /* Diagnostics must never prevent launch or overwrite learner data. */
  }
}
export function installFailureDiagnostics(): void {
  app.on("child-process-gone", (_event, details) => {
    startupLog("DESKTOP_CHILD_EXITED", { reason: details.reason, exitCode: details.exitCode });
  });
  process.on("uncaughtException", () => {
    startupLog("DESKTOP_UNCAUGHT_EXCEPTION");
    app.exit(1);
  });
  process.on("unhandledRejection", () => {
    startupLog("DESKTOP_UNHANDLED_REJECTION");
    app.exit(1);
  });
}
export function observeWindow(window: BrowserWindow): void {
  window.on("unresponsive", () => {
    startupLog("DESKTOP_WINDOW_UNRESPONSIVE");
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    startupLog("DESKTOP_RENDERER_EXITED", { reason: details.reason, exitCode: details.exitCode });
  });
  window.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame) startupLog("DESKTOP_RENDERER_LOAD_FAILED", { exitCode: code });
  });
}
