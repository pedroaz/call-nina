export const languages = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "pt-BR", label: "Português" },
] as const;
export type Locale = (typeof languages)[number]["code"];
export const featureIds = [
  "paths",
  "exercises",
  "writing",
  "stories",
  "vocabulary",
  "flashcards",
] as const;
export type FeatureId = (typeof featureIds)[number];

type Copy = {
  about: string;
  aboutPlaceholder: string;
  cta: string;
  title: string;
  description: string;
  skip: string;
  language: string;
  headline: string;
  mission: string;
  mobile: string;
  subscriptions: string;
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
  source: string;
};

export const copy: Record<Locale, Copy> = {
  en: {
    about: "About us",
    aboutPlaceholder: "More about Call Nina soon.",
    cta: "Click here and find out what Nina can do for you",

    title: "Call Nina — A place to learn languages",
    description:
      "A desktop app for language practice. Open source under the MIT License. AI exercises, learning paths, writing feedback and vocabulary practice with Call Nina.",
    skip: "Skip to content",
    language: "Website language",
    headline: "Want help learning a language? Call Nina!",
    mission:
      "I got tired of paying for language-learning apps. So I started building Call Nina to bring every feature together and make everything I could free for everyone.",
    mobile: "Mobile app — coming soon",
    subscriptions: "Connect ChatGPT or use your own API keys.",
    github: "View on GitHub",
    featuresTitle: "Your practice, with Nina.",
    features: {
      stories: { label: "Stories", text: "Read short stories and save useful words as you go." },
      flashcards: { label: "Flashcards", text: "Review saved vocabulary with flashcards." },
      exercises: { label: "Exercises", text: "Generate practice around your topic and level." },
      paths: {
        label: "Learning paths",
        text: "Follow structured lessons toward your learning goals.",
      },
      writing: {
        label: "Writing",
        text: "Get AI feedback and explanations on your writing.",
      },
      vocabulary: { label: "Vocabulary", text: "Save words and return to practise them." },
    },
    connections: "Bring your AI.",
    providers: [
      { label: "OpenAI API" },
      { label: "Anthropic API" },
      { label: "Google Gemini API" },
      { label: "Local AI (Linux x64)", status: "limited" },
      { label: "Nina AI", status: "Nina Plus required" },
    ],
    languagesTitle: "Pick your language.",
    learningLanguages: ["US English", "Brazilian Portuguese", "Spanish", "German"],
    moreLanguages: "More languages",
    yes: "yes",
    notYet: "not yet",
    local:
      "Learning records are stored locally. Flashcards you choose to publish sync through your Nina account.",
    source: "Source on GitHub",
  },
  de: {
    about: "Über uns",
    aboutPlaceholder: "Bald mehr über Call Nina.",
    cta: "Klicke hier und entdecke, was Nina für dich tun kann",

    title: "Call Nina — Ein Ort zum Sprachenlernen",
    description:
      "Eine Desktop-App zum Sprachenlernen. Open Source unter der MIT-Lizenz. KI-Übungen, Lernpfade, Schreibfeedback und Wortschatztraining mit Call Nina.",
    skip: "Zum Inhalt springen",
    language: "Sprache der Website",
    headline: "Brauchst du Hilfe beim Sprachenlernen? Call Nina!",
    mission:
      "Ich hatte es satt, für Sprachlern-Apps zu bezahlen. Also habe ich angefangen, Call Nina zu entwickeln, um alle Funktionen zusammenzubringen und alles, was ich konnte, für alle kostenlos anzubieten.",
    mobile: "Mobile App — bald verfügbar",
    subscriptions: "Verbinde ChatGPT oder nutze deine eigenen API-Schlüssel.",
    github: "Auf GitHub ansehen",
    featuresTitle: "Deine Übungen, mit Nina.",
    features: {
      stories: {
        label: "Geschichten",
        text: "Lies Kurzgeschichten und speichere dabei nützliche Wörter.",
      },
      flashcards: { label: "Lernkarten", text: "Wiederhole gespeicherte Wörter mit Lernkarten." },
      exercises: {
        label: "Übungen",
        text: "Erstelle Übungen passend zu deinem Thema und Niveau.",
      },
      paths: {
        label: "Lernpfade",
        text: "Folge strukturierten Lektionen auf dem Weg zu deinen Lernzielen.",
      },
      writing: {
        label: "Schreiben",
        text: "Erhalte KI-Feedback und Erklärungen zu deinen Texten.",
      },
      vocabulary: {
        label: "Wortschatz",
        text: "Speichere Wörter und wiederhole sie später.",
      },
    },
    connections: "Bring deine KI mit.",
    providers: [
      { label: "OpenAI API" },
      { label: "Anthropic API" },
      { label: "Google Gemini API" },
      { label: "Lokale KI (Linux x64)", status: "eingeschränkt" },
      { label: "Nina-KI", status: "Nina Plus erforderlich" },
    ],
    languagesTitle: "Wähle deine Sprache.",
    learningLanguages: ["US-Englisch", "Brasilianisches Portugiesisch", "Spanisch", "Deutsch"],
    moreLanguages: "Weitere Sprachen",
    yes: "ja",
    notYet: "noch nicht",
    local:
      "Lerndaten werden lokal gespeichert. Von dir veröffentlichte Lernkarten werden über dein Nina-Konto synchronisiert.",
    source: "Quellcode auf GitHub",
  },
  es: {
    about: "Sobre nosotros",
    aboutPlaceholder: "Pronto encontrarás más información sobre Call Nina.",
    cta: "Haz clic aquí y descubre lo que Nina puede hacer por ti",

    title: "Call Nina — Un lugar para aprender idiomas",
    description:
      "Una aplicación de escritorio para practicar idiomas. Código abierto bajo la licencia MIT. Ejercicios con IA, rutas de aprendizaje, comentarios sobre textos y práctica de vocabulario con Call Nina.",
    skip: "Saltar al contenido",
    language: "Idioma del sitio",
    headline: "¿Quieres ayuda para aprender un idioma? ¡Call Nina!",
    mission:
      "Me cansé de pagar por aplicaciones para aprender idiomas. Así que empecé a crear Call Nina para reunir todas las funciones y ofrecer gratis a todo el mundo todo lo que pudiera.",
    mobile: "Aplicación móvil — próximamente",
    subscriptions: "Conecta ChatGPT o usa tus propias claves de API.",
    github: "Ver en GitHub",
    featuresTitle: "Tu práctica, con Nina.",
    features: {
      stories: {
        label: "Historias",
        text: "Lee historias cortas y guarda palabras útiles mientras avanzas.",
      },
      flashcards: { label: "Tarjetas", text: "Repasa el vocabulario guardado con tarjetas." },
      exercises: { label: "Ejercicios", text: "Genera ejercicios según tu tema y nivel." },
      paths: {
        label: "Rutas de aprendizaje",
        text: "Sigue lecciones estructuradas para alcanzar tus objetivos.",
      },
      writing: {
        label: "Escritura",
        text: "Recibe correcciones y explicaciones de la IA sobre lo que escribes.",
      },
      vocabulary: {
        label: "Vocabulario",
        text: "Guarda palabras y vuelve a practicarlas.",
      },
    },
    connections: "Trae tu IA.",
    providers: [
      { label: "API de OpenAI" },
      { label: "API de Anthropic" },
      { label: "API de Google Gemini" },
      { label: "IA local (Linux x64)", status: "limitada" },
      { label: "IA de Nina", status: "requiere Nina Plus" },
    ],
    languagesTitle: "Elige tu idioma.",
    learningLanguages: ["Inglés de Estados Unidos", "Portugués de Brasil", "Español", "Alemán"],
    moreLanguages: "Más idiomas",
    yes: "sí",
    notYet: "todavía no",
    local:
      "Los registros se guardan localmente. Las tarjetas que decidas publicar se sincronizan a través de tu cuenta de Nina.",
    source: "Código en GitHub",
  },
  "pt-BR": {
    about: "Sobre nós",
    aboutPlaceholder: "Em breve, mais sobre a Call Nina.",
    cta: "Clique aqui e descubra o que a Nina pode fazer por você",

    title: "Call Nina — Um lugar para aprender idiomas",
    description:
      "Um aplicativo de desktop para praticar idiomas. Código aberto sob a licença MIT. Exercícios com IA, trilhas de aprendizagem, feedback de escrita e prática de vocabulário com Call Nina.",
    skip: "Pular para o conteúdo",
    language: "Idioma do site",
    headline: "Quer ajuda para aprender um idioma? Call Nina!",
    mission:
      "Cansei de pagar por aplicativos de idiomas. Então comecei a criar a Call Nina para reunir todas as funcionalidades e disponibilizar gratuitamente para todos tudo o que eu pudesse.",
    mobile: "Aplicativo móvel — em breve",
    subscriptions: "Conecte o ChatGPT ou use suas próprias chaves de API.",
    github: "Ver no GitHub",
    featuresTitle: "Sua prática, com a Nina.",
    features: {
      stories: {
        label: "Histórias",
        text: "Leia histórias curtas e salve palavras úteis durante a leitura.",
      },
      flashcards: { label: "Flashcards", text: "Revise o vocabulário salvo com flashcards." },
      exercises: {
        label: "Exercícios",
        text: "Gere exercícios de acordo com seu tema e nível.",
      },
      paths: {
        label: "Trilhas de aprendizagem",
        text: "Siga lições estruturadas para alcançar seus objetivos.",
      },
      writing: {
        label: "Escrita",
        text: "Receba feedback e explicações da IA sobre seus textos.",
      },
      vocabulary: {
        label: "Vocabulário",
        text: "Salve palavras e volte para praticá-las.",
      },
    },
    connections: "Traga sua IA.",
    providers: [
      { label: "API da OpenAI" },
      { label: "API da Anthropic" },
      { label: "API do Google Gemini" },
      { label: "IA local (Linux x64)", status: "limitada" },
      { label: "IA da Nina", status: "requer Nina Plus" },
    ],
    languagesTitle: "Escolha seu idioma.",
    learningLanguages: ["Inglês dos Estados Unidos", "Português do Brasil", "Espanhol", "Alemão"],
    moreLanguages: "Mais idiomas",
    yes: "sim",
    notYet: "ainda não",
    local:
      "Os registros ficam salvos localmente. Os cartões que você publicar são sincronizados pela sua conta da Nina.",
    source: "Código no GitHub",
  },
};
