import {
  ninaRequestSchema,
  type NinaRequest,
  type NinaGenerationRequest,
} from "@call-nina/contracts";

const intentWords = {
  reading:
    /\b(read(?:ing)?|comprehension|ler|leitura|compreensao|leer|lectura|comprension|lesen|leseverstehen)\b/u,
  writing:
    /\b(writ(?:e|ing)|email|essay|escrever|escrita|redacao|escribir|escritura|redaccion|schreiben|aufsatz)\b/u,
  grammar:
    /\b(grammar|gramatica|grammatik|verbs?|verbos?|verben|prepositions?|preposicoes|preposiciones|prapositionen|cases?|dativ|akkusativ)\b/u,
  "vocabulary-review": /\b(vocabulary|words?|vocabulario|palavras?|palabras?|wortschatz|worter)\b/u,
} as const;

/** Deterministic and offline. Ambiguous requests get one explicit activity choice, never a chat loop. */
export function interpretNinaRequest(value: NinaRequest): NinaGenerationRequest["kind"] | null {
  const request = ninaRequestSchema.parse(value);
  if (request.kind) return request.kind;
  const text = request.naturalRequest.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const matches = Object.entries(intentWords).filter(([, pattern]) => pattern.test(text));
  const match = matches.length === 1 ? matches[0] : undefined;
  return match ? (match[0] as keyof typeof intentWords) : null;
}

export function ninaExerciseCount(minutes: number) {
  return Math.max(3, Math.min(12, Math.round(minutes / 2)));
}

/** Conservative matching: only an identical saved request is offered as suitable prepared content. */
export function matchesNinaRequest(left: string, right: string) {
  const normalize = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();
  return normalize(left) === normalize(right);
}
