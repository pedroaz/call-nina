import { ConnectionSecretStorage } from "./secret-storage.js";
import { desktopPathOption } from "./options.js";
import { writeFile } from "node:fs/promises";
import { mkdirSync, lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  desktopIpcEventSchema,
  desktopIpcRequestSchema,
  desktopIpcResponseSchema,
  type ActivityId,
} from "@call-nina/contracts";
import { CallNinaAppServerClient } from "@call-nina/codex-client";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";

import { DesktopBackend } from "./backend.js";
import { parseCallNinaActivityUrl } from "./deep-link.js";
import { appendDesktopLog } from "./logging.js";
import { publishRendererReadiness } from "./readiness.js";
import {
  attachNavigationPolicy,
  configureSessionSecurity,
  isTrustedRendererFrame,
  openValidatedExternalUrl,
} from "./security.js";

const rendererUrl = new URL(
  process.env["CALL_NINA_RENDERER_URL"] ?? new URL("../renderer/index.html", import.meta.url),
).href;
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const developmentWindowIcon = fileURLToPath(new URL("../../assets/call-nina.png", import.meta.url));
let backend: DesktopBackend | undefined;
let mainWindow: BrowserWindow | undefined;
let pendingActivityId: ActivityId | undefined;
let readinessPublished = false;
let workspaceReady = false;
let shutdownStarted = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: "Call Nina",
    backgroundColor: "#f7f3ea",
    show: false,
    ...(app.isPackaged ? {} : { icon: developmentWindowIcon }),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload,
    },
  });
  attachNavigationPolicy(window, rendererUrl);
  window.webContents.on("did-start-loading", () => {
    workspaceReady = false;
  });
  window.once("ready-to-show", () => {
    window.show();
  });
  window.webContents.once("did-finish-load", () => {
    if (pendingActivityId) {
      const activityId = pendingActivityId;
      pendingActivityId = undefined;
      deliverActivity(activityId);
    }
  });
  void window.loadURL(rendererUrl);
  return window;
}

