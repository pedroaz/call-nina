import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserWindow, session } from "electron";
import { materialSourceSchema, websiteSourceSchema, z } from "@call-nina/contracts";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
function pageUrl(value: string) {
  const url = new URL(materialSourceSchema.shape.url.parse(value));
  if (url.port && url.port !== "443") throw new Error("OD_WEBSITE_IMPORT_FAILED");
  url.hash = "";
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (isIP(host) && !publicAddress(host)) throw new Error("OD_WEBSITE_IMPORT_FAILED");
  return url;
}

// Validate the actual addresses used for this socket, including every redirect.
// Chromium never opens network sockets: every HTTPS resource uses this transport.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true })
    .then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
        callback(new Error("OD_WEBSITE_IMPORT_FAILED"), []);
        return;
      }
      const first = addresses[0];
      if (options.all) callback(null, addresses);
      else if (first) callback(null, first.address, first.family);
    })
    .catch(() => callback(new Error("OD_WEBSITE_IMPORT_FAILED"), []));
};

// Fixed app-owned code, executed in an isolated world, never page-provided code.
const capturePage = `(() => {
  const excluded = 'script,style,noscript,template,iframe,nav,footer,header,form,button,input,select,textarea,[hidden],[aria-hidden="true"],[role="navigation"],[role="status"],[role="banner"],[role="contentinfo"],[role="dialog"],[aria-modal="true"],.sr-only,.visually-hidden,[id*="cookie" i],[class*="cookie-banner" i],[class*="cookie-consent" i],[id*="consent" i],[class*="consent-banner" i],[class*="consent-modal" i],[class*="consent-dialog" i],#usercentrics-root';
  const parts = [];
  let length = 0, visited = 0;
  function visit(node) {
    if (++visited > 50000 || length > 120000) return;
    if (node.nodeType === 3) {
      const value = node.textContent.replace(/\\s+/gu, ' ');
      parts.push(value); length += value.length; return;
    }
    if (node.nodeType !== 1 || node.matches(excluded)) return;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
    const block = /^(P|DIV|SECTION|ARTICLE|MAIN|LI|H[1-6]|TR|BLOCKQUOTE|PRE|BR)$/.test(node.tagName);
    if (block) parts.push('\\n');
    for (const child of node.childNodes) visit(child);
    if (block) parts.push('\\n');
  }
  if (document.body) visit(document.body);
  const seen = new Set();
  const text = parts.join('').split('\\n').map(line => line.trim()).filter(line => {
    if (!line || /^(?:inhalt|angebote.*|content|footer).*wird geladen[.!…]*$/iu.test(line) || /^(?:loading|please wait|inhalt wird geladen|content is loading)[.!…]*$/iu.test(line)) return false;
    if (seen.has(line)) return false;
    seen.add(line); return true;
  }).join('\\n\\n');
  return { title: document.title, text: text.slice(0,120000), truncated: length > 120000 || visited > 50000 };
})()`;

