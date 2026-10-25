import type { ComponentType } from "react";
import { Contact, Faq } from "./information";
import type { Locale, LocalizedText } from "./locales";

// Register complete sections here: navigation and section anchors are rendered together.
// FAQ and contact own their copy and components without changing the shell.
export interface LandingSection {
  id: string;
  title: LocalizedText;
  Content: ComponentType<{ locale: Locale }>;
}
export const landingSections: readonly LandingSection[] = [
  { id: "faq", title: { en: "Frequently asked questions", de: "Häufige Fragen" }, Content: Faq },
  { id: "contact", title: { en: "Contact", de: "Kontakt" }, Content: Contact },
];
