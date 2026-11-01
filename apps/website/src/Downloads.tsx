import { useCallback, useEffect, useState } from "react";
import { ActionLink, Button, ModalDialog } from "@call-nina/browser-ui";
import type { Locale } from "./locales";
import {
  downloadCopy,
  parseDownloads,
  platforms,
  formatDownloadLabel,
  recommendedPlatform,
  releasesUrl,
  type Downloads as DownloadData,
  type Platform,
} from "./downloads";
import { trackWebsiteEvent } from "./telemetry";
import "./downloads.css";

type State =
  { status: "loading" | "unavailable" | "error" } | { status: "ready"; data: DownloadData };
export function Downloads({ locale }: { locale: Locale }) {
  const t = downloadCopy[locale];
  const [state, setState] = useState<State>({ status: "loading" });
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    void recommendedPlatform().then((value) => {
      if (active) setPlatform(value);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let refresh: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let refreshAfter = 300000;
      try {
        const response = await fetch("/api/downloads", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status === 404) {
          setState({ status: "unavailable" });
          return;
        }
        if (!response.ok) throw new Error("Downloads unavailable");
        const data = parseDownloads(await response.json());
        if (!controller.signal.aborted) {
          setState({ status: "ready", data });
          const remaining = Number(response.headers.get("X-Downloads-Refresh-After"));
          if (Number.isFinite(remaining) && remaining > 0)
            refreshAfter = Math.min(300000, remaining * 1000);
        }
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      } finally {
        if (!controller.signal.aborted) refresh = setTimeout(retry, refreshAfter);
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(refresh);
    };
  }, [attempt, retry]);
  const ready = state.status === "ready" ? state.data : null;
  const downloadLabel = (
    <>
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" />
      </svg>
      <span className="download-label">
        <span>
          {ready ? (platform ? formatDownloadLabel(platform, ready) : t.all) : t.download}
        </span>
        {ready && <span className="download-meta">· v{ready.version}</span>}
      </span>
    </>
  );
  const feedback = (
    <div className="download-feedback">
      <p role="status">{state.status === "ready" ? null : t[state.status]}</p>
      {state.status !== "ready" && (
        <div className="download-recovery">
          <Button
            variant="quiet"
            aria-disabled={state.status === "loading"}
            onPress={() => {
              if (state.status !== "loading") retry();
            }}
          >
            {t.retry}
          </Button>
          <a href={releasesUrl}>{t.releases}</a>
        </div>
      )}
    </div>
  );
  return (
    <div className="downloads">
      <div className="download-controls">
        {ready && platform ? (
          <ActionLink
            className="download-primary"
            href={ready.downloads[platform]}
            onPress={() => {
              trackWebsiteEvent("download_clicked", { platform, version: ready.version });
            }}
            aria-label={`${t.download} ${formatDownloadLabel(platform, ready)} · v${ready.version}`}
          >
            {downloadLabel}
          </ActionLink>
        ) : (
          <Button
            className="download-primary"
            onPress={() => {
              setOpen(true);
            }}
          >
            {downloadLabel}
          </Button>
        )}
        {ready && platform && (
          <Button
            className="download-alternatives"
            variant="secondary"
            onPress={() => {
              setOpen(true);
            }}
          >
            {t.all}
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m7 10 5 5 5-5" />
            </svg>
          </Button>
        )}
      </div>
      {state.status !== "ready" && feedback}
      <ModalDialog isOpen={open} onOpenChange={setOpen} title={t.all} closeLabel={t.close}>
        {ready ? (
          <div className="download-list">
            <p className="download-version">Call Nina {ready.version}</p>
            <ul>
              {platforms.map((id) => (
                <li key={id}>
                  <a
                    href={ready.downloads[id]}
                    onClick={() => {
                      trackWebsiteEvent("download_clicked", {
                        platform: id,
                        version: ready.version,
                      });
                    }}
                  >
                    {formatDownloadLabel(id, ready)}
                  </a>
                </li>
              ))}
            </ul>
            <a href={ready.releaseUrl}>{t.releases}</a>
          </div>
        ) : (
          feedback
        )}
      </ModalDialog>
    </div>
  );
}
