import type { ComponentType } from "react";
import { Contact, Faq, Plans } from "./plans";
import type { Locale, LocalizedText } from "./locales";

// Register complete sections here: navigation and section anchors are rendered together.
// Plans, FAQ and contact can own their copy and components without changing the shell.
export interface LandingSection {
  id: string;
  title: LocalizedText;
  Content: ComponentType<{ locale: Locale }>;
}
export const landingSections: readonly LandingSection[] = [
  { id: "plans", title: { en: "Plans", de: "Angebote" }, Content: Plans },
  { id: "faq", title: { en: "Frequently asked questions", de: "Häufige Fragen" }, Content: Faq },
  { id: "contact", title: { en: "Contact", de: "Kontakt" }, Content: Contact },
];

// Add links only when their destination exists (for example the future blog index).
export interface SiteLink {
  href: string;
  label: LocalizedText;
}
export const siteLinks: readonly SiteLink[] = [];
