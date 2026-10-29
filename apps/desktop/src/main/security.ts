import { ninaPublicConfiguration } from "@call-nina/contracts";
import { shell, type BrowserWindow, type Session, type WebFrameMain } from "electron";
import { codexVoiceWorkspacePath, ensureCodexVoiceWorkspace } from "./voice-workspace.js";

const clerkHost = ninaPublicConfiguration.publishableKey
  ? `https://${Buffer.from(
      ninaPublicConfiguration.publishableKey.replace(/^pk_(test|live)_/u, ""),
      "base64",
    )
      .toString("utf8")
      .replace(/\$$/u, "")}`
  : "";
if (clerkHost && !/^https:\/\/[a-zA-Z0-9.-]+$/u.test(clerkHost))
  throw new Error("OD_CLERK_HOST_INVALID");
export const productionContentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' ${clerkHost}`,
  "style-src 'self' 'unsafe-hashes' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self' blob:",
  `connect-src 'self' ${clerkHost}`,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const developmentContentSecurityPolicy = productionContentSecurityPolicy
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace(
    "style-src 'self' 'unsafe-hashes' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='",
    "style-src 'self' 'unsafe-inline'",
  );

export function configureSessionSecurity(session: Session, rendererUrl: string | undefined): void {
  const policy = rendererUrl
    ? developmentContentSecurityPolicy.replace(
        "connect-src 'self'",
        `connect-src 'self' ${new URL(rendererUrl).origin.replace(/^http/u, "ws")}`,
      )
    : productionContentSecurityPolicy;
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
}

export function isTrustedRendererFrame(
  frame: WebFrameMain | null,
  window: BrowserWindow | undefined,
  rendererUrl: string,
): boolean {
  if (!frame || !window || frame !== window.webContents.mainFrame) return false;
  let expected: URL;
  let candidate: URL;
  try {
    expected = new URL(rendererUrl);
    candidate = new URL(frame.url);
  } catch {
    return false;
  }
  return (
    candidate.protocol === expected.protocol &&
    candidate.host === expected.host &&
    candidate.pathname === expected.pathname
  );
}

export async function openValidatedExternalUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OD_EXTERNAL_URL_INVALID");
  }
  if (url.username || url.password || url.port || url.hash) {
    throw new Error("OD_EXTERNAL_URL_INVALID");
  }
  const isHttps = url.protocol === "https:" && Boolean(url.hostname);
  const codexParameters = [...url.searchParams.keys()];
  const isCodexActivity =
    url.protocol === "codex:" &&
    url.hostname === "new" &&
    (url.pathname === "" || url.pathname === "/") &&
    codexParameters.length === 3 &&
    codexParameters.includes("prompt") &&
    codexParameters.includes("path") &&
    codexParameters.includes("mode") &&
    url.searchParams.get("mode") === "codex" &&
    url.searchParams.get("path") === codexVoiceWorkspacePath() &&
    Boolean(url.searchParams.get("prompt"));
  if (!isHttps && !isCodexActivity) throw new Error("OD_EXTERNAL_URL_INVALID");
  if (isCodexActivity) await ensureCodexVoiceWorkspace();
  await shell.openExternal(url.href);
}

export function attachNavigationPolicy(window: BrowserWindow, rendererUrl: string): void {
  const allowed = new URL(rendererUrl);
  window.webContents.on("will-navigate", (event, target) => {
    let candidate: URL;
    try {
      candidate = new URL(target);
    } catch {
      event.preventDefault();
      return;
    }
    if (candidate.origin !== allowed.origin || candidate.pathname !== allowed.pathname) {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
