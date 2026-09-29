export const languages = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
] as const;
export type Locale = (typeof languages)[number]["code"];
export type LocalizedText = Record<Locale, string>;

type Copy = {
  title: string;
  description: string;
  skip: string;
  navigation: string;
  language: string;
  nav: { practice: string; future: string; downloads: string };
  prelaunch: string;
  headline: string;
  introduction: string;
  explore: string;
  downloadStatus: string;
  previewLabel: string;
  previewTitle: string;
  previewText: string;
  previewTranslation: string;
  previewNote: string;
  practiceLabel: string;
  practiceTitle: string;
  practiceIntro: string;
  steps: { title: string; text: string }[];
  localTitle: string;
  localText: string;
  aiText: string;
  futureLabel: string;
  futureTitle: string;
  futureIntro: string;
  futureItems: { title: string; text: string }[];
  downloadsTitle: string;
  downloadsText: string;
  platforms: string;
  source: string;
  license: string;
  footer: string;
};

export const copy: Record<Locale, Copy> = {
  en: {
    title: "Call Nina — German, one small step at a time",
    description:
      "Meet Call Nina, a local-first German learning companion in development. Explore desktop practice and what’s planned. Downloads coming soon.",
    skip: "Skip to content",
    navigation: "Main navigation",
    language: "Website language",
    nav: { practice: "The idea", future: "What’s next", downloads: "Downloads" },
    prelaunch: "In development · German first",
    headline: "A little German. A little more confidence.",
    introduction:
      "Make room for German in your everyday life. Call Nina brings reading, writing and vocabulary practice together in a desktop companion, with your learning history kept on your device.",
    explore: "Explore the idea",
    downloadStatus: "Coming soon",
    previewLabel: "A little German for today",
    previewTitle: "Small words. Everyday moments.",
    previewText: "Einen Kaffee, bitte.",
    previewTranslation: "A coffee, please.",
    previewNote: "An example of everyday German — not a live exercise or an app screenshot.",
    practiceLabel: "Inside the current desktop app",
    practiceTitle: "Your next step can be a small one.",
    practiceIntro:
      "The development version focuses on German practice. Its interface is available in English and German; public downloads are still coming soon.",
    steps: [
      {
        title: "Find something to practise",
        text: "Choose reading or writing practice, work through prepared activities, or return to vocabulary that’s due for review.",
      },
      {
        title: "Make it relevant",
        text: "Pick a reading topic or paste a passage. With a connected Codex setup, the app can prepare exercises and provide writing feedback.",
      },
      {
        title: "Build on what you’ve done",
        text: "Keep attempts and vocabulary locally. Practice suggestions draw on review needs and recorded difficulties to help you choose what to do next.",
      },
    ],
    localTitle: "Your learning has a home. On your device.",
    localText:
      "The desktop app stores learning records locally. You can come back to your history and vocabulary without a cloud learning library.",
    aiText:
      "Local-first doesn’t mean all AI runs offline: AI preparation and feedback currently use a connected Codex setup. Relevant learning content is sent through that connection, and provider access is required.",
    futureLabel: "The direction · not available yet",
    futureTitle: "More ways to make German part of your day.",
    futureIntro:
      "These are plans, not features you can use today. There’s no announced release date.",
    futureItems: [
      {
        title: "Start with a conversation",
        text: "A planned Nina home screen will turn a typed goal into a suggested activity. Nina will be an AI guide; voice is a later step.",
      },
      {
        title: "Take practice with you",
        text: "Android and iOS companions are planned for practising prepared material offline, with desktop-to-phone transfer still to come.",
      },
      {
        title: "Choose more ways to connect",
        text: "Additional AI providers, optional desktop local models and a Nina-managed service are future work. Today’s AI route is Codex.",
      },
    ],
    downloadsTitle: "A new learning companion is on the way.",
    downloadsText:
      "We’re still building Call Nina. Public installers aren’t available yet, so there’s nothing to download here today.",
    platforms: "Planned desktop downloads: Linux, macOS and Windows",
    source: "View source on GitHub",
    license: "Source code is available under the MIT license.",
    footer: "Made for small steps forward.",
  },
  de: {
    title: "Call Nina — Deutsch, einen kleinen Schritt nach dem anderen",
    description:
      "Call Nina ist eine Deutsch-Lernbegleitung in Entwicklung, mit lokal gespeicherten Lerndaten. Entdecke die Desktop-Übungen und unsere Pläne. Downloads folgen.",
    skip: "Zum Inhalt springen",
    navigation: "Hauptnavigation",
    language: "Sprache der Website",
    nav: { practice: "Die Idee", future: "Was kommt", downloads: "Downloads" },
    prelaunch: "In Entwicklung · Deutsch zuerst",
    headline: "Ein bisschen Deutsch. Ein bisschen mehr Sicherheit.",
    introduction:
      "Gib Deutsch einen Platz in deinem Alltag. Call Nina verbindet Lesen, Schreiben und Wortschatzübungen in einer Desktop-App. Dein Lernverlauf bleibt auf deinem Gerät gespeichert.",
    explore: "Die Idee entdecken",
    downloadStatus: "Demnächst verfügbar",
    previewLabel: "Ein bisschen Deutsch für heute",
    previewTitle: "Kleine Worte. Alltägliche Momente.",
    previewText: "Einen Kaffee, bitte.",
    previewTranslation: "So bestellst du einen Kaffee.",
    previewNote:
      "Ein Beispiel für Alltagsdeutsch — keine interaktive Übung und kein App-Screenshot.",
    practiceLabel: "In der aktuellen Desktop-App",
    practiceTitle: "Dein nächster Schritt darf klein sein.",
    practiceIntro:
      "Die Entwicklungsversion konzentriert sich auf Deutschübungen. Die Oberfläche gibt es auf Englisch und Deutsch. Öffentliche Downloads folgen noch.",
    steps: [
      {
        title: "Finde eine passende Übung",
        text: "Wähle Lese- oder Schreibübungen, bearbeite vorbereitete Aufgaben oder wiederhole fällige Vokabeln.",
      },
      {
        title: "Übe, was dich interessiert",
        text: "Wähle ein Lesethema oder füge einen Text ein. Mit einer eingerichteten Codex-Verbindung kann die App Übungen vorbereiten und Feedback zu deinen Texten geben.",
      },
      {
        title: "Baue auf deinem Lernen auf",
        text: "Deine Versuche und Vokabeln werden lokal gespeichert. Übungsvorschläge berücksichtigen fällige Wiederholungen und erfasste Schwierigkeiten und helfen dir bei der nächsten Auswahl.",
      },
    ],
    localTitle: "Dein Lernen hat ein Zuhause. Auf deinem Gerät.",
    localText:
      "Die Desktop-App speichert Lerndaten lokal. Du kannst auf deinen Verlauf und Wortschatz zurückgreifen, ohne eine Lernbibliothek in der Cloud zu benötigen.",
    aiText:
      "Lokal gespeichert heißt nicht, dass jede KI offline läuft: KI-gestützte Vorbereitung und Feedback nutzen derzeit eine eingerichtete Codex-Verbindung. Relevante Lerninhalte werden darüber übermittelt; ein Zugang zum Anbieter ist erforderlich.",
    futureLabel: "Unsere Richtung · noch nicht verfügbar",
    futureTitle: "Mehr Platz für Deutsch in deinem Alltag.",
    futureIntro:
      "Das sind Pläne, keine heute verfügbaren Funktionen. Ein Veröffentlichungstermin steht noch nicht fest.",
    futureItems: [
      {
        title: "Mit einem Gespräch beginnen",
        text: "Auf einer geplanten Nina-Startseite soll aus deinem eingetippten Lernziel ein Übungsvorschlag werden. Nina wird eine KI-Lernbegleitung sein; Spracheingabe und Sprachausgabe folgen später.",
      },
      {
        title: "Übungen mitnehmen",
        text: "Apps für Android und iOS sind geplant, um vorbereitete Inhalte offline zu üben. Auch die Übertragung vom Desktop aufs Handy ist noch Zukunftsmusik.",
      },
      {
        title: "Mehr Möglichkeiten für KI",
        text: "Weitere KI-Anbieter, optionale lokale Desktop-Modelle und ein von Nina betriebener Dienst sind geplant. Der aktuelle KI-Zugang läuft über Codex.",
      },
    ],
    downloadsTitle: "Eine neue Lernbegleitung entsteht.",
    downloadsText:
      "Wir entwickeln Call Nina noch. Öffentliche Installationspakete sind noch nicht verfügbar. Deshalb gibt es hier heute noch keinen Download.",
    platforms: "Geplante Desktop-Downloads: Linux, macOS und Windows",
    source: "Quellcode auf GitHub ansehen",
    license: "Der Quellcode ist unter der MIT-Lizenz verfügbar.",
    footer: "Für kleine Schritte nach vorn.",
  },
};
