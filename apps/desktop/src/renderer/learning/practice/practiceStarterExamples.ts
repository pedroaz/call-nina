import type { Language } from "@call-nina/contracts";

// Starter learning content follows the selected target, independently of the interface locale.
export const practiceStarterExamples = {
  de: {
    grammar:
      "Erstelle eine Grammatiklektion auf meinem aktuellen Lernniveau zu Dativartikeln nach mit und zu, mit klarer Erklärung, Beispielen, Hinweisen, geführten Übungen und einer freien Produktionsaufgabe.",
  },
  "en-US": {
    grammar:
      "Create a grammar lesson at my current level about articles and word order in everyday English sentences, with a clear explanation, examples, hints, guided practice, and one free-production exercise.",
  },
  "pt-BR": {
    grammar:
      "Crie uma lição de gramática no meu nível atual sobre artigos e concordância em frases do cotidiano, com explicação clara, exemplos, dicas, prática guiada e um exercício de produção livre.",
  },
  es: {
    grammar:
      "Crea una lección de gramática para mi nivel actual sobre artículos y concordancia en frases cotidianas, con una explicación clara, ejemplos, pistas, práctica guiada y un ejercicio de producción libre.",
  },
} as const satisfies Record<Language, { grammar: string }>;
