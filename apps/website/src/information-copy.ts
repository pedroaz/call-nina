import type { Locale } from "./locales";

type InformationCopy = {
  faq: { question: string; answer: string }[];
  contact: { introduction: string; action: string; hint: string };
};

export const informationCopy: Record<Locale, InformationCopy> = {
  en: {
    faq: [
      {
        question: "Can I download Call Nina now?",
        answer:
          "Public installers are coming soon for Linux, macOS and Windows. The source is available on GitHub, but there is no public download here yet and no announced release date.",
      },
      {
        question: "What can the current desktop app do?",
        answer:
          "The development version supports US English, Brazilian Portuguese, Spanish and German practice, with learning records stored locally. Learning, interface and explanation languages are independent. The structured Learning Path is German-only. AI preparation and feedback use your selected connection.",
      },
      {
        question: "What does BYOK mean, and can I use it today?",
        answer:
          "BYOK means bring your own API key: you pay the AI provider directly for usage. The development app includes connections for OpenAI, Anthropic and Google API keys, alongside direct ChatGPT sign-in. Availability depends on the provider account and selected model. These routes are still being verified before a public release.",
      },
      {
        question: "Does local-first mean AI works offline?",
        answer:
          "No. Learning records and prepared practice stay on your device. Cloud AI sends relevant content to the provider you select. Downloaded-model settings are included in the development app, with device support still being verified. Mobile learning and desktop-to-phone transfer are not available.",
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
    faq: [
      {
        question: "Kann ich Call Nina schon herunterladen?",
        answer:
          "Öffentliche Installationspakete für Linux, macOS und Windows folgen noch. Der Quellcode ist auf GitHub verfügbar. Einen öffentlichen Download gibt es hier noch nicht; ein Veröffentlichungstermin steht nicht fest.",
      },
      {
        question: "Was kann die aktuelle Desktop-App?",
        answer:
          "Die Entwicklungsversion unterstützt Übungen in US-Englisch, brasilianischem Portugiesisch, Spanisch und Deutsch mit lokal gespeicherten Lerndaten. Lern-, Oberflächen- und Erklärungssprache sind unabhängig wählbar. Den strukturierten Lernpfad gibt es nur für Deutsch. KI-Übungen und Feedback nutzen deine ausgewählte Verbindung.",
      },
      {
        question: "Was bedeutet BYOK, und kann ich es schon nutzen?",
        answer:
          "BYOK bedeutet, dass du deinen eigenen API-Schlüssel mitbringst und die Nutzung direkt beim KI-Anbieter bezahlst. Die Entwicklungsversion enthält Verbindungen für API-Schlüssel von OpenAI, Anthropic und Google sowie direkte ChatGPT-Anmeldung. Die Verfügbarkeit hängt vom Anbieterkonto und gewählten Modell ab. Diese Verbindungen werden vor einer öffentlichen Veröffentlichung noch geprüft.",
      },
      {
        question: "Bedeutet lokale Speicherung, dass die KI offline funktioniert?",
        answer:
          "Nein. Lerndaten und vorbereitete Übungen bleiben auf deinem Gerät. Cloud-KI übermittelt relevante Inhalte an den gewählten Anbieter. Einstellungen für heruntergeladene Modelle sind in der Entwicklungsversion enthalten; die Geräteunterstützung wird noch geprüft. Mobiles Lernen und die Übertragung aufs Handy sind nicht verfügbar.",
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
