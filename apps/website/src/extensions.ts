import type { ComponentType } from "react";
import type { Locale, LocalizedText } from "./locales";

// Register complete sections here: navigation and section anchors are rendered together.
// Plans, FAQ and contact can own their copy and components without changing the shell.
export interface LandingSection {
  id: string;
  title: LocalizedText;
  Content: ComponentType<{ locale: Locale }>;
}
export const landingSections: readonly LandingSection[] = [];

// Add links only when their destination exists (for example the future blog index).
export interface SiteLink {
  href: string;
  label: LocalizedText;
}
export const siteLinks: readonly SiteLink[] = [];
