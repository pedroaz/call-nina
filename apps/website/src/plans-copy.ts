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
      "Call Nina is in development; public downloads are coming soon. The current desktop app connects to Codex. Direct connections using your own API key and Nina-managed AI access are not available yet.",
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
          "Planned · direct provider connections",
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
      "These product and service plans do not change the current MIT license for the source code. The tier descriptions are not new restrictions on using that source.",
    faq: [
      {
        question: "Can I download Call Nina now?",
        answer:
          "Public installers are coming soon for Linux, macOS and Windows. The source is available on GitHub, but there is no public download here yet and no announced release date.",
      },
      {
        question: "What can the current desktop app do?",
        answer:
          "The development version offers German reading and writing practice, prepared activities and vocabulary review, with learning records stored locally. AI preparation and feedback use a connected Codex setup. The interface is available in English and German.",
      },
      {
        question: "What does BYOK mean, and can I use it today?",
        answer:
          "BYOK means bring your own API key: you pay the AI provider directly for usage. Direct BYOK connections are planned for Free personal and Premium personal. Today’s implemented AI connection is Codex, with eligible provider access; BYOK is not an available alternative in the app yet.",
      },
      {
        question: "What changes with Premium, Teachers or Enterprise?",
        answer:
          "All three are coming soon. Premium personal is planned to add a Nina-managed allowance while retaining personal BYOK and Codex routes. Teachers and Enterprise are planned around Nina-managed access, without BYOK or a personal Codex subscription route. Prices, allowances and detailed service capabilities have not been announced.",
      },
      {
        question: "Does local-first mean AI works offline?",
        answer:
          "No. Learning records are stored on your device, but current AI features send relevant learning content through Codex and need provider access. Optional local desktop models, mobile offline practice and desktop-to-phone transfer are planned work, not available integrations.",
      },
      {
        question: "Do the planned tiers change the source license?",
        answer:
          "No. The current source code remains under the MIT license. Planned product and service tiers do not impose new source-license restrictions.",
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
      "Call Nina ist in Entwicklung; öffentliche Downloads folgen noch. Die aktuelle Desktop-App verbindet sich mit Codex. Direkte Verbindungen mit deinem eigenen API-Schlüssel und von Nina bereitgestellter KI-Zugang sind noch nicht verfügbar.",
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
          "Geplant · direkte Verbindung zum Anbieter",
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
      "Diese Produkt- und Dienstleistungspläne ändern die aktuelle MIT-Lizenz des Quellcodes nicht. Die Angebotsbeschreibungen sind keine neuen Einschränkungen für dessen Nutzung.",
    faq: [
      {
        question: "Kann ich Call Nina schon herunterladen?",
        answer:
          "Öffentliche Installationspakete für Linux, macOS und Windows folgen noch. Der Quellcode ist auf GitHub verfügbar. Einen öffentlichen Download gibt es hier noch nicht; ein Veröffentlichungstermin steht nicht fest.",
      },
      {
        question: "Was kann die aktuelle Desktop-App?",
        answer:
          "Die Entwicklungsversion bietet Lese- und Schreibübungen auf Deutsch, vorbereitete Aufgaben und Wortschatzwiederholungen. Lerndaten werden lokal gespeichert. KI-gestützte Vorbereitung und Feedback nutzen eine eingerichtete Codex-Verbindung. Die Oberfläche gibt es auf Englisch und Deutsch.",
      },
      {
        question: "Was bedeutet BYOK, und kann ich es schon nutzen?",
        answer:
          "BYOK bedeutet, dass du deinen eigenen API-Schlüssel mitbringst und die Nutzung direkt beim KI-Anbieter bezahlst. Direkte BYOK-Verbindungen sind für das kostenlose Angebot und Premium für Privatpersonen geplant. Der aktuell umgesetzte KI-Zugang läuft über Codex und erfordert einen berechtigten Anbieterzugang. BYOK ist in der App noch keine verfügbare Alternative.",
      },
      {
        question: "Was ändert sich mit Premium, dem Angebot für Lehrkräfte oder Enterprise?",
        answer:
          "Alle drei Angebote folgen noch. Premium für Privatpersonen soll ein von Nina bereitgestelltes Kontingent ergänzen und persönliche BYOK- und Codex-Zugänge beibehalten. Für Lehrkräfte und Enterprise ist KI-Zugang über Nina geplant, ohne BYOK oder persönliches Codex-Abonnement. Preise, Kontingente und genaue Leistungsmerkmale stehen noch nicht fest.",
      },
      {
        question: "Bedeutet lokale Speicherung, dass die KI offline funktioniert?",
        answer:
          "Nein. Lerndaten liegen auf deinem Gerät, aber aktuelle KI-Funktionen übermitteln relevante Lerninhalte über Codex und benötigen einen Anbieterzugang. Optionale lokale Desktop-Modelle, mobile Offline-Übungen und die Übertragung vom Desktop aufs Handy sind geplant und noch keine verfügbaren Integrationen.",
      },
      {
        question: "Ändern die geplanten Angebote die Quellcode-Lizenz?",
        answer:
          "Nein. Der aktuelle Quellcode bleibt unter der MIT-Lizenz verfügbar. Die geplanten Produkt- und Dienstleistungsangebote führen keine neuen Einschränkungen der Quellcode-Lizenz ein.",
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
