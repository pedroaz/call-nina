export const languages = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
] as const;
export type Locale = (typeof languages)[number]["code"];
export const featureIds = ["exercises", "paths", "writing", "vocabulary"] as const;
export type FeatureId = (typeof featureIds)[number];

type Copy = {
  title: string;
  description: string;
  skip: string;
  language: string;
  headline: string;
  introduction: string;
  free: string;
  mobile: string;
  subscriptions: string;
  download: string;
  github: string;
  featuresTitle: string;
  features: Record<FeatureId, { label: string; text: string }>;
  connections: string;
  providers: string[];
  languagesTitle: string;
  learningLanguages: string[];
  moreLanguages: string;
  yes: string;
  notYet: string;
  local: string;
  costs: string;
  contact: string;
  source: string;
  license: string;
};

export const copy: Record<Locale, Copy> = {
  en: {
    title: "Call Nina — Learn a language with AI",
    description:
      "A desktop app for language practice. Free for personal learning. AI exercises, learning paths, writing feedback and vocabulary practice with Call Nina.",
    skip: "Skip to content",
    language: "Website language",
    headline: "Learn a language with AI.",
    introduction: "A desktop app for language practice.",
    free: "Free for personal learning.",
    mobile: "Mobile app — coming soon",
    subscriptions: "Use your existing AI subscriptions to learn, starting with ChatGPT.",
    download: "Download — coming soon",
    github: "View on GitHub",
    featuresTitle: "Your practice, with Nina.",
    features: {
      exercises: { label: "AI exercises", text: "Generate practice around your topic and level." },
      paths: {
        label: "Learning paths",
        text: "Follow structured lessons toward your learning goals.",
      },
      writing: {
        label: "Writing feedback",
        text: "Get AI feedback and explanations on your writing.",
      },
      vocabulary: { label: "Vocabulary practice", text: "Save words and return to practise them." },
    },
    connections: "Bring your AI.",
    providers: [
      "OpenAI API",
      "Anthropic API",
      "Google Gemini API",
      "Claude Code",
      "Local AI",
      "Nina-funded AI",
    ],
    languagesTitle: "Pick your language.",
    learningLanguages: ["US English", "Brazilian Portuguese", "Spanish", "German"],
    moreLanguages: "More languages",
    yes: "yes",
    notYet: "not yet",
    local: "Your learning records stay on your device.",
    costs: "Cloud AI receives relevant learning content. Provider fees and terms may apply.",
    contact: "Contact",
    source: "Source on GitHub",
    license: "License",
  },
  de: {
    title: "Call Nina — Lerne eine Sprache mit KI",
    description:
      "Eine Desktop-App zum Sprachenlernen. Kostenlos zum persönlichen Lernen. KI-Übungen, Lernpfade, Schreibfeedback und Wortschatztraining mit Call Nina.",
    skip: "Zum Inhalt springen",
    language: "Sprache der Website",
    headline: "Lerne eine Sprache mit KI.",
    introduction: "Eine Desktop-App zum Sprachenlernen.",
    free: "Kostenlos zum persönlichen Lernen.",
    mobile: "Mobile App — bald verfügbar",
    subscriptions: "Nutze deine bestehenden KI-Abos zum Lernen. Den Anfang macht ChatGPT.",
    download: "Download — bald verfügbar",
    github: "Auf GitHub ansehen",
    featuresTitle: "Deine Übungen, mit Nina.",
    features: {
      exercises: {
        label: "KI-Übungen",
        text: "Erstelle Übungen passend zu deinem Thema und Niveau.",
      },
      paths: {
        label: "Lernpfade",
        text: "Folge strukturierten Lektionen auf dem Weg zu deinen Lernzielen.",
      },
      writing: {
        label: "Schreibfeedback",
        text: "Erhalte KI-Feedback und Erklärungen zu deinen Texten.",
      },
      vocabulary: {
        label: "Wortschatztraining",
        text: "Speichere Wörter und wiederhole sie später.",
      },
    },
    connections: "Bring deine KI mit.",
    providers: [
      "OpenAI API",
      "Anthropic API",
      "Google Gemini API",
      "Claude Code",
      "Lokale KI",
      "Nina-finanzierte KI",
    ],
    languagesTitle: "Wähle deine Sprache.",
    learningLanguages: ["US-Englisch", "Brasilianisches Portugiesisch", "Spanisch", "Deutsch"],
    moreLanguages: "Weitere Sprachen",
    yes: "ja",
    notYet: "noch nicht",
    local: "Deine Lerndaten bleiben auf deinem Gerät.",
    costs:
      "Cloud-KI erhält relevante Lerninhalte. Gebühren und Bedingungen der Anbieter können gelten.",
    contact: "Kontakt",
    source: "Quellcode auf GitHub",
    license: "Lizenz",
  },
};
