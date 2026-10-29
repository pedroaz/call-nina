import type { FeatureId, Locale } from "./locales";

export const roles = ["student", "teacher", "school"] as const;
export const learningLanguages = ["de", "es", "pt-BR", "en-US"] as const;
export const connections = ["chatgpt", "local", "nina", "unsure"] as const;
export const uses = {
  student: ["path", "practice"],
  teacher: ["prepare", "writing", "vocabulary"],
  school: ["lessons", "between"],
} as const;
export type Role = (typeof roles)[number];
export type LearningLanguage = (typeof learningLanguages)[number];
export type Connection = (typeof connections)[number];
export type Use = (typeof uses)[Role][number];
export type Answers = {
  role?: Role;
  language?: LearningLanguage;
  use?: Use;
  connection?: Connection;
};
export type DiscoveryState = {
  version: 1;
  seen: boolean;
  step: number;
  complete: boolean;
  answers: Answers;
};
export const storageKey = "nina.website.discovery.v1";
export const emptyState: DiscoveryState = {
  version: 1,
  seen: false,
  step: 0,
  complete: false,
  answers: {},
};
const features: Record<Use, FeatureId> = {
  path: "paths",
  practice: "exercises",
  prepare: "exercises",
  writing: "writing",
  vocabulary: "vocabulary",
  lessons: "paths",
  between: "exercises",
};
export function recommendedFeature(answers: Answers): FeatureId | undefined {
  return answers.use ? features[answers.use] : undefined;
}
export function readDiscovery(): DiscoveryState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!value || typeof value !== "object") return emptyState;
    const v = value as Partial<DiscoveryState>;
    if (
      v.version !== 1 ||
      typeof v.seen !== "boolean" ||
      typeof v.step !== "number" ||
      !Number.isInteger(v.step) ||
      v.step < 0 ||
      v.step > 3 ||
      typeof v.complete !== "boolean" ||
      !v.answers ||
      typeof v.answers !== "object"
    )
      return emptyState;
    const a = v.answers;
    if (
      (a.role !== undefined && !roles.includes(a.role)) ||
      (a.language !== undefined && !learningLanguages.includes(a.language)) ||
      (a.connection !== undefined && !connections.includes(a.connection)) ||
      (a.use !== undefined && (!a.role || !(uses[a.role] as readonly string[]).includes(a.use)))
    )
      return emptyState;
    const firstMissing = !a.role ? 0 : !a.language ? 1 : !a.use ? 2 : !a.connection ? 3 : 4;
    return {
      version: 1,
      seen: v.seen,
      step: Math.min(v.step, firstMissing),
      complete: v.complete && firstMissing === 4,
      answers: {
        ...(a.role && { role: a.role }),
        ...(a.language && { language: a.language }),
        ...(a.use && { use: a.use }),
        ...(a.connection && { connection: a.connection }),
      },
    };
  } catch {
    return emptyState;
  }
}