function deliverActivity(activityId: ActivityId): void {
  if (!workspaceReady || !mainWindow || mainWindow.webContents.isLoading()) {
    pendingActivityId = activityId;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  void backend
    ?.openActivityLink({
      action: "open-activity",
      activityId,
    })
    .catch(() => {
      // Missing, stale or unsupported external references never trigger navigation.
    });
}

function handleProtocolArguments(argumentsList: readonly string[]): void {
  const candidate = argumentsList.find((argument) => argument.startsWith("call-nina://"));
  if (!candidate) return;
  try {
    deliverActivity(parseCallNinaActivityUrl(candidate).activityId);
  } catch {
    // Invalid external arguments are ignored; no arbitrary command or path is opened.
  }
}

function installIpc(): void {
  ipcMain.on("call-nina:workspace-ready", (event, ready: unknown) => {
    if (!isTrustedRendererFrame(event.senderFrame, mainWindow, rendererUrl)) return;
    workspaceReady = ready === true;
    if (workspaceReady && pendingActivityId) {
      const activityId = pendingActivityId;
      pendingActivityId = undefined;
      deliverActivity(activityId);
    }
  });
  ipcMain.handle("call-nina:invoke", async (event, value: unknown) => {
    if (!isTrustedRendererFrame(event.senderFrame, mainWindow, rendererUrl)) {
      throw new Error("OD_IPC_SENDER_INVALID");
    }
    const parsedRequest = desktopIpcRequestSchema.safeParse(value);
    if (!parsedRequest.success) throw new Error("OD_IPC_REQUEST_INVALID");
    const response = await backend?.handle(parsedRequest.data);
    const parsedResponse = desktopIpcResponseSchema.safeParse(response);
    if (!parsedResponse.success) throw new Error("OD_IPC_RESPONSE_INVALID");
    return parsedResponse.data;
  });
  ipcMain.on("call-nina:renderer-ready", (event) => {
    if (!isTrustedRendererFrame(event.senderFrame, mainWindow, rendererUrl)) return;
    if (readinessPublished) return;
    readinessPublished = true;
    void publishRendererReadiness().catch(() => {
      app.exit(1);
    });
  });
}

if (process.platform === "linux") app.setDesktopName("dev.callnina.app");

const defaultUserData = app.isPackaged
  ? path.join(app.getPath("appData"), "Call Nina")
  : app.getPath("userData");
app.setName("Call Nina");
const configuredUserData = desktopPathOption("config-dir");
const codexExecutable = desktopPathOption("codex-executable");
if (configuredUserData) {
  if (!path.isAbsolute(configuredUserData) || configuredUserData.includes("\0"))
    throw new Error("OD_CONFIG_PATH_INVALID");
  app.setPath("userData", configuredUserData);
} else {
  app.setPath("userData", defaultUserData);
}
const userDataDirectory = app.getPath("userData");
let configCursor = path.parse(userDataDirectory).root;
for (const segment of userDataDirectory
  .slice(configCursor.length)
  .split(path.sep)
  .filter(Boolean)) {
  configCursor = path.join(configCursor, segment);
  try {
    if (lstatSync(configCursor).isSymbolicLink()) throw new Error("OD_CONFIG_LINK_UNSAFE");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleProtocolArguments([url]);
  });
  app.on("second-instance", (_event, commandLine) => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
    handleProtocolArguments(commandLine);
  });
  app.on("before-quit", (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    void (backend?.shutdown() ?? Promise.resolve()).finally(() => {
      app.quit();
    });
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      app.quit();
    });
  }
  void app.whenReady().then(() => {
    if (app.isPackaged) app.setAsDefaultProtocolClient("call-nina");
    handleProtocolArguments(process.argv);
    configureSessionSecurity(
      session.defaultSession,
      Boolean(process.env["CALL_NINA_RENDERER_URL"]),
    );
    const userData = app.getPath("userData");
    const bootstrapFile = path.join(userData, "bootstrap.json");
    const knownInstallRoots = [app.getAppPath(), process.resourcesPath];
    const runId = process.env["CALL_NINA_RUN_ID"] ?? `desktop_${randomUUID().replaceAll("-", "")}`;
    const sessionId = `session_${randomUUID().replaceAll("-", "")}`;
    const log = (record: Parameters<typeof appendDesktopLog>[1]) => {
      void appendDesktopLog(bootstrapFile, {
        ...record,
        runId,
        sessionId,
      }).catch(() => undefined);
    };
    log({
      timestamp: new Date().toISOString(),
      severity: "info",
      component: "desktop",
      code: "DESKTOP_STARTED",
      message: "Call Nina desktop process started.",
      phase: "started",
    });
    const appServer = new CallNinaAppServerClient({
      forbiddenRoots: [userData, ...knownInstallRoots, ...(app.isPackaged ? [] : [process.cwd()])],
      openExternal: openValidatedExternalUrl,
      presentDeviceCode: async ({ verificationUrl, userCode }) => {
        await openValidatedExternalUrl(verificationUrl);
        await dialog.showMessageBox({
          type: "info",
          title: "Call Nina account connection",
          message: "Enter this one-time code in the browser window:",
          detail: userCode,
          buttons: ["Continue"],
          defaultId: 0,
          noLink: true,
        });
      },
      processOptions: {
        ...(codexExecutable === undefined ? {} : { executable: codexExecutable }),
        log,
        runId,
        sessionId,
      },
    });
    backend = new DesktopBackend({
      curriculumRoot: app.isPackaged
        ? path.join(process.resourcesPath, "curriculum")
        : fileURLToPath(new URL("../../../../content/curriculum/", import.meta.url)),
      bootstrapFile,
      secrets: new ConnectionSecretStorage(userData),
      knownInstallRoots,
      appServer,
      openExternal: openValidatedExternalUrl,
      log,
      emitEvent: (event) => {
        const safeEvent = desktopIpcEventSchema.parse(event);
        if (
          safeEvent.event === "prepared-activity-open" &&
          (!workspaceReady || !mainWindow || mainWindow.webContents.isLoading())
        ) {
          pendingActivityId = safeEvent.activityId;
          return;
        }
        mainWindow?.webContents.send("call-nina:event", safeEvent);
      },
      exportDiagnostics: async (content) => {
        const result = await dialog.showSaveDialog({
          title: "Export redacted Call Nina diagnostics",
          defaultPath: path.join(app.getPath("documents"), "call-nina-diagnostics.json"),
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (result.canceled || !result.filePath) return { status: "cancelled" };
        await writeFile(result.filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
        return { status: "exported", displayName: path.basename(result.filePath) };
      },
      chooseDirectory: async () => {
        const result = await dialog.showOpenDialog({
          defaultPath: path.join(app.getPath("documents"), "Call Nina"),
          title: "Choose Call Nina data folder",
          properties: ["openDirectory", "createDirectory"],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
    });
    installIpc();
    mainWindow = createWindow();
  });
}
