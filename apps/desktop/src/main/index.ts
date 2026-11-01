import { installNativeMenu } from "./native-menu.js";
import { installFailureDiagnostics, observeWindow, startupLog } from "./startup-diagnostics.js";
import { interfaceMessage } from "./localization.js";
import {
  desktopIpcEventSchema,
  desktopIpcRequestSchema,
  desktopIpcResponseSchema,
  ninaPublicConfiguration,
  type ActivityId,
} from "@call-nina/contracts";
import { OfflineRuntime } from "@call-nina/offline-runtime";
import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NinaLoginStorage } from "./nina-login-storage.js";
import { desktopPathOption } from "./options.js";
import { ConnectionSecretStorage } from "./secret-storage.js";

import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { ChatgptSession } from "./chatgpt-session.js";

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

declare const __NINA_APP_VERSION__: string;

// Interactive launchers may inject Chromium's plaintext/mock credential stores.
// Nina always uses the real OS key provider; unavailable stores remain unavailable.
if (process.platform === "linux" && app.commandLine.getSwitchValue("password-store") === "basic")
  app.commandLine.removeSwitch("password-store");
app.commandLine.removeSwitch("use-mock-keychain");

const rendererUrl = new URL(
  process.env["CALL_NINA_RENDERER_URL"] ??
    (ninaPublicConfiguration.publishableKey
      ? "call-nina-ui://renderer/index.html"
      : new URL("../renderer/index.html", import.meta.url)),
).href;
const preload = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const windowIcon = app.isPackaged
  ? path.join(process.resourcesPath, "call-nina.png")
  : fileURLToPath(new URL("../../assets/call-nina.png", import.meta.url));
let backend: DesktopBackend | undefined;
let mainWindow: BrowserWindow | undefined;
let pendingActivityId: ActivityId | undefined;
let readinessPublished = false;
let workspaceReady = false;
let shutdownStarted = false;
let pendingSettings = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: `Call Nina v${__NINA_APP_VERSION__}`,
    backgroundColor: "#f7f3ea",
    show: false,
    icon: windowIcon,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload,
    },
  });
  // The HTML document title must not replace the running build version.
  window.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  observeWindow(window);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
    workspaceReady = false;
    readinessPublished = false;
  });
  attachNavigationPolicy(window, rendererUrl);
  // Keep zoom available without installing a visible application menu.
  window.webContents.on("before-input-event", (event, input) => {
    if (process.platform === "darwin") return;
    const modifier = input.control;
    if (input.type !== "keyDown" || !modifier || input.alt) return;
    const zoomIn = input.key === "+" || input.key === "=";
    const zoomOut = input.key === "-";
    const reset = input.key === "0" || input.code === "Digit0" || input.code === "Numpad0";
    if (!zoomIn && !zoomOut && !reset) return;
    event.preventDefault();
    const current = window.webContents.getZoomFactor();
    window.webContents.setZoomFactor(
      reset ? 1 : Math.min(5, Math.max(0.25, current * (zoomIn ? 1.2 : 1 / 1.2))),
    );
  });
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
  startupLog("DESKTOP_RENDERER_LOADING");
  void window.loadURL(rendererUrl).catch(() => {
    startupLog("DESKTOP_RENDERER_LOAD_FAILED");
  });
  return window;
}

