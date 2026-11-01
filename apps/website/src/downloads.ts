import type { Locale } from "./locales";

export const platforms = ["linux-x64", "win32-x64", "darwin-x64", "darwin-arm64"] as const;
export type Platform = (typeof platforms)[number];
export type Downloads = {
  version: string;
  releaseUrl: string;
  downloads: Record<Platform, string>;
};
export const releasesUrl = "https://github.com/pedroaz/call-nina/releases";
export const platformLabels: Record<Platform, string> = {
  "linux-x64": "Linux x64 · AppImage",
  "win32-x64": "Windows x64 · ZIP",
  "darwin-x64": "Mac Intel · tar.gz",
  "darwin-arm64": "Mac Apple Silicon · tar.gz",
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

export function parseDownloads(value: unknown): Downloads {
  if (!value || typeof value !== "object") throw new Error("Invalid downloads");
  const data = value as Partial<Downloads>;
  if (
    typeof data.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(data.version) ||
    data.releaseUrl !== `${releasesUrl}/tag/desktop-v${data.version}` ||
    !data.downloads
  )
    throw new Error("Invalid downloads");
  for (const platform of platforms) {
    const url = data.downloads[platform];
    const extension =
      platform === "linux-x64" ? "AppImage" : platform === "win32-x64" ? "zip" : "tar.gz";
    if (
      url !==
      `${releasesUrl}/download/desktop-v${data.version}/Call-Nina-${data.version}-${platform}.${extension}`
    )
      throw new Error("Invalid download URL");
  }
  return data as Downloads;
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
