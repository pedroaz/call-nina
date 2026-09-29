import {
  generationInputSchema,
  type GenerationInput,
  type LearningContext,
  type TranslationStart,
} from "@call-nina/contracts";

// The existing explanation-only translate route owns provider isolation and validation.
// Split only long supporting sections; never send the surrounding exercise or answer key.
export function translationParts(original: string): string[] {
  const parts: string[] = [];
  let rest = original;
  while (rest.length > 3_000) {
    let end = rest.lastIndexOf(" ", 3_000);
    if (end < 1_500) end = 3_000;
    if (/^[\uDC00-\uDFFF]$/u.test(rest[end] ?? "")) end -= 1;
    const part = rest.slice(0, end);
    if (/\S/u.test(part)) parts.push(part);
    rest = rest.slice(end);
  }
  if (/\S/u.test(rest)) parts.push(rest);
  return parts;
}

export function savedTranslationInput(
  request: TranslationStart,
  source: string,
  context: LearningContext,
): Extract<GenerationInput, { kind: "contextual-help" }> {
  const input = generationInputSchema.parse({
    kind: "contextual-help",
    learningContext: { ...context, explanationLanguage: request.language },
    activityId: request.activityId,
    intent: "translate",
    selectedText: source,
    containingSentence: source,
    question:
      "Translate only this saved supporting text faithfully. Keep quoted target-language examples unchanged. Do not solve exercises, add answers, expand hints, or add teaching material. Return the direct translation in answer.",
    calibration: {
      approximateLevel: context.goal.targetLevel.toUpperCase(),
      explanationLanguage: request.language,
      teachingProfile: "strict-corrector",
    },
    relevantMistakes: [],
    priorTurns: [],
  });
  if (input.kind !== "contextual-help") throw new Error("OD_TRANSLATION_INVALID");
  return input;
}