type DiscoveryCopy = {
  title: string;
  close: string;
  next: string;
  back: string;
  restart: string;
  finish: string;
  step: (number: number) => string;
  roleQuestion: string;
  languageQuestion: Record<Role, string>;
  useQuestion: string;
  connectionQuestion: string;
  roles: Record<Role, string>;
  languages: Record<LearningLanguage, string>;
  uses: Record<Use, string>;
  connections: Record<Connection, string>;
  guidance: Record<Connection, string>;
  summary: string;
  intro: string;
  recommendation: (language: string, use: Use) => string;
  roleIntro: Record<Role, string>;
  languageStory: (language: string, role: Role) => string;
  example: string;
  reveal: string;
  hide: string;
  answer: string;
  practicePrompt: string;
  writingPrompt: string;
  vocabularyPrompt: string;
  lessonPrompt: string;
  call: string;
  contact: string;
  professional: string;
  ready: string;
  readyText: string;
  edit: (label: string) => string;
};
export const discoveryCopy: Record<Locale, DiscoveryCopy> = {
  en: {
    title: "What can Nina do for you?",
    close: "Close",
    next: "Continue",
    back: "Back",
    restart: "Start over",
    finish: "See my recommendation",
    step: (n) => `Step ${String(n)} of 4`,
    roleQuestion: "First, a little about you.",
    languageQuestion: {
      student: "What are you learning?",
      teacher: "What do you teach?",
      school: "Which language would you like to explore?",
    },
    useQuestion: "How could Nina help?",
    connectionQuestion: "How would you like to connect?",
    roles: { student: "Student", teacher: "Teacher", school: "Language school" },
    languages: {
      de: "German",
      es: "Spanish",
      "pt-BR": "Brazilian Portuguese",
      "en-US": "US English",
    },
    uses: {
      path: "Follow a learning path",
      practice: "Ask AI to generate exercises",
      prepare: "Prepare practice",
      writing: "Support writing",
      vocabulary: "Practise vocabulary",
      lessons: "Support lessons",
      between: "Practice between lessons",
    },
    connections: {
      chatgpt: "ChatGPT",
      local: "Local AI — limited",
      nina: "Nina account",
      unsure: "Not sure yet",
    },
    guidance: {
      chatgpt: "Bring your ChatGPT account. Provider terms and limits apply.",
      local:
        "Local AI supports writing prompts, contextual help, exercise creation and feedback on Linux x64.",
      nina: "Create a Free Nina account in the app. Nina Plus and hosted AI allowances are assigned by an administrator.",
      unsure: "Choose your AI later. ChatGPT is available.",
    },
    summary: "Your Nina",
    intro: "Your goals. Your practice. Your Nina.",
    roleIntro: {
      student: "Learn your way. Get exercises, writing feedback, and vocabulary practice.",
      teacher: "Turn lesson ideas into exercises, corrections, and vocabulary practice.",
      school: "Bring guided lessons and independent practice to your language school.",
    },
    languageStory: (language, role) =>
      ({
        student: `Make ${language} your next step. Choose a path or your own topic.`,
        teacher: `Build ${language} practice around your next lesson.`,
        school: `Explore ${language} practice for class and beyond.`,
      })[role],
    recommendation: (language, use) =>
      ({
        path: `Learn ${language}, one guided lesson at a time.`,
        practice: `Your topic. Your level. AI exercises in ${language}.`,
        prepare: `Create ${language} exercises for your lesson’s topic and level.`,
        writing: `Make ${language} corrections clear, with explanations.`,
        vocabulary: `Keep ${language} words fresh with vocabulary practice.`,
        lessons: `Support ${language} lessons with structured practice.`,
        between: `Keep ${language} practice going between classes.`,
      })[use],
    example: "Example preview",
    reveal: "Reveal answer",
    hide: "Hide answer",
    answer: "Answer",
    practicePrompt: "Complete the sentence with the missing word.",
    writingPrompt: "A small correction, with a reason.",
    vocabularyPrompt: "A word to keep. A sentence to remember it by.",
    lessonPrompt: "A small lesson: introduce yourself. Then try it.",
    call: "Call Nina",
    contact: "Discuss enterprise support",
    professional: "Commercial and institutional use are permitted under the MIT License.",
    ready: "Here’s your Nina.",
    readyText: "Explore your recommendation, or change an answer to try another direction.",
    edit: (label) => `Change: ${label}`,
  },
  de: {
    title: "Was kann Nina für dich tun?",
    close: "Schließen",
    next: "Weiter",
    back: "Zurück",
    restart: "Neu beginnen",
    finish: "Meine Empfehlung ansehen",
    step: (n) => `Schritt ${String(n)} von 4`,
    roleQuestion: "Zuerst ein wenig über dich.",
    languageQuestion: {
      student: "Welche Sprache lernst du?",
      teacher: "Welche Sprache unterrichtest du?",
      school: "Welche Sprache möchtest du erkunden?",
    },
    useQuestion: "Wie könnte Nina helfen?",
    connectionQuestion: "Wie möchtest du dich verbinden?",
    roles: { student: "Lernende", teacher: "Lehrkraft", school: "Sprachschule" },
    languages: {
      de: "Deutsch",
      es: "Spanisch",
      "pt-BR": "Brasilianisches Portugiesisch",
      "en-US": "US-Englisch",
    },
    uses: {
      path: "Einem Lernpfad folgen",
      practice: "Übungen von der KI erstellen lassen",
      prepare: "Übungen vorbereiten",
      writing: "Beim Schreiben unterstützen",
      vocabulary: "Wortschatz üben",
      lessons: "Unterricht unterstützen",
      between: "Zwischen den Unterrichtsstunden üben",
    },
    connections: {
      chatgpt: "ChatGPT",
      local: "Lokale KI — eingeschränkt",
      nina: "Nina-Konto",
      unsure: "Noch unsicher",
    },
    guidance: {
      chatgpt: "Nutze dein ChatGPT-Konto. Anbieterbedingungen und Limits gelten.",
      local:
        "Lokale KI unterstützt Schreibimpulse, kontextbezogene Hilfe sowie die Erstellung und Bewertung von Übungen unter Linux x64.",
      nina: "Erstelle ein kostenloses Nina-Konto in der App. Nina Plus und Kontingente für gehostete KI werden von der Administration zugewiesen.",
      unsure: "Wähle deine KI später. ChatGPT ist verfügbar.",
    },
    summary: "Deine Nina",
    intro: "Deine Ziele. Deine Übungen. Deine Nina.",
    roleIntro: {
      student: "Lerne auf deine Art. Mit Übungen, Schreibfeedback und Wortschatztraining.",
      teacher: "Mach aus Unterrichtsideen Übungen, Korrekturen und Wortschatztraining.",
      school: "Lernpfade und selbstständiges Üben für deine Sprachschule.",
    },
    languageStory: (language, role) =>
      ({
        student: `Dein nächster Schritt: ${language}. Mit Lernpfad oder eigenem Thema.`,
        teacher: `Gestalte Übungen für deine nächste Stunde in ${language}.`,
        school: `Entdecke ${language} für den Unterricht und darüber hinaus.`,
      })[role],
    recommendation: (language, use) =>
      ({
        path: `Lerne ${language}, eine geführte Lektion nach der anderen.`,
        practice: `Dein Thema. Dein Niveau. KI-Übungen für ${language}.`,
        prepare: `Erstelle Übungen für ${language}, passend zu Thema und Niveau.`,
        writing: `Mach Korrekturen in ${language} verständlich, mit Erklärungen.`,
        vocabulary: `Behalte Wörter in ${language} mit Wortschatzübungen.`,
        lessons: `Ergänze den Unterricht in ${language} mit strukturierten Übungen.`,
        between: `Übe ${language} auch zwischen den Unterrichtsstunden.`,
      })[use],
    example: "Beispielvorschau",
    reveal: "Antwort zeigen",
    hide: "Antwort verbergen",
    answer: "Antwort",
    practicePrompt: "Ergänze das fehlende Wort im Satz.",
    writingPrompt: "Eine kleine Korrektur mit Erklärung.",
    vocabularyPrompt: "Ein Wort zum Behalten. Ein Satz als Merkhilfe.",
    lessonPrompt: "Eine kleine Lektion: Stell dich vor. Dann bist du dran.",
    call: "Call Nina",
    contact: "Support für Unternehmen besprechen",
    professional: "Kommerzielle und institutionelle Nutzung sind unter der MIT-Lizenz erlaubt.",
    ready: "Hier ist deine Nina.",
    readyText:
      "Entdecke deine Empfehlung oder ändere eine Antwort, um etwas anderes auszuprobieren.",
    edit: (label) => `Ändern: ${label}`,
  },
  es: {
    title: "¿Qué puede hacer Nina por ti?",
    close: "Cerrar",
    next: "Continuar",
    back: "Atrás",
    restart: "Empezar de nuevo",
    finish: "Ver mi recomendación",
    roleQuestion: "Primero, un poco sobre ti.",
    languageQuestion: {
      student: "¿Qué idioma estás aprendiendo?",
      teacher: "¿Qué idioma enseñas?",
      school: "¿Qué idioma te gustaría explorar?",
    },
    useQuestion: "¿Cómo podría ayudarte Nina?",
    connectionQuestion: "¿Cómo te gustaría conectarte?",
    roles: { student: "Estudiante", teacher: "Docente", school: "Escuela de idiomas" },
    languages: {
      de: "Alemán",
      es: "Español",
      "pt-BR": "Portugués de Brasil",
      "en-US": "Inglés de Estados Unidos",
    },
    uses: {
      path: "Seguir una ruta de aprendizaje",
      practice: "Pedir a la IA que genere ejercicios",
      prepare: "Preparar ejercicios",
      writing: "Apoyar la escritura",
      vocabulary: "Practicar vocabulario",
      lessons: "Apoyar las clases",
      between: "Practicar entre clases",
    },
    connections: {
      chatgpt: "ChatGPT",
      local: "IA local — limitada",
      nina: "Cuenta de Nina",
      unsure: "Aún no lo sé",
    },
    guidance: {
      chatgpt: "Usa tu cuenta de ChatGPT. Se aplican sus términos y límites.",
      local:
        "La IA local permite generar consignas de escritura, ayuda contextual, ejercicios y comentarios en Linux x64.",
      nina: "Crea una cuenta gratuita de Nina en la aplicación. Un administrador asigna Nina Plus y los créditos de IA alojada.",
      unsure: "Elige tu IA después. ChatGPT está disponible.",
    },
    summary: "Tu Nina",
    intro: "Tus metas. Tu práctica. Tu Nina.",
    roleIntro: {
      student: "Aprende a tu manera. Con ejercicios, correcciones y vocabulario.",
      teacher: "Convierte tus ideas en ejercicios, correcciones y práctica de vocabulario.",
      school: "Lecciones guiadas y práctica independiente para tu escuela.",
    },
    languageStory: (language, role) =>
      ({
        student: `Tu próximo paso: ${language}. Elige una ruta o tu propio tema.`,
        teacher: `Prepara ejercicios de ${language} para tu próxima clase.`,
        school: `Explora ${language} dentro y fuera del aula.`,
      })[role],
    example: "Ejemplo de muestra",
    reveal: "Mostrar respuesta",
    hide: "Ocultar respuesta",
    answer: "Respuesta",
    practicePrompt: "Completa la frase con la palabra que falta.",
    writingPrompt: "Una pequeña corrección, con una explicación.",
    vocabularyPrompt: "Una palabra para guardar. Una frase para recordarla.",
    lessonPrompt: "Una pequeña lección: preséntate. Luego inténtalo.",
    call: "Call Nina",
    contact: "Consultar sobre soporte empresarial",
    professional: "El uso comercial e institucional está permitido bajo la licencia MIT.",
    ready: "Aquí está tu Nina.",
    readyText: "Explora tu recomendación o cambia una respuesta para probar otra opción.",
    step: (n) => `Paso ${String(n)} de 4`,
    edit: (label) => `Cambiar: ${label}`,
    recommendation: (language, use) =>
      ({
        path: `Aprende ${language}, una lección guiada a la vez.`,
        practice: `Tu tema. Tu nivel. Ejercicios de ${language} con IA.`,
        prepare: `Crea ejercicios de ${language} según el tema y nivel de tu clase.`,
        writing: `Aclara las correcciones en ${language} con explicaciones.`,
        vocabulary: `Recuerda palabras de ${language} con práctica de vocabulario.`,
        lessons: `Complementa tus clases de ${language} con ejercicios estructurados.`,
        between: `Sigue practicando ${language} entre clases.`,
      })[use],
  },
  "pt-BR": {
    title: "O que a Nina pode fazer por você?",
    close: "Fechar",
    next: "Continuar",
    back: "Voltar",
    restart: "Recomeçar",
    finish: "Ver minha recomendação",
    roleQuestion: "Primeiro, um pouco sobre você.",
    languageQuestion: {
      student: "Que idioma você está aprendendo?",
      teacher: "Que idioma você ensina?",
      school: "Que idioma você gostaria de explorar?",
    },
    useQuestion: "Como a Nina pode ajudar?",
    connectionQuestion: "Como você gostaria de se conectar?",
    roles: { student: "Estudante", teacher: "Professor", school: "Escola de idiomas" },
    languages: {
      de: "Alemão",
      es: "Espanhol",
      "pt-BR": "Português do Brasil",
      "en-US": "Inglês dos Estados Unidos",
    },
    uses: {
      path: "Seguir uma trilha de aprendizagem",
      practice: "Pedir à IA para gerar exercícios",
      prepare: "Preparar exercícios",
      writing: "Apoiar a escrita",
      vocabulary: "Praticar vocabulário",
      lessons: "Apoiar as aulas",
      between: "Praticar entre as aulas",
    },
    connections: {
      chatgpt: "ChatGPT",
      local: "IA local — limitada",
      nina: "Conta da Nina",
      unsure: "Ainda não sei",
    },
    guidance: {
      chatgpt: "Use sua conta do ChatGPT. Os termos e limites do provedor se aplicam.",
      local:
        "A IA local oferece propostas de escrita, ajuda contextual, criação de exercícios e feedback no Linux x64.",
      nina: "Crie uma conta gratuita da Nina no aplicativo. Um administrador atribui o Nina Plus e os créditos de IA hospedada.",
      unsure: "Escolha sua IA depois. O ChatGPT está disponível.",
    },
    summary: "Sua Nina",
    intro: "Seus objetivos. Sua prática. Sua Nina.",
    roleIntro: {
      student: "Aprenda do seu jeito. Com exercícios, feedback e vocabulário.",
      teacher: "Transforme suas ideias em exercícios, correções e prática de vocabulário.",
      school: "Lições guiadas e prática independente para sua escola.",
    },
    languageStory: (language, role) =>
      ({
        student: `Seu próximo passo: ${language}. Escolha uma trilha ou seu próprio tema.`,
        teacher: `Prepare exercícios de ${language} para sua próxima aula.`,
        school: `Explore ${language} dentro e fora da sala de aula.`,
      })[role],
    example: "Exemplo de demonstração",
    reveal: "Mostrar resposta",
    hide: "Ocultar resposta",
    answer: "Resposta",
    practicePrompt: "Complete a frase com a palavra que falta.",
    writingPrompt: "Uma pequena correção, com uma explicação.",
    vocabularyPrompt: "Uma palavra para guardar. Uma frase para lembrar.",
    lessonPrompt: "Uma pequena lição: apresente-se. Depois, tente você.",
    call: "Call Nina",
    contact: "Conversar sobre suporte empresarial",
    professional: "O uso comercial e institucional é permitido sob a licença MIT.",
    ready: "Aqui está sua Nina.",
    readyText: "Explore sua recomendação ou mude uma resposta para experimentar outra opção.",
    step: (n) => `Etapa ${String(n)} de 4`,
    edit: (label) => `Alterar: ${label}`,
    recommendation: (language, use) =>
      ({
        path: `Aprenda ${language}, uma lição guiada de cada vez.`,
        practice: `Seu tema. Seu nível. Exercícios de ${language} com IA.`,
        prepare: `Crie exercícios de ${language} para o tema e nível da sua aula.`,
        writing: `Esclareça correções em ${language} com explicações.`,
        vocabulary: `Fixe palavras em ${language} com prática de vocabulário.`,
        lessons: `Complemente suas aulas de ${language} com exercícios estruturados.`,
        between: `Continue praticando ${language} entre as aulas.`,
      })[use],
  },
};

