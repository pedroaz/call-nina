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
  nav: { practice: string; downloads: string };
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
  downloadsTitle: string;
  downloadsText: string;
  platforms: string;
  source: string;
  license: string;
  licenseLink: string;
  footer: string;
};

export const copy: Record<Locale, Copy> = {
  en: {
    title: "Call Nina — languages, one small step at a time",
    description:
      "Meet Call Nina, a local-first language learning companion in development. Explore desktop practice. Public downloads are not available yet.",
    skip: "Skip to content",
    navigation: "Main navigation",
    language: "Website language",
    nav: { practice: "The idea", downloads: "Downloads" },
    prelaunch: "In development · Personal language practice",
    headline: "A little practice. A little more confidence.",
    introduction:
      "Make room for language learning in your everyday life. Call Nina brings reading, writing and vocabulary practice together in a desktop companion, with your learning history kept on your device.",
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
      "Practise US English, Brazilian Portuguese, Spanish or German. Choose learning, interface and explanation languages independently. The structured Learning Path is German-only; public downloads are not available yet.",
    steps: [
      {
        title: "Find something to practise",
        text: "Describe a learning goal to Nina, choose reading or writing practice, or return to prepared activities and vocabulary review.",
      },
      {
        title: "Make it relevant",
        text: "Pick a reading topic or paste a passage. With your selected AI connection, the app can prepare exercises and provide writing feedback.",
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
      "Local-first doesn’t mean all AI runs offline: Cloud AI preparation and feedback send relevant content through your selected ChatGPT or API-key connection. Provider access is required; Nina-managed access is not available.",
    downloadsTitle: "A new learning companion is on the way.",
    downloadsText:
      "We’re still building Call Nina. Public installers aren’t available yet, so there’s nothing to download here today.",
    platforms: "Planned desktop downloads: Linux, macOS and Windows",
    source: "View source on GitHub",
    license:
      "Source available. New original material: free personal study; professional and organizational use requires permission. Prior MIT grants remain intact.",
    licenseLink: "License and attribution",
    footer: "Made for small steps forward.",
  },
  de: {
    title: "Call Nina — Sprachen, einen kleinen Schritt nach dem anderen",
    description:
      "Call Nina ist eine Sprachlernbegleitung in Entwicklung mit lokal gespeicherten Lerndaten. Entdecke die Desktop-Übungen. Öffentliche Downloads sind noch nicht verfügbar.",
    skip: "Zum Inhalt springen",
    navigation: "Hauptnavigation",
    language: "Sprache der Website",
    nav: { practice: "Die Idee", downloads: "Downloads" },
    prelaunch: "In Entwicklung · Persönliches Sprachenlernen",
    headline: "Ein bisschen Übung. Ein bisschen mehr Sicherheit.",
    introduction:
      "Gib dem Sprachenlernen einen Platz in deinem Alltag. Call Nina verbindet Lesen, Schreiben und Wortschatzübungen in einer Desktop-App. Dein Lernverlauf bleibt auf deinem Gerät gespeichert.",
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
      "Übe US-Englisch, brasilianisches Portugiesisch, Spanisch oder Deutsch. Lern-, Oberflächen- und Erklärungssprache sind unabhängig wählbar. Den strukturierten Lernpfad gibt es nur für Deutsch; öffentliche Downloads sind noch nicht verfügbar.",
    steps: [
      {
        title: "Finde eine passende Übung",
        text: "Beschreibe Nina dein Lernziel, wähle Lese- oder Schreibübungen oder nutze vorbereitete Aufgaben und Wortschatzwiederholungen.",
      },
      {
        title: "Übe, was dich interessiert",
        text: "Wähle ein Lesethema oder füge einen Text ein. Mit deiner ausgewählten KI-Verbindung kann die App Übungen vorbereiten und Feedback zu deinen Texten geben.",
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
      "Lokal gespeichert heißt nicht, dass jede KI offline läuft: Cloud-KI für Übungen und Feedback übermittelt relevante Inhalte über deine ausgewählte ChatGPT- oder API-Schlüssel-Verbindung. Ein Anbieterzugang ist erforderlich; KI-Zugang über Nina ist nicht verfügbar.",
    downloadsTitle: "Eine neue Lernbegleitung entsteht.",
    downloadsText:
      "Wir entwickeln Call Nina noch. Öffentliche Installationspakete sind noch nicht verfügbar. Deshalb gibt es hier heute noch keinen Download.",
    platforms: "Geplante Desktop-Downloads: Linux, macOS und Windows",
    source: "Quellcode auf GitHub ansehen",
    license:
      "Quellcode einsehbar. Neues eigenes Material: persönliches Lernen kostenlos; professionelle und organisatorische Nutzung mit Erlaubnis. Bisherige MIT-Rechte bleiben erhalten.",
    licenseLink: "Lizenz und Quellenangaben",
    footer: "Für kleine Schritte nach vorn.",
  },
};