/** A temporary, credential-free rendered snapshot of exactly one public page. */
export async function importWebsite(value: string, cancellation: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, cancellation]);
  const initial = pageUrl(value);
  const readerSession = session.fromPartition(`website-reader-${randomUUID()}`, { cache: false });
  let bytes = 0,
    resources = 0,
    pending = 0,
    lastNetwork = Date.now(),
    redirects = 0;
  readerSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  readerSession.setPermissionCheckHandler(() => false);
  readerSession.on("will-download", (event) => event.preventDefault());
  readerSession.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel:
        !details.url.startsWith("https:") ||
        ["image", "font", "media", "object", "webSocket", "ping", "cspReport", "subFrame"].includes(
          details.resourceType,
        ),
    });
  });
  readerSession.webRequest.onHeadersReceived((details, callback) => {
    const failed = details.resourceType === "mainFrame" && details.statusCode >= 400;
    callback({ cancel: failed });
    // Never destroy a WebContents reentrantly inside a Chromium network callback.
    if (failed) setImmediate(() => controller.abort());
  });
  readerSession.protocol.handle("https", async (resource) => {
    let started = false;
    try {
      signal.throwIfAborted();
      if (++resources > 200 || !["GET", "HEAD", "OPTIONS"].includes(resource.method))
        return new Response(null, { status: 403 });
      const url = pageUrl(resource.url);
      pending++;
      started = true;
      return await new Promise<Response>((resolve, reject) => {
        // Never forward cookies, auth, proxy headers or arbitrary page headers.
        const headers: Record<string, string> = { "Accept-Encoding": "identity" };
        for (const name of [
          "accept",
          "accept-language",
          "user-agent",
          "origin",
          "access-control-request-method",
          "access-control-request-headers",
        ]) {
          const val = resource.headers.get(name);
          if (val) headers[name] = val;
        }
        const req = request(
          url,
          { method: resource.method, signal, agent: false, lookup: publicLookup, headers },
          (response) => {
            const status = response.statusCode ?? 502;
            if (response.headers.location) {
              try {
                pageUrl(new URL(response.headers.location, url).href);
              } catch {
                response.destroy();
                reject(new Error("OD_WEBSITE_IMPORT_FAILED"));
                return;
              }
            }
            if (
              response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity"
            ) {
              response.destroy();
              reject(new Error("OD_WEBSITE_IMPORT_FAILED"));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              size += chunk.length;
              if (bytes > 20_000_000 || size > 5_000_000) {
                response.destroy(new Error("OD_WEBSITE_IMPORT_FAILED"));
                controller.abort();
              } else chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", () => {
              const resultHeaders = new Headers();
              for (const [name, val] of Object.entries(response.headers)) {
                if (
                  val !== undefined &&
                  ![
                    "set-cookie",
                    "content-length",
                    "content-encoding",
                    "connection",
                    "transfer-encoding",
                    "clear-site-data",
                    "refresh",
                  ].includes(name)
                )
                  resultHeaders.set(name, Array.isArray(val) ? val.join(", ") : val);
              }
              resultHeaders.append(
                "Content-Security-Policy",
                "object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'",
              );
              const body =
                resource.method === "HEAD" || [204, 205, 304].includes(status)
                  ? null
                  : Buffer.concat(chunks);
              try {
                resolve(new Response(body, { status, headers: resultHeaders }));
              } catch {
                reject(new Error("OD_WEBSITE_IMPORT_FAILED"));
              }
            });
          },
        );
        req.on("error", reject);
        req.end();
      });
    } catch {
      return new Response(null, { status: 502 });
    } finally {
      if (started) pending--;
      lastNetwork = Date.now();
    }
  });
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    focusable: false,
    webPreferences: {
      session: readerSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      backgroundThrottling: false,
      navigateOnDragDrop: false,
      disableBlinkFeatures: "WebRTC",
    },
  });
  window.webContents.setAudioMuted(true);
  window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event, target) => {
    try {
      pageUrl(target);
      if (++redirects > 3) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  const abort = () => {
    setImmediate(() => {
      if (!window.isDestroyed()) window.destroy();
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    await window.loadURL(initial.href);
    const loaded = Date.now();
    let previous = "",
      stableSince = Date.now();
    for (;;) {
      signal.throwIfAborted();
      const captured: unknown = await window.webContents.executeJavaScriptInIsolatedWorld(1001, [
        { code: capturePage },
      ]);
      const result = z
        .strictObject({ title: z.string(), text: z.string().max(120_000), truncated: z.boolean() })
        .parse(captured);
      const snapshot = {
        ...result,
        title: result.title.trim().slice(0, 160) || initial.hostname,
        url: pageUrl(window.webContents.getURL()).href,
        capturedAt: new Date().toISOString(),
      };
      if (snapshot.text !== previous) {
        previous = snapshot.text;
        stableSince = Date.now();
      }
      if (
        Date.now() - loaded >= 3_000 &&
        Date.now() - stableSince >= 1_500 &&
        (pending === 0 || Date.now() - loaded > 15_000) &&
        Date.now() - lastNetwork >= 500
      ) {
        if (
          (snapshot.text.match(/\p{L}/gu)?.length ?? 0) < 120 ||
          snapshot.text.split(/\s+/u).length < 25 ||
          /^(?:just a moment|access denied|verify you are human|attention required)/iu.test(
            snapshot.title,
          )
        )
          throw new Error("OD_WEBSITE_IMPORT_FAILED");
        return websiteSourceSchema.parse(snapshot);
      }
      await delay(500, undefined, { signal });
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    signal.removeEventListener("abort", abort);
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!window.isDestroyed()) window.destroy();
    readerSession.protocol.unhandle("https");
    await readerSession.clearStorageData().catch(() => undefined);
  }
}
