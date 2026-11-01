import { useRef, useState, type ReactNode } from "react";
import { Button } from "@call-nina/browser-ui";
import { chooseConsent } from "./consent";
import { useWebsiteConsent } from "./telemetry";
import { privacyCopy } from "./privacy-copy";
import type { Locale } from "./locales";
import "./privacy.css";

export function WebsitePrivacy({ locale, children }: { locale: Locale; children: ReactNode }) {
  const consent = useWebsiteConsent();
  const [remembered, setRemembered] = useState(true);
  const [editing, setEditing] = useState(false);
  const region = useRef<HTMLElement>(null);
  const settings = useRef<HTMLButtonElement>(null);
  const t = privacyCopy[locale];
  const visible = editing || consent === "unknown";
  function close() {
    setEditing(false);
    settings.current?.focus();
  }
  function decide(choice: "accepted" | "rejected") {
    const stored = chooseConsent(choice);
    setRemembered(stored);
    if (stored) {
      if (editing) close();
      else document.getElementById("main")?.focus({ preventScroll: true });
    } else setEditing(true);
  }
  return (
    <>
      {visible && (
        <section
          className="analytics-consent wrap"
          aria-labelledby="analytics-title"
          ref={region}
          tabIndex={-1}
        >
          <div className="analytics-consent-copy">
            <h2 id="analytics-title">{t.title}</h2>
            <p>
              {t.description} <a href={`/privacy/?lang=${locale}`}>{t.notice}</a>
            </p>
            {!remembered && <p role="status">{t.storageUnavailable}</p>}
            {editing && consent !== "unknown" && (
              <p>{consent === "accepted" ? t.accepted : t.rejected}</p>
            )}
          </div>
          <div className="analytics-consent-actions">
            <Button
              variant="secondary"
              onPress={() => {
                decide("accepted");
              }}
            >
              {t.allow}
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                decide("rejected");
              }}
            >
              {t.reject}
            </Button>
            {editing && consent !== "unknown" && (
              <Button variant="quiet" onPress={close}>
                {t.close}
              </Button>
            )}
          </div>
        </section>
      )}
      {children}
      <footer className="site-footer wrap">
        <a href={`/privacy/?lang=${locale}`}>{t.notice}</a>
        <Button
          ref={settings}
          variant="quiet"
          onPress={() => {
            setEditing(true);
            requestAnimationFrame(() => {
              region.current?.focus();
              region.current?.scrollIntoView({ block: "center" });
            });
          }}
        >
          {t.settings}
        </Button>
      </footer>
    </>
  );
}