function showWindow(): void {
  if (!backend || shutdownStarted) return;
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function deliverSettings(): void {
  if (!workspaceReady || !mainWindow) return;
  pendingSettings = false;
  mainWindow.webContents.send(
    "call-nina:event",
    desktopIpcEventSchema.parse({ event: "settings-open" }),
  );
}
function deliverActivity(activityId: ActivityId): void {
  showWindow();
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
    if (workspaceReady && pendingSettings) deliverSettings();
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
    startupLog("DESKTOP_RENDERER_READY");
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
const speechBundleDirectory = desktopPathOption("speech-bundles-dir");
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
installFailureDiagnostics();
startupLog("DESKTOP_CONFIGURATION_READY");

const clerkBridge = ninaPublicConfiguration.publishableKey
  ? createClerkBridge({
      storage: storage({
        name: "nina-account",
        path: userDataDirectory,
        unencryptedFallback: false,
      }),
      renderer: { scheme: "call-nina-ui", host: "renderer" },
      manageSingleInstanceLock: false,
    })
  : undefined;
app.on("will-quit", () => clerkBridge?.cleanup());
void app.whenReady().then(() => {
  if (!clerkBridge) return;
  const directory = path.resolve(fileURLToPath(new URL("../renderer/", import.meta.url)));
  protocol.handle("call-nina-ui", (request) => {
    const url = new URL(request.url);
    const target = path.resolve(directory, `.${decodeURIComponent(url.pathname)}`);
    if (url.host !== "renderer" || !target.startsWith(`${directory}${path.sep}`))
      return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(target).href);
  });
});
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleProtocolArguments([url]);
  });
  app.on("second-instance", (_event, commandLine) => {
    showWindow();
    handleProtocolArguments(commandLine);
  });
  app.on("before-quit", (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    startupLog("DESKTOP_SHUTDOWN_STARTED");
    const timeout = setTimeout(() => {
      startupLog("DESKTOP_SHUTDOWN_TIMEOUT");
      app.exit(1);
    }, 10_000);
    void (backend?.shutdown() ?? Promise.resolve()).then(
      () => {
        clearTimeout(timeout);
        startupLog("DESKTOP_SHUTDOWN_COMPLETE");
        app.quit();
      },
      () => {
        clearTimeout(timeout);
        startupLog("DESKTOP_SHUTDOWN_FAILED");
        app.exit(1);
      },
    );
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    showWindow();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      app.quit();
    });
  }
  void app
    .whenReady()
    .then(() => {
      installNativeMenu(() => {
        pendingSettings = true;
        showWindow();
        deliverSettings();
      });
      if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(windowIcon);
      if (app.isPackaged) app.setAsDefaultProtocolClient("call-nina");
      handleProtocolArguments(process.argv);
      configureSessionSecurity(session.defaultSession, process.env["CALL_NINA_RENDERER_URL"]);
      const userData = app.getPath("userData");
      const bootstrapFile = path.join(userData, "bootstrap.json");
      const knownInstallRoots = [app.getAppPath(), process.resourcesPath];
      const runId =
        process.env["CALL_NINA_RUN_ID"] ?? `desktop_${randomUUID().replaceAll("-", "")}`;
      const sessionId = `session_${randomUUID().replaceAll("-", "")}`;
      const log = (record: Parameters<typeof appendDesktopLog>[1]) => {
        if (
          [
            "DESKTOP_DATABASE_OPENING",
            "DESKTOP_DATABASE_READY",
            "DESKTOP_DATA_ROOT_FAILED",
          ].includes(record.code)
        )
          startupLog(record.code);
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
      const secrets = new ConnectionSecretStorage(userData);
      startupLog("DESKTOP_CREDENTIAL_STORE", { reason: secrets.state().status });
      const chatgpt = new ChatgptSession({
        configDirectory: userData,
        interfaceLocale: async () => backend?.interfaceLocale(),
        secrets,
        openExternal: openValidatedExternalUrl,
      });
      startupLog("DESKTOP_BACKEND_STARTING");
      backend = new DesktopBackend({
        ...(speechBundleDirectory ? { speechBundleDirectory } : {}),
        ...(!app.isPackaged && process.platform === "linux" && process.arch === "x64"
          ? {
              developmentSpeechBundlesDirectory: path.resolve(
                fileURLToPath(new URL("../../../../build/speech-distribution/", import.meta.url)),
              ),
              legacySpeechCandidatesDirectory: fileURLToPath(
                new URL("../../../../build/speech-candidates/", import.meta.url),
              ),
            }
          : {}),
        loginCredentials: new NinaLoginStorage(userData),
        curriculumRoot: app.isPackaged
          ? path.join(process.resourcesPath, "curriculum")
          : fileURLToPath(new URL("../../../../content/curriculum/", import.meta.url)),
        bootstrapFile,
        secrets,
        offlineRuntime: new OfflineRuntime({ artifactRoot: path.join(userData, "offline") }),
        knownInstallRoots,
        chatgpt,
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
            title: interfaceMessage(
              (await backend?.interfaceLocale()) ?? "en-US",
              "exportDiagnostics",
            ),
            defaultPath: path.join(app.getPath("documents"), "call-nina-diagnostics.json"),
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (result.canceled || !result.filePath) return { status: "cancelled" };
          await writeFile(result.filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
          return { status: "exported", displayName: path.basename(result.filePath) };
        },
        chooseDirectory: async (uiLocale) => {
          const result = await dialog.showOpenDialog({
            defaultPath: path.join(app.getPath("documents"), "Call Nina"),
            title: interfaceMessage(uiLocale, "chooseFolder"),
            properties: ["openDirectory", "createDirectory"],
          });
          return result.canceled ? undefined : result.filePaths[0];
        },
      });
      startupLog("DESKTOP_BACKEND_READY");
      installIpc();
      mainWindow = createWindow();
    })
    .catch((error: unknown) => {
      startupLog("DESKTOP_STARTUP_FAILED");
      process.stderr.write(
        error instanceof Error && /^OD_SPEECH_[A-Z_]+$/u.test(error.message)
          ? `${error.message}\n`
          : "OD_DESKTOP_STARTUP_FAILED\n",
      );
      app.exit(1);
    });
}
