import type { Language } from "@call-nina/contracts";

// Starter learning content follows the selected target, independently of the interface locale.
export const practiceStarterExamples = {
  de: {
    grammar:
      "Erstelle eine Grammatiklektion auf meinem aktuellen Lernniveau zu Dativartikeln nach mit und zu, mit klarer Erklärung, Beispielen, Hinweisen, geführten Übungen und einer freien Produktionsaufgabe.",
    reading:
      "Die Arztpraxis bittet Patientinnen und Patienten, zehn Minuten vor einem Termin zu kommen. Die Sprechstunde beginnt um 10:00 Uhr in Raum 2.",
  },
  "en-US": {
    grammar:
      "Create a grammar lesson at my current level about articles and word order in everyday English sentences, with a clear explanation, examples, hints, guided practice, and one free-production exercise.",
    reading:
      "The clinic asks patients to arrive ten minutes before their appointment. The consultation begins at 10:00 in room 2.",
  },
  "pt-BR": {
    grammar:
      "Crie uma lição de gramática no meu nível atual sobre artigos e concordância em frases do cotidiano, com explicação clara, exemplos, dicas, prática guiada e um exercício de produção livre.",
    reading:
      "A clínica pede aos pacientes que cheguem dez minutos antes da consulta. O atendimento começa às 10h na sala 2.",
  },
  es: {
    grammar:
      "Crea una lección de gramática para mi nivel actual sobre artículos y concordancia en frases cotidianas, con una explicación clara, ejemplos, pistas, práctica guiada y un ejercicio de producción libre.",
    reading:
      "La clínica pide a los pacientes que lleguen diez minutos antes de su cita. La consulta comienza a las 10:00 en la sala 2.",
  },
} as const satisfies Record<Language, { grammar: string; reading: string }>;
