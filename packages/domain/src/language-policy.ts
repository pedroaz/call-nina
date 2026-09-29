import {
  type Language,
  normalizeLanguageAnswer,
  targetLanguageSchema,
  languageDefinitions,
} from "@call-nina/contracts";

function gradingPolicy(language: Language) {
  const normalized = (value: string) => normalizeLanguageAnswer(value, language);

  function normalizedSentence(value: string): string {
    return value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ");
  }

  function isAccepted(value: string, accepted: readonly string[]): boolean {
    const candidate = normalized(value);
    return accepted.some((answer) => normalized(answer) === candidate);
  }

  function isAcceptedSentence(value: string, accepted: readonly string[]): boolean {
    const candidate = normalizedSentence(value);
    return accepted.some((answer) => normalizedSentence(answer) === candidate);
  }

  function words(value: string): readonly string[] {
    return value.match(/[\p{L}\p{N}]+/gu) ?? [];
  }

  function withoutDiacritics(value: string): string {
    return value.normalize("NFD").replaceAll(/\p{M}/gu, "");
  }

  function attemptsExpectedCorrection(
    candidate: string,
    original: string,
    expected: string,
  ): boolean {
    const candidateWords = words(candidate);
    const originalWords = words(original);
    const expectedWords = words(expected);
    if (
      candidateWords.length !== originalWords.length ||
      candidateWords.length !== expectedWords.length
    ) {
      return true;
    }
    const changedPositions = expectedWords.flatMap((word, position) =>
      word === originalWords[position] ? [] : [position],
    );
    return changedPositions.every(
      (position) =>
        withoutDiacritics(candidateWords[position] ?? "") ===
        withoutDiacritics(expectedWords[position] ?? ""),
    );
  }

  function editDistance(left: string, right: string): number {
    if (left === right) return 0;
    if (left.length === 0) return right.length;
    if (right.length === 0) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_, position) => position);
    for (let leftPosition = 1; leftPosition <= left.length; leftPosition += 1) {
      const current = [leftPosition];
      for (let rightPosition = 1; rightPosition <= right.length; rightPosition += 1) {
        current[rightPosition] = Math.min(
          (current[rightPosition - 1] ?? 0) + 1,
          (previous[rightPosition] ?? 0) + 1,
          (previous[rightPosition - 1] ?? 0) +
            (left[leftPosition - 1] === right[rightPosition - 1] ? 0 : 1),
        );
      }
      previous = current;
    }
    return previous[right.length] ?? Math.max(left.length, right.length);
  }

  function isAlmostAcceptedSentence(
    value: string,
    source: string,
    accepted: readonly string[],
  ): boolean {
    const candidate = normalizedSentence(value);
    const original = normalizedSentence(source);
    if (candidate === original) return false;
    return accepted.some((answer) => {
      const expected = normalizedSentence(answer);
      const maximumMinorEdits = Math.min(3, Math.max(1, Math.ceil(expected.length / 30)));
      if (Math.abs(candidate.length - expected.length) > maximumMinorEdits) return false;
      if (!attemptsExpectedCorrection(candidate, original, expected)) return false;
      const distanceFromExpected = editDistance(candidate, expected);
      const minimumDistanceFromOriginal = Math.abs(candidate.length - original.length);
      const distanceFromOriginal =
        minimumDistanceFromOriginal > distanceFromExpected
          ? minimumDistanceFromOriginal
          : editDistance(candidate, original);
      return (
        distanceFromExpected <= maximumMinorEdits && distanceFromExpected < distanceFromOriginal
      );
    });
  }

  return { normalize: normalized, isAccepted, isAcceptedSentence, isAlmostAcceptedSentence };
}

type PracticeRequestKind =
  "mistake" | "writing" | "reading" | "speaking" | "grammar" | "listening" | "lesson";

function practiceRequest(
  target: Language,
  kind: PracticeRequestKind,
  explanation: Language,
  topic: string,
  level: string,
): string {
  const language = languageDefinitions[target].name;
  const tasks = {
    "en-US": {
      mistake: "Practise the recurring pattern",
      writing: "Write 4–6 sentences, ask for information and suggest a next step",
      reading: "Read a short passage and answer comprehension questions",
      speaking: "Practise a conversation and ask for repetition when needed",
      grammar: "Practise grammar in six short tasks",
      listening: "Listen to a short conversation",
      lesson: "Use vocabulary in six short exercises",
    },
    "pt-BR": {
      mistake: "Pratique o padrão recorrente",
      writing: "Escreva de 4 a 6 frases, peça uma informação e sugira um próximo passo",
      reading: "Leia um texto curto e responda às perguntas de compreensão",
      speaking: "Pratique uma conversa e peça para repetir quando necessário",
      grammar: "Pratique gramática em seis tarefas curtas",
      listening: "Ouça uma conversa curta",
      lesson: "Use vocabulário em seis exercícios curtos",
    },
    es: {
      mistake: "Practica el patrón recurrente",
      writing: "Escribe de 4 a 6 oraciones, pide información y sugiere un siguiente paso",
      reading: "Lee un texto breve y responde a las preguntas de comprensión",
      speaking: "Practica una conversación y pide que se repita cuando sea necesario",
      grammar: "Practica gramática en seis tareas breves",
      listening: "Escucha una conversación breve",
      lesson: "Usa vocabulario en seis ejercicios breves",
    },
    de: {
      mistake: "Übe das wiederkehrende Muster",
      writing:
        "Schreibe 4–6 Sätze, bitte um eine Information und schlage einen nächsten Schritt vor",
      reading: "Lies einen kurzen Text und beantworte Verständnisfragen",
      speaking: "Übe ein Gespräch und bitte bei Bedarf um Wiederholung",
      grammar: "Übe Grammatik in sechs kurzen Aufgaben",
      listening: "Höre ein kurzes Gespräch",
      lesson: "Verwende Wörter in sechs kurzen Übungen",
    },
  } satisfies Record<Language, Record<PracticeRequestKind, string>>;
  const labels = {
    "en-US": ["Target language", "Topic", "Level", "Explanation language"],
    "pt-BR": ["Idioma de estudo", "Tema", "Nível", "Idioma das explicações"],
    es: ["Idioma de estudio", "Tema", "Nivel", "Idioma de las explicaciones"],
    de: ["Zielsprache", "Thema", "Niveau", "Erklärungssprache"],
  } as const;
  const l = labels[explanation];
  return `${tasks[explanation][kind]}. ${l[0]}: ${language}. ${l[1]}: ${topic}. ${l[2]}: ${level.toUpperCase()}. ${l[3]}: ${languageDefinitions[explanation].name}.`;
}

export function supportedLanguagePolicy(value: unknown) {
  const targetLanguage = targetLanguageSchema.parse(value);
  return Object.freeze({
    targetLanguage,
    ...gradingPolicy(targetLanguage),
    practiceRequest: (
      kind: PracticeRequestKind,
      explanation: Language,
      topic: string,
      level: string,
    ) => practiceRequest(targetLanguage, kind, explanation, topic, level),
  });
}
