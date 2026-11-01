import type { FeatureId, Locale } from "./locales";

type FeatureDetail = {
  title: string;
  description: string;
  points: [string, string, string];
};

export const featureDetails: Record<Locale, Record<FeatureId, FeatureDetail>> = {
  en: {
    paths: {
      title: "Practice with a direction.",
      description:
        "Follow a learning path with lessons and exercises tailored to its topic and level. Work through explanations, examples and practice at your own pace.",
      points: [
        "Choose a course or a real-life scenario.",
        "Put each lesson into practice with focused exercises.",
        "Keep your progress and return to your next step.",
      ],
    },
    exercises: {
      title: "Your topic. Your practice.",
      description:
        "Ask AI to generate exercises around what you want to learn. Choose a topic and level, or use your own material to make the practice relevant to you.",
      points: [
        "Create practice for the skills you want to work on.",
        "Answer the questions and get feedback on your attempts.",
        "Save activities and come back to practise again.",
      ],
    },
    writing: {
      title: "Understand your corrections.",
      description:
        "Write in the language you are learning and get AI feedback on your text. See what to improve and why, so a correction becomes something you can use next time.",
      points: [
        "Write freely or start from a writing prompt.",
        "Review suggested corrections and explanations.",
        "Keep your original text alongside its feedback.",
      ],
    },
    stories: {
      title: "Meet words in context.",
      description:
        "Read short stories in your learning language. Follow the text a paragraph at a time and build your vocabulary through situations, rather than isolated word lists.",
      points: [
        "Find a story at your level.",
        "Save useful words from your reading.",
        "Pick up where you left off.",
      ],
    },
    vocabulary: {
      title: "Let your mistakes guide you.",
      description:
        "Turn words you save and mistakes from your practice into things to work on. Nina keeps learning evidence and focus areas together so you can revisit what needs attention.",
      points: [
        "Keep words with their meanings and context.",
        "Review mistakes and the areas you want to improve.",
        "Return to vocabulary when it is due for review.",
      ],
    },
    flashcards: {
      title: "Recall it before you reveal it.",
      description:
        "Practise with flashcard decks, one card at a time. Try to remember the answer before turning the card over, and keep useful words for later study.",
      points: [
        "Reveal answers at your own pace.",
        "Save useful cards to your vocabulary.",
        "Return to saved decks for another practice session.",
      ],
    },
  },
  de: {
    paths: {
      title: "Üben mit einem klaren Ziel.",
      description:
        "Folge einem Lernpfad mit Lektionen und Übungen, die auf Thema und Niveau abgestimmt sind. Arbeite Erklärungen, Beispiele und Übungen in deinem Tempo durch.",
      points: [
        "Wähle einen Kurs oder eine Alltagssituation.",
        "Wende jede Lektion in gezielten Übungen an.",
        "Speichere deinen Fortschritt und setze deinen Weg fort.",
      ],
    },
    exercises: {
      title: "Dein Thema. Deine Übungen.",
      description:
        "Lass dir von der KI Übungen zu dem erstellen, was du lernen möchtest. Wähle Thema und Niveau oder nutze eigenes Material für passende Übungen.",
      points: [
        "Übe gezielt die Fähigkeiten, an denen du arbeiten möchtest.",
        "Beantworte die Fragen und erhalte Feedback zu deinen Versuchen.",
        "Speichere Aktivitäten, um später erneut zu üben.",
      ],
    },
    writing: {
      title: "Verstehe deine Korrekturen.",
      description:
        "Schreibe in deiner Lernsprache und erhalte KI-Feedback zu deinem Text. Erfahre, was du verbessern kannst und warum, damit dir die Korrektur beim nächsten Mal hilft.",
      points: [
        "Schreibe frei oder nutze einen Schreibimpuls.",
        "Sieh dir Korrekturvorschläge und Erklärungen an.",
        "Behalte deinen ursprünglichen Text zusammen mit dem Feedback.",
      ],
    },
    stories: {
      title: "Wörter im Zusammenhang erleben.",
      description:
        "Lies Kurzgeschichten in deiner Lernsprache. Gehe Absatz für Absatz vor und lerne Wörter anhand von Situationen statt nur aus Wortlisten.",
      points: [
        "Finde eine Geschichte auf deinem Niveau.",
        "Speichere nützliche Wörter beim Lesen.",
        "Lies dort weiter, wo du aufgehört hast.",
      ],
    },
    vocabulary: {
      title: "Lerne aus deinen Fehlern.",
      description:
        "Nutze gespeicherte Wörter und Fehler aus deinen Übungen als Ausgangspunkt zum Weiterlernen. Nina sammelt Lernbelege und Schwerpunkte, damit du gezielt daran arbeiten kannst.",
      points: [
        "Speichere Wörter mit Bedeutung und Kontext.",
        "Sieh dir Fehler und deine Lernschwerpunkte an.",
        "Wiederhole Wörter, wenn sie zur Wiederholung anstehen.",
      ],
    },
    flashcards: {
      title: "Erst erinnern, dann aufdecken.",
      description:
        "Übe mit Lernkarten, eine Karte nach der anderen. Versuche, dich an die Antwort zu erinnern, bevor du sie aufdeckst, und behalte nützliche Wörter zum Weiterlernen.",
      points: [
        "Decke Antworten in deinem eigenen Tempo auf.",
        "Speichere nützliche Karten in deinem Wortschatz.",
        "Übe später erneut mit gespeicherten Kartensätzen.",
      ],
    },
  },
  es: {
    paths: {
      title: "Practica con un rumbo claro.",
      description:
        "Sigue una ruta con lecciones y ejercicios adaptados a su tema y nivel. Avanza por las explicaciones, los ejemplos y la práctica a tu ritmo.",
      points: [
        "Elige un curso o una situación cotidiana.",
        "Aplica cada lección con ejercicios específicos.",
        "Conserva tu progreso y retoma el siguiente paso.",
      ],
    },
    exercises: {
      title: "Tu tema. Tu práctica.",
      description:
        "Pide a la IA que genere ejercicios sobre lo que quieres aprender. Elige un tema y nivel, o utiliza tu propio material para practicar algo relevante para ti.",
      points: [
        "Crea ejercicios para las habilidades que quieres trabajar.",
        "Responde y recibe comentarios sobre tus intentos.",
        "Guarda actividades para volver a practicar.",
      ],
    },
    writing: {
      title: "Entiende tus correcciones.",
      description:
        "Escribe en el idioma que estás aprendiendo y recibe comentarios de la IA. Descubre qué mejorar y por qué, para aprovechar cada corrección la próxima vez.",
      points: [
        "Escribe libremente o parte de una propuesta de escritura.",
        "Revisa las correcciones sugeridas y sus explicaciones.",
        "Conserva tu texto original junto con los comentarios.",
      ],
    },
    stories: {
      title: "Descubre palabras en contexto.",
      description:
        "Lee historias cortas en el idioma que aprendes. Avanza párrafo a párrafo y amplía tu vocabulario a través de situaciones, en lugar de listas de palabras aisladas.",
      points: [
        "Encuentra una historia de tu nivel.",
        "Guarda palabras útiles mientras lees.",
        "Continúa donde lo dejaste.",
      ],
    },
    vocabulary: {
      title: "Deja que tus errores te guíen.",
      description:
        "Convierte las palabras que guardas y los errores de tus ejercicios en oportunidades para aprender. Nina reúne tus registros de aprendizaje y áreas de mejora para ayudarte a repasarlas.",
      points: [
        "Guarda palabras con su significado y contexto.",
        "Revisa tus errores y lo que quieres mejorar.",
        "Repasa el vocabulario cuando llegue el momento de revisarlo.",
      ],
    },
    flashcards: {
      title: "Recuerda antes de descubrir.",
      description:
        "Practica con tarjetas, una a una. Intenta recordar la respuesta antes de darle la vuelta y guarda las palabras útiles para seguir estudiando.",
      points: [
        "Descubre las respuestas a tu ritmo.",
        "Guarda tarjetas útiles en tu vocabulario.",
        "Vuelve a practicar con tus mazos guardados.",
      ],
    },
  },
  "pt-BR": {
    paths: {
      title: "Pratique com uma direção.",
      description:
        "Siga uma trilha com lições e exercícios adaptados ao tema e ao nível. Avance pelas explicações, exemplos e atividades no seu ritmo.",
      points: [
        "Escolha um curso ou uma situação do dia a dia.",
        "Coloque cada lição em prática com exercícios focados.",
        "Mantenha seu progresso e retome o próximo passo.",
      ],
    },
    exercises: {
      title: "Seu tema. Sua prática.",
      description:
        "Peça à IA para gerar exercícios sobre o que você quer aprender. Escolha um tema e nível ou use seu próprio material para tornar a prática relevante para você.",
      points: [
        "Crie atividades para as habilidades que quer desenvolver.",
        "Responda às perguntas e receba feedback sobre suas tentativas.",
        "Salve atividades para praticar novamente depois.",
      ],
    },
    writing: {
      title: "Entenda suas correções.",
      description:
        "Escreva no idioma que está aprendendo e receba feedback da IA. Veja o que melhorar e por quê, para aproveitar cada correção na próxima vez.",
      points: [
        "Escreva livremente ou comece com uma proposta de escrita.",
        "Revise as correções sugeridas e suas explicações.",
        "Mantenha seu texto original junto com o feedback.",
      ],
    },
    stories: {
      title: "Encontre palavras em contexto.",
      description:
        "Leia histórias curtas no idioma que está aprendendo. Avance um parágrafo por vez e amplie seu vocabulário por meio de situações, em vez de listas de palavras isoladas.",
      points: [
        "Encontre uma história no seu nível.",
        "Salve palavras úteis durante a leitura.",
        "Continue de onde parou.",
      ],
    },
    vocabulary: {
      title: "Deixe seus erros guiarem você.",
      description:
        "Transforme as palavras que salva e os erros da prática em oportunidades de aprendizado. A Nina reúne seus registros e focos de estudo para você retomar o que precisa de atenção.",
      points: [
        "Guarde palavras com significado e contexto.",
        "Revise seus erros e as áreas que quer melhorar.",
        "Retome o vocabulário quando chegar a hora de revisar.",
      ],
    },
    flashcards: {
      title: "Lembre antes de revelar.",
      description:
        "Pratique com baralhos de flashcards, uma carta por vez. Tente lembrar a resposta antes de virar a carta e guarde palavras úteis para estudar depois.",
      points: [
        "Revele as respostas no seu ritmo.",
        "Salve cartas úteis no seu vocabulário.",
        "Volte aos baralhos salvos para praticar novamente.",
      ],
    },
  },
};
