import { useEffect, useSyncExternalStore } from "react";
import { Analytics, track } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { analyticsAllowed, getConsent, markTelemetryStarted, subscribeConsent } from "./consent";
import type { FeatureId, Locale } from "./locales";
import type { Connection, LearningLanguage, Role, Use } from "./discovery";
import type { Platform } from "./downloads";

declare const __NINA_WEBSITE_ORIGIN__: string;

type WebsiteEvents = {
  discovery_opened: { locale: Locale };
  discovery_step_completed:
    | { step: "role"; answer: Role }
    | { step: "language"; answer: LearningLanguage }
    | { step: "use"; answer: Use }
    | { step: "connection"; answer: Connection };
  discovery_completed: { role: Role; use: Use };
  feature_selected: { feature: FeatureId; source: "tabs" | "discovery" };
  download_clicked: { platform: Platform; version: string };
  contact_clicked: { source: "discovery"; role: Role };
};
function isHostedOrigin() {
  return import.meta.env.PROD && window.location.origin === __NINA_WEBSITE_ORIGIN__;
}
function canSend() {
  return isHostedOrigin() && analyticsAllowed();
}
// Both SDKs retain this callback after mounting. Always inspect live consent rather than
// closing over React state, so withdrawal/expiry blocks their delayed sends too.
function beforeSend<T extends { url: string }>(event: T): T | null {
  if (!canSend()) return null;
  const url = new URL(event.url, window.location.origin);
  url.search = "";
  url.hash = "";
  return { ...event, url: url.href };
}
export function trackWebsiteEvent<K extends keyof WebsiteEvents>(name: K, data: WebsiteEvents[K]) {
  if (!canSend()) return;
  try {
    track(name, data);
  } catch {
    // Telemetry must never interfere with navigation, discovery or a download.
  }
}
export function useWebsiteConsent() {
  return useSyncExternalStore(subscribeConsent, getConsent);
}
export function WebsiteTelemetry() {
  const consent = useWebsiteConsent();
  useEffect(() => {
    if (consent === "accepted" && isHostedOrigin()) markTelemetryStarted();
  }, [consent]);
  if (consent !== "accepted" || !isHostedOrigin()) return null;
  return (
    <>
      <Analytics mode="production" debug={false} beforeSend={beforeSend} />
      <SpeedInsights debug={false} beforeSend={beforeSend} />
    </>
  );
}
