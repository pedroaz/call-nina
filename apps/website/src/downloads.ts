import type { Locale } from "./locales";

export const platforms = ["linux-x64", "win32-x64", "darwin-x64", "darwin-arm64"] as const;
export type Platform = (typeof platforms)[number];
export type Download = { version: string; releaseUrl: string; url: string; format: string };
export type Downloads = {
  schemaVersion: 2;
  releaseUrl: string;
  downloads: Partial<Record<Platform, Download>>;
};
export const releasesUrl = "https://github.com/pedroaz/call-nina/releases";
export const platformLabels: Record<Platform, string> = {
  "linux-x64": "Linux x64 · AppImage",
  "win32-x64": "Windows x64 · ZIP",
  "darwin-x64": "Mac Intel · Experimental — runtime verification pending",
  "darwin-arm64": "Mac Apple Silicon",
};
const english = {
  download: "Download",
  all: "All downloads",
  close: "Close",
  loading: "Checking downloads…",
  unavailable: "Downloads are not available yet.",
  error: "Could not load downloads.",
  retry: "Retry",
  releases: "GitHub Releases",
};
export const downloadCopy: Record<Locale, typeof english> = {
  en: english,
  de: {
    download: "Herunterladen",
    all: "Alle Downloads",
    close: "Schließen",
    loading: "Downloads werden geprüft…",
    unavailable: "Downloads sind noch nicht verfügbar.",
    error: "Downloads konnten nicht geladen werden.",
    retry: "Erneut versuchen",
    releases: "GitHub-Releases",
  },
  es: {
    download: "Descargar",
    all: "Todas las descargas",
    close: "Cerrar",
    loading: "Buscando descargas…",
    unavailable: "Las descargas aún no están disponibles.",
    error: "No se pudieron cargar las descargas.",
    retry: "Reintentar",
    releases: "Versiones en GitHub",
  },
  "pt-BR": {
    download: "Baixar",
    all: "Todos os downloads",
    close: "Fechar",
    loading: "Verificando downloads…",
    unavailable: "Os downloads ainda não estão disponíveis.",
    error: "Não foi possível carregar os downloads.",
    retry: "Tentar novamente",
    releases: "Versões no GitHub",
  },
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid downloads");
  return value as Record<string, unknown>;
}
export function parseDownloads(value: unknown): Downloads {
  const data = record(value);
  if (data["schemaVersion"] !== 2 || data["releaseUrl"] !== releasesUrl)
    throw new Error("Invalid downloads");
  const entries = record(data["downloads"]);
  if (Object.keys(entries).some((id) => !platforms.some((platform) => platform === id)))
    throw new Error("Invalid download platform");
  const downloads: Downloads["downloads"] = {};
  for (const platform of platforms) {
    if (entries[platform] === undefined) continue;
    const entry = record(entries[platform]);
    const version = entry["version"],
      format = entry["format"],
      url = entry["url"];
    const releaseUrl = `${releasesUrl}/tag/desktop-v${typeof version === "string" ? version : ""}`;
    if (
      typeof version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(version) ||
      entry["releaseUrl"] !== releaseUrl
    )
      throw new Error("Invalid download metadata");
    const extensions =
      platform === "linux-x64"
        ? ["AppImage"]
        : platform === "win32-x64"
          ? ["zip"]
          : ["dmg", "tar.gz"];
    if (
      typeof format !== "string" ||
      !extensions.includes(format) ||
      url !==
        `${releasesUrl}/download/desktop-v${version}/Call-Nina-${version}-${platform}.${format}`
    )
      throw new Error("Invalid download URL");
    downloads[platform] = { version, releaseUrl, url, format };
  }
  if (!Object.keys(downloads).length) throw new Error("No downloads available");
  return { schemaVersion: 2, releaseUrl: releasesUrl, downloads };
}

type Hints = { platform?: string; mobile?: boolean; architecture?: string; bitness?: string };
type HintNavigator = Navigator & {
  userAgentData?: Hints & { getHighEntropyValues?: (keys: string[]) => Promise<Hints> };
};
export async function recommendedPlatform(): Promise<Platform | null> {
  const browser = navigator as HintNavigator;
  const ua = browser.userAgent;
  const data = browser.userAgentData;
  if (
    data?.mobile ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Mac/.test(browser.platform) && browser.maxTouchPoints > 1)
  )
    return null;
  let hints: Hints = data ?? {};
  try {
    hints = { ...hints, ...(await data?.getHighEntropyValues?.(["architecture", "bitness"])) };
  } catch {
    /* Architecture hints are optional. */
  }
  const os = hints.platform || browser.platform || ua;
  const architecture = hints.architecture?.toLowerCase();
  let arch: "x64" | "arm64" | "unsupported" | null = null;
  if (architecture) {
    if (hints.bitness === "32") arch = "unsupported";
    else if (["arm64", "aarch64"].includes(architecture)) arch = "arm64";
    else if (architecture === "arm") arch = hints.bitness === "64" ? "arm64" : null;
    else if (["x86_64", "x64", "amd64"].includes(architecture)) arch = "x64";
    else if (architecture === "x86") arch = hints.bitness === "64" ? "x64" : null;
    else arch = "unsupported";
  } else if (/aarch64|arm64/i.test(ua)) arch = "arm64";
  else if (/x86_64|x64|Win64|WOW64|amd64/i.test(ua)) arch = "x64";
  else if (/i[3-6]86|armv\d|ppc|riscv/i.test(ua)) arch = "unsupported";
  // A Mac's Intel UA token is also used by Apple Silicon; only hints can resolve it.
  if (/Mac/i.test(os))
    return arch === "arm64" ? "darwin-arm64" : architecture && arch === "x64" ? "darwin-x64" : null;
  if (/Win/i.test(os)) return arch === "x64" ? "win32-x64" : null;
  if (/Linux/i.test(os)) return arch === "x64" ? "linux-x64" : null;
  return null;
}

export function formatDownloadLabel(platform: Platform, download: Download): string {
  if (!platform.startsWith("darwin-")) return platformLabels[platform];
  const format = download.format === "dmg" ? "DMG" : "tar.gz";
  return `${platformLabels[platform]} · ${format}`;
}
