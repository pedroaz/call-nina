export const languages = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "pt-BR", label: "Português" },
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
  providers: { label: string; status?: string }[];
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
      "A desktop app for language practice. Open source under the MIT License. AI exercises, learning paths, writing feedback and vocabulary practice with Call Nina.",
    skip: "Skip to content",
    language: "Website language",
    headline: "Learn a language with AI.",
    introduction: "A desktop app for language practice.",
    free: "Open source under the MIT License.",
    mobile: "Mobile app — coming soon",
    subscriptions: "Connect ChatGPT or use your own API keys.",
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
      { label: "OpenAI API" },
      { label: "Anthropic API" },
      { label: "Google Gemini API" },
      { label: "Local AI (Linux x64)", status: "limited" },
      { label: "Nina AI", status: "account required" },
    ],
    languagesTitle: "Pick your language.",
    learningLanguages: ["US English", "Brazilian Portuguese", "Spanish", "German"],
    moreLanguages: "More languages",
    yes: "yes",
    notYet: "not yet",
    local:
      "Learning records are stored locally. Flashcards you choose to publish sync through your Nina account.",
    costs: "Cloud AI receives relevant learning content. Provider fees and terms may apply.",
    contact: "Contact",
    source: "Source on GitHub",
    license: "License",
  },
  de: {
    title: "Call Nina — Lerne eine Sprache mit KI",
    description:
      "Eine Desktop-App zum Sprachenlernen. Open Source unter der MIT-Lizenz. KI-Übungen, Lernpfade, Schreibfeedback und Wortschatztraining mit Call Nina.",
    skip: "Zum Inhalt springen",
    language: "Sprache der Website",
    headline: "Lerne eine Sprache mit KI.",
    introduction: "Eine Desktop-App zum Sprachenlernen.",
    free: "Open Source unter der MIT-Lizenz.",
    mobile: "Mobile App — bald verfügbar",
    subscriptions: "Verbinde ChatGPT oder nutze deine eigenen API-Schlüssel.",
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
      { label: "OpenAI API" },
      { label: "Anthropic API" },
      { label: "Google Gemini API" },
      { label: "Lokale KI (Linux x64)", status: "eingeschränkt" },
      { label: "Nina-KI", status: "Konto erforderlich" },
    ],
    languagesTitle: "Wähle deine Sprache.",
    learningLanguages: ["US-Englisch", "Brasilianisches Portugiesisch", "Spanisch", "Deutsch"],
    moreLanguages: "Weitere Sprachen",
    yes: "ja",
    notYet: "noch nicht",
    local:
      "Lerndaten werden lokal gespeichert. Von dir veröffentlichte Lernkarten werden über dein Nina-Konto synchronisiert.",
    costs:
      "Cloud-KI erhält relevante Lerninhalte. Gebühren und Bedingungen der Anbieter können gelten.",
    contact: "Kontakt",
    source: "Quellcode auf GitHub",
    license: "Lizenz",
  },
  es: {
    title: "Call Nina — Aprende un idioma con IA",
    description:
      "Una aplicación de escritorio para practicar idiomas. Código abierto bajo la licencia MIT. Ejercicios con IA, rutas de aprendizaje, comentarios sobre textos y práctica de vocabulario con Call Nina.",
    skip: "Saltar al contenido",
    language: "Idioma del sitio",
    headline: "Aprende un idioma con IA.",
    introduction: "Una aplicación de escritorio para practicar idiomas.",
    free: "Código abierto bajo la licencia MIT.",
    mobile: "Aplicación móvil — próximamente",
    subscriptions: "Conecta ChatGPT o usa tus propias claves de API.",
    download: "Descargar — próximamente",
    github: "Ver en GitHub",
    featuresTitle: "Tu práctica, con Nina.",
    features: {
      exercises: { label: "Ejercicios con IA", text: "Genera ejercicios según tu tema y nivel." },
      paths: {
        label: "Rutas de aprendizaje",
        text: "Sigue lecciones estructuradas para alcanzar tus objetivos.",
      },
      writing: {
        label: "Comentarios sobre tus textos",
        text: "Recibe correcciones y explicaciones de la IA sobre lo que escribes.",
      },
      vocabulary: {
        label: "Práctica de vocabulario",
        text: "Guarda palabras y vuelve a practicarlas.",
      },
    },
    connections: "Trae tu IA.",
    providers: [
      { label: "API de OpenAI" },
      { label: "API de Anthropic" },
      { label: "API de Google Gemini" },
      { label: "IA local (Linux x64)", status: "limitada" },
      { label: "IA de Nina", status: "requiere cuenta" },
    ],
    languagesTitle: "Elige tu idioma.",
    learningLanguages: ["Inglés de Estados Unidos", "Portugués de Brasil", "Español", "Alemán"],
    moreLanguages: "Más idiomas",
    yes: "sí",
    notYet: "todavía no",
    local:
      "Los registros se guardan localmente. Las tarjetas que decidas publicar se sincronizan a través de tu cuenta de Nina.",
    costs:
      "La IA en la nube recibe el contenido de aprendizaje relevante. Pueden aplicarse tarifas y condiciones del proveedor.",
    contact: "Contacto",
    source: "Código en GitHub",
    license: "Licencia",
  },
  "pt-BR": {
    title: "Call Nina — Aprenda um idioma com IA",
    description:
      "Um aplicativo de desktop para praticar idiomas. Código aberto sob a licença MIT. Exercícios com IA, trilhas de aprendizagem, feedback de escrita e prática de vocabulário com Call Nina.",
    skip: "Pular para o conteúdo",
    language: "Idioma do site",
    headline: "Aprenda um idioma com IA.",
    introduction: "Um aplicativo de desktop para praticar idiomas.",
    free: "Código aberto sob a licença MIT.",
    mobile: "Aplicativo móvel — em breve",
    subscriptions: "Conecte o ChatGPT ou use suas próprias chaves de API.",
    download: "Baixar — em breve",
    github: "Ver no GitHub",
    featuresTitle: "Sua prática, com a Nina.",
    features: {
      exercises: {
        label: "Exercícios com IA",
        text: "Gere exercícios de acordo com seu tema e nível.",
      },
      paths: {
        label: "Trilhas de aprendizagem",
        text: "Siga lições estruturadas para alcançar seus objetivos.",
      },
      writing: {
        label: "Feedback de escrita",
        text: "Receba feedback e explicações da IA sobre seus textos.",
      },
      vocabulary: {
        label: "Prática de vocabulário",
        text: "Salve palavras e volte para praticá-las.",
      },
    },
    connections: "Traga sua IA.",
    providers: [
      { label: "API da OpenAI" },
      { label: "API da Anthropic" },
      { label: "API do Google Gemini" },
      { label: "IA local (Linux x64)", status: "limitada" },
      { label: "IA da Nina", status: "requer conta" },
    ],
    languagesTitle: "Escolha seu idioma.",
    learningLanguages: ["Inglês dos Estados Unidos", "Português do Brasil", "Espanhol", "Alemão"],
    moreLanguages: "Mais idiomas",
    yes: "sim",
    notYet: "ainda não",
    local:
      "Os registros ficam salvos localmente. Os cartões que você publicar são sincronizados pela sua conta da Nina.",
    costs:
      "A IA na nuvem recebe o conteúdo de aprendizagem relevante. Taxas e termos do provedor podem se aplicar.",
    contact: "Contato",
    source: "Código no GitHub",
    license: "Licença",
  },
};
