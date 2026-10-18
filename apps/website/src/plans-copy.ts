import type { Locale } from "./locales";

type PlanCopy = {
  introduction: string;
  current: string;
  caption: string;
  scrollHint: string;
  feature: string;
  tiers: [string, string, string, string];
  rows: { label: string; values: [string, string, string, string] }[];
  funding: string;
  license: string;
  faq: { question: string; answer: string }[];
  contact: { introduction: string; action: string; hint: string };
};

export const planCopy: Record<Locale, PlanCopy> = {
  en: {
    introduction:
      "Personal practice today, more ways to learn together in the future. Here’s how the planned tiers differ.",
    current:
      "Call Nina is in development; public downloads are coming soon. The development app includes Codex and direct API-key connections. Provider and platform verification is ongoing; Nina-managed access is not available yet.",
    caption: "Plan comparison — current development capabilities and planned access",
    scrollHint: "On small screens, scroll the table sideways to compare all four plans.",
    feature: "Capability or access",
    tiers: ["Free personal", "Premium personal", "Teachers", "Enterprise"],
    rows: [
      {
        label: "Availability and Nina fee",
        values: [
          "No Nina fee · public downloads coming soon",
          "Coming soon · price not announced",
          "Coming soon · price not announced",
          "Coming soon · price not announced",
        ],
      },
      {
        label: "Your own API key (BYOK)",
        values: [
          "Development build · provider access required",
          "Planned · retained alongside managed access",
          "Not part of this planned tier",
          "Not part of this planned tier",
        ],
      },
      {
        label: "Your eligible Codex subscription",
        values: [
          "Current desktop connection · eligible provider access required",
          "Planned · personal Codex route retained",
          "Not part of this planned tier",
          "Not part of this planned tier",
        ],
      },
      {
        label: "Nina-managed AI access",
        values: [
          "Not available today · starter access is roadmap work",
          "Planned allowance · amount not announced",
          "Planned managed access · details to come",
          "Planned managed access · details to come",
        ],
      },
      {
        label: "Learning workflow",
        values: [
          "Current desktop · personal practice and local learning records",
          "Planned · personal practice with managed generation",
          "Planned · review and assign material, view authorized learner progress",
          "Planned · organization workspaces, roles and centrally funded usage",
        ],
      },
    ],
    funding:
      "No Nina fee does not mean free AI usage. With personal BYOK or Codex access, provider charges, subscription requirements and usage limits remain separate and are your responsibility. No managed allowance or unlimited use is available or promised here.",
    license:
      "New original material is covered by the Call Nina Personal Learning Source License 1.0: independent personal study is free; professional teaching and institutional or other organizational use require separate permission. Previously MIT-licensed material keeps its MIT permissions, including commercial use. Product plans do not replace these terms.",
    faq: [
      {
        question: "Can I download Call Nina now?",
        answer:
          "Public installers are coming soon for Linux, macOS and Windows. The source is available on GitHub, but there is no public download here yet and no announced release date.",
      },
      {
        question: "What can the current desktop app do?",
        answer:
          "The development version offers German reading and writing practice, prepared activities and vocabulary review, with learning records stored locally. AI preparation and feedback use a connected Codex setup. The interface is available in English, German, Spanish and Brazilian Portuguese.",
      },
      {
        question: "What does BYOK mean, and can I use it today?",
        answer:
          "BYOK means bring your own API key: you pay the AI provider directly for usage. The development app includes connections for OpenAI, Anthropic and Google API keys, alongside Codex subscription access. Availability depends on the provider account and selected model. These routes are still being verified before a public release.",
      },
      {
        question: "What changes with Premium, Teachers or Enterprise?",
        answer:
          "All three are coming soon. Premium personal is planned to add a Nina-managed allowance while retaining personal BYOK and Codex routes. Teachers and Enterprise are planned around Nina-managed access, without BYOK or a personal Codex subscription route. Prices, allowances and detailed service capabilities have not been announced.",
      },
      {
        question: "Does local-first mean AI works offline?",
        answer:
          "No. Learning records and prepared practice stay on your device. Cloud AI sends relevant content to the provider you select. Downloaded-model settings are included in the development app, with device support still being verified. Mobile offline practice and desktop-to-phone transfer remain planned.",
      },
      {
        question: "Which license applies, and who can use Call Nina for free?",
        answer:
          "Pedro Azevedo Minutetnag offers new original material under the Call Nina Personal Learning Source License 1.0. Independent personal self-study is free, including personal modifications and free sharing under its conditions. Professional teaching, schools and other organizations need separate written permission for that material, even without a fee. Previously MIT-licensed code and content remain under MIT; third-party rights also remain intact. The full terms are linked in the footer.",
      },
    ],
    contact: {
      introduction:
        "Have a question about Call Nina, or feedback on the idea? Get in touch by email.",
      action: "Email Pedro",
      hint: "Opens your email app. You can also copy the address below into your preferred email service.",
    },
  },
  de: {
    introduction:
      "Heute persönlich üben, künftig auch gemeinsam lernen. So unterscheiden sich die geplanten Angebote.",
    current:
      "Call Nina ist in Entwicklung; öffentliche Downloads folgen noch. Die Entwicklungsversion enthält Codex und direkte API-Schlüssel-Verbindungen. Anbieter- und Plattformprüfungen laufen noch; KI-Zugang über Nina ist noch nicht verfügbar.",
    caption: "Angebote im Vergleich — aktueller Entwicklungsstand und geplanter Zugang",
    scrollHint:
      "Auf kleinen Bildschirmen kannst du die Tabelle seitlich scrollen, um alle vier Angebote zu vergleichen.",
    feature: "Funktion oder Zugang",
    tiers: [
      "Kostenlos für Privatpersonen",
      "Premium für Privatpersonen",
      "Für Lehrkräfte",
      "Enterprise",
    ],
    rows: [
      {
        label: "Verfügbarkeit und Nina-Gebühr",
        values: [
          "Keine Nina-Gebühr · öffentliche Downloads folgen",
          "Demnächst verfügbar · Preis noch offen",
          "Demnächst verfügbar · Preis noch offen",
          "Demnächst verfügbar · Preis noch offen",
        ],
      },
      {
        label: "Eigener API-Schlüssel (BYOK)",
        values: [
          "Entwicklungsversion · Anbieterzugang erforderlich",
          "Geplant · zusätzlich zum Zugang über Nina",
          "Nicht Teil dieses geplanten Angebots",
          "Nicht Teil dieses geplanten Angebots",
        ],
      },
      {
        label: "Eigenes berechtigtes Codex-Abonnement",
        values: [
          "Aktuelle Desktop-Verbindung · berechtigter Anbieterzugang erforderlich",
          "Geplant · persönlicher Codex-Zugang bleibt erhalten",
          "Nicht Teil dieses geplanten Angebots",
          "Nicht Teil dieses geplanten Angebots",
        ],
      },
      {
        label: "Von Nina bereitgestellter KI-Zugang",
        values: [
          "Heute nicht verfügbar · Einstiegszugang ist geplant",
          "Geplantes Kontingent · Umfang noch offen",
          "Zugang über Nina geplant · Details folgen",
          "Zugang über Nina geplant · Details folgen",
        ],
      },
      {
        label: "Lernablauf",
        values: [
          "Aktuelle Desktop-App · persönlich üben und Lerndaten lokal speichern",
          "Geplant · persönlich üben mit KI-Erstellung über Nina",
          "Geplant · Material prüfen und zuweisen, freigegebenen Lernfortschritt einsehen",
          "Geplant · Organisationsbereiche, Rollen und zentral finanzierte Nutzung",
        ],
      },
    ],
    funding:
      "Keine Nina-Gebühr bedeutet nicht kostenlose KI-Nutzung. Bei persönlichem BYOK- oder Codex-Zugang bleiben Anbieterkosten, Abonnementanforderungen und Nutzungslimits separat und liegen in deiner Verantwortung. Hier wird weder ein verfügbares Nina-Kontingent noch unbegrenzte Nutzung zugesagt.",
    license:
      "Für neues eigenes Material gilt die Call Nina Personal Learning Source License 1.0: Eigenständiges persönliches Lernen ist kostenlos; professioneller Unterricht sowie institutionelle oder sonstige organisatorische Nutzung erfordern eine gesonderte Erlaubnis. Bereits unter MIT veröffentlichtes Material behält seine MIT-Rechte, auch für kommerzielle Nutzung. Die Produktangebote ersetzen diese Bedingungen nicht.",
    faq: [
      {
        question: "Kann ich Call Nina schon herunterladen?",
        answer:
          "Öffentliche Installationspakete für Linux, macOS und Windows folgen noch. Der Quellcode ist auf GitHub verfügbar. Einen öffentlichen Download gibt es hier noch nicht; ein Veröffentlichungstermin steht nicht fest.",
      },
      {
        question: "Was kann die aktuelle Desktop-App?",
        answer:
          "Die Entwicklungsversion bietet Lese- und Schreibübungen auf Deutsch, vorbereitete Aufgaben und Wortschatzwiederholungen. Lerndaten werden lokal gespeichert. KI-gestützte Vorbereitung und Feedback nutzen eine eingerichtete Codex-Verbindung. Die Oberfläche gibt es auf Englisch, Deutsch, Spanisch und brasilianischem Portugiesisch.",
      },
      {
        question: "Was bedeutet BYOK, und kann ich es schon nutzen?",
        answer:
          "BYOK bedeutet, dass du deinen eigenen API-Schlüssel mitbringst und die Nutzung direkt beim KI-Anbieter bezahlst. Die Entwicklungsversion enthält Verbindungen für API-Schlüssel von OpenAI, Anthropic und Google sowie Codex-Abonnementzugang. Die Verfügbarkeit hängt vom Anbieterkonto und gewählten Modell ab. Diese Verbindungen werden vor einer öffentlichen Veröffentlichung noch geprüft.",
      },
      {
        question: "Was ändert sich mit Premium, dem Angebot für Lehrkräfte oder Enterprise?",
        answer:
          "Alle drei Angebote folgen noch. Premium für Privatpersonen soll ein von Nina bereitgestelltes Kontingent ergänzen und persönliche BYOK- und Codex-Zugänge beibehalten. Für Lehrkräfte und Enterprise ist KI-Zugang über Nina geplant, ohne BYOK oder persönliches Codex-Abonnement. Preise, Kontingente und genaue Leistungsmerkmale stehen noch nicht fest.",
      },
      {
        question: "Bedeutet lokale Speicherung, dass die KI offline funktioniert?",
        answer:
          "Nein. Lerndaten und vorbereitete Übungen bleiben auf deinem Gerät. Cloud-KI übermittelt relevante Inhalte an den gewählten Anbieter. Einstellungen für heruntergeladene Modelle sind in der Entwicklungsversion enthalten; die Geräteunterstützung wird noch geprüft. Mobile Offline-Übungen und die Übertragung aufs Handy bleiben geplant.",
      },
      {
        question: "Welche Lizenz gilt, und wer kann Call Nina kostenlos nutzen?",
        answer:
          "Pedro Azevedo Minutetnag bietet neues eigenes Material unter der Call Nina Personal Learning Source License 1.0 an. Eigenständiges persönliches Lernen ist kostenlos, einschließlich persönlicher Anpassungen und kostenloser Weitergabe nach den Lizenzbedingungen. Professioneller Unterricht, Schulen und andere Organisationen brauchen für dieses Material eine gesonderte schriftliche Erlaubnis, auch ohne Gebühren. Bereits unter MIT veröffentlichter Code und Inhalt bleiben unter MIT; Rechte Dritter bleiben ebenfalls erhalten. Die vollständigen Bedingungen sind in der Fußzeile verlinkt.",
      },
    ],
    contact: {
      introduction:
        "Du hast eine Frage zu Call Nina oder Feedback zur Idee? Schreib uns eine E-Mail.",
      action: "Pedro eine E-Mail schreiben",
      hint: "Öffnet deine E-Mail-App. Du kannst die Adresse unten auch kopieren und in deinem bevorzugten E-Mail-Dienst verwenden.",
    },
  },
};