type Example = {
  sentence: string;
  answer: string;
  lesson: string;
  original: string;
  correction: string;
  word: string;
  wordSentence: string;
  meaning: Record<Locale, string>;
  explanation: Record<Locale, string>;
};
export const examples: Record<LearningLanguage, Example> = {
  de: {
    sentence: "Ich ___ jeden Tag Deutsch.",
    answer: "lerne",
    lesson: "Ich heiße Alex. Ich lerne Deutsch.",
    original: "Ich lernen Deutsch.",
    correction: "Ich lerne Deutsch.",
    word: "üben",
    wordSentence: "Ich übe jeden Tag.",
    meaning: {
      en: "to practise",
      de: "etwas wiederholen, um es besser zu können",
      es: "practicar",
      "pt-BR": "praticar",
    },
    explanation: {
      en: "With ich, lernen becomes lerne.",
      de: "Bei ich wird lernen zu lerne.",
      es: "Con ich, lernen se convierte en lerne.",
      "pt-BR": "Com ich, lernen fica lerne.",
    },
  },
  es: {
    sentence: "Yo ___ español cada día.",
    answer: "estudio",
    lesson: "Me llamo Alex. Estudio español.",
    original: "Yo estudiar español.",
    correction: "Yo estudio español.",
    word: "practicar",
    wordSentence: "Practico cada día.",
    meaning: { en: "to practise", de: "üben", es: "practicar", "pt-BR": "praticar" },
    explanation: {
      en: "With yo, estudiar becomes estudio.",
      de: "Bei yo wird estudiar zu estudio.",
      es: "Con yo, estudiar se convierte en estudio.",
      "pt-BR": "Com yo, estudiar fica estudio.",
    },
  },
  "pt-BR": {
    sentence: "Eu ___ português todos os dias.",
    answer: "estudo",
    lesson: "Meu nome é Alex. Eu estudo português.",
    original: "Eu estudar português.",
    correction: "Eu estudo português.",
    word: "praticar",
    wordSentence: "Eu pratico todos os dias.",
    meaning: { en: "to practise", de: "üben", es: "practicar", "pt-BR": "praticar" },
    explanation: {
      en: "With eu, estudar becomes estudo.",
      de: "Bei eu wird estudar zu estudo.",
      es: "Con eu, estudar se convierte en estudo.",
      "pt-BR": "Com eu, estudar fica estudo.",
    },
  },
  "en-US": {
    sentence: "She ___ English every day.",
    answer: "studies",
    lesson: "My name is Alex. I study English.",
    original: "She study English.",
    correction: "She studies English.",
    word: "practice",
    wordSentence: "I practice every day.",
    meaning: {
      en: "to do something regularly to improve",
      de: "üben",
      es: "practicar",
      "pt-BR": "praticar",
    },
    explanation: {
      en: "With she, study becomes studies in the present simple.",
      de: "Bei she wird study im Simple Present zu studies.",
      es: "Con she, study se convierte en studies en presente simple.",
      "pt-BR": "Com she, study fica studies no presente simples.",
    },
  },
};
