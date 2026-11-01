const repository = "https://github.com/pedroaz/call-nina";
const releaseApi = "https://api.github.com/repos/pedroaz/call-nina/releases/latest";
const platforms = {
  "linux-x64": ["AppImage"],
  "win32-x64": ["zip"],
  "darwin-x64": ["dmg", "tar.gz"],
  "darwin-arm64": ["dmg", "tar.gz"],
} as const;

type Downloads = {
  version: string;
  releaseUrl: string;
  downloads: Record<keyof typeof platforms, string>;
  formats: Record<keyof typeof platforms, string>;
};
let cached: { data: Downloads; expires: number } | undefined;
let pending: Promise<Downloads | null> | undefined;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid release");
  return value as Record<string, unknown>;
}
async function latest(): Promise<Downloads | null> {
  // Public GitHub REST API; no runtime or administration credentials are used.
  const response = await fetch(releaseApi, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Call-Nina-downloads" },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Release lookup unavailable");
  const release = record(await response.json());
  if (
    release["draft"] !== false ||
    release["prerelease"] !== false ||
    typeof release["published_at"] !== "string"
  )
    throw new Error("Release is not public and stable");
  const tag = release["tag_name"];
  if (typeof tag !== "string") throw new Error("Desktop release unavailable");
  const version = /^desktop-v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
  if (!version || !Array.isArray(release["assets"])) throw new Error("Desktop release unavailable");
  const releaseUrl = `${repository}/releases/tag/${tag}`;
  if (release["html_url"] !== releaseUrl) throw new Error("Unexpected release URL");
  const downloads = {} as Downloads["downloads"];
  const formats = {} as Downloads["formats"];
  for (const [platform, extensions] of Object.entries(platforms)) {
    const extension = extensions.find(
      (candidate) =>
        release["assets"] instanceof Array &&
        release["assets"].some(
          (asset: unknown) =>
            record(asset)["name"] === `Call-Nina-${version}-${platform}.${candidate}`,
        ),
    );
    if (!extension) throw new Error("Desktop release assets incomplete");
    formats[platform as keyof typeof platforms] = extension;
    const name = `Call-Nina-${version}-${platform}.${extension}`;
    const matches = release["assets"].map(record).filter((asset) => asset["name"] === name);
    const asset = matches[0];
    if (
      matches.length !== 1 ||
      !asset ||
      asset["state"] !== "uploaded" ||
      typeof asset["size"] !== "number" ||
      asset["size"] <= 0
    )
      throw new Error("Desktop release assets incomplete");
    // The URL must be supplied by GitHub, and must target this release and asset.
    const url = asset["browser_download_url"];
    if (url !== `${repository}/releases/download/${tag}/${name}`)
      throw new Error("Unexpected asset URL");
    downloads[platform as keyof typeof platforms] = url;
  }
  return { version, releaseUrl, downloads, formats };
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
