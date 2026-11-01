const repository = "https://github.com/pedroaz/call-nina";
const releaseApi = "https://api.github.com/repos/pedroaz/call-nina/releases";
const platforms = {
  "linux-x64": ["AppImage"],
  "win32-x64": ["zip"],
  "darwin-x64": ["dmg", "tar.gz"],
  "darwin-arm64": ["dmg", "tar.gz"],
} as const;

type Download = { version: string; releaseUrl: string; url: string; format: string };
type Downloads = {
  schemaVersion: 2;
  releaseUrl: string;
  downloads: Partial<Record<keyof typeof platforms, Download>>;
};
let cached: { data: Downloads; expires: number } | undefined;
let pending: Promise<Downloads | null> | undefined;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid release");
  return value as Record<string, unknown>;
}
function newer(left: string, right: string): boolean {
  const a = left.split(".").map(BigInt),
    b = right.split(".").map(BigInt);
  for (const [index, value] of a.entries()) {
    const other = b[index] ?? 0n;
    if (value !== other) return value > other;
  }
  return false;
}
async function latest(): Promise<Downloads | null> {
  // Resolve each platform independently; publication order and GitHub's global
  // "latest" release cannot establish the newest version for an omitted platform.
  const downloads: Downloads["downloads"] = {};
  const signal = AbortSignal.timeout(10000);
  // Bound anonymous API work. Never silently return an incomplete historical scan.
  for (let page = 1; page <= 5; page++) {
    const response = await fetch(`${releaseApi}?per_page=100&page=${String(page)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Call-Nina-downloads" },
      signal,
      redirect: "error",
      cache: "no-store",
    });
    if (response.status === 404 && page === 1) return null;
    if (!response.ok) throw new Error("Release lookup unavailable");
    const batch: unknown = await response.json();
    if (!Array.isArray(batch)) throw new Error("Invalid release listing");
    for (const value of batch) {
      const release = record(value);
      if (
        release["draft"] !== false ||
        release["prerelease"] !== false ||
        typeof release["published_at"] !== "string"
      )
        continue;
      const tag = release["tag_name"];
      if (typeof tag !== "string") continue;
      const version = /^desktop-v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
      if (!version) continue;
      const releaseUrl = `${repository}/releases/tag/${tag}`;
      if (release["html_url"] !== releaseUrl || !Array.isArray(release["assets"]))
        throw new Error("Unexpected desktop release metadata");
      const assets = release["assets"].map(record);
      for (const [platform, extensions] of Object.entries(platforms)) {
        const id = platform as keyof typeof platforms;
        if (downloads[id] && !newer(version, downloads[id].version)) continue;
        const format = extensions.find((extension) =>
          assets.some((asset) => asset["name"] === `Call-Nina-${version}-${platform}.${extension}`),
        );
        // An omitted platform keeps its newest asset from another release.
        if (!format) continue;
        const name = `Call-Nina-${version}-${platform}.${format}`;
        const matches = assets.filter((asset) => asset["name"] === name);
        const asset = matches[0];
        if (
          matches.length !== 1 ||
          !asset ||
          asset["state"] !== "uploaded" ||
          typeof asset["size"] !== "number" ||
          asset["size"] <= 0
        )
          throw new Error("Invalid desktop release asset");
        const url = asset["browser_download_url"];
        if (url !== `${repository}/releases/download/${tag}/${name}`)
          throw new Error("Unexpected asset URL");
        downloads[id] = { version, releaseUrl, url, format };
      }
    }
    if (batch.length < 100)
      return Object.keys(downloads).length
        ? { schemaVersion: 2, releaseUrl: `${repository}/releases`, downloads }
        : null;
  }
  throw new Error("Desktop release history exceeds lookup limit");
}
export async function GET(): Promise<Response> {
  try {
    if (!cached || cached.expires <= Date.now()) {
      if (!pending) {
        pending = latest()
          .then((data) => {
            if (data) cached = { data, expires: Date.now() + 300000 };
            return data;
          })
          .finally(() => {
            pending = undefined;
          });
      }
      const data = await pending;
      if (!data)
        return Response.json(
          { error: "unavailable", releaseUrl: `${repository}/releases` },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
    }
    // Only the server caches successes; browsers/CDNs must not add another TTL.
    const current = cached;
    if (!current) throw new Error("Release cache unavailable");
    return Response.json(current.data, {
      headers: {
        "Cache-Control": "no-store",
        "X-Downloads-Refresh-After": String(
          Math.max(1, Math.ceil((current.expires - Date.now()) / 1000)),
        ),
      },
    });
  } catch {
    return Response.json(
      { error: "unavailable", releaseUrl: `${repository}/releases` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
