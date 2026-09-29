import { supportedLanguagePolicy } from "./language-policy.js";
import {
  type Language,
  learningContextSchema,
  type LearningContext,
  practiceSuggestionSchema,
  type practiceSuggestionContextSchema,
  type PracticeSuggestion,
  type z,
} from "@call-nina/contracts";

type Context = z.input<typeof practiceSuggestionContextSchema>;
const emptyContext = (): Context => ({ curriculumTopicIds: [], mistakeIds: [], vocabularyIds: [] });

export function isCurrentStudyWeek(weekStartsOn: string, today: string): boolean {
  const date = new Date(`${today.slice(0, 10)}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return weekStartsOn === date.toISOString().slice(0, 10);
}

export function buildPracticeSuggestions(input: {
  rootGeneration: number;
  today: string;
  locale: Language;
  level: string;
  learningContext: LearningContext;
  dueVocabulary: readonly { vocabularyId: string; lemma: string }[];
  recurringMistakes: readonly {
    mistakeId: string;
    category: { kind: "grammar" | "vocabulary"; categoryKey: string; lemma?: string };
    occurrenceCount: number;
  }[];
}): PracticeSuggestion[] {
  const context = learningContextSchema.parse(input.learningContext);
  const policy = supportedLanguagePolicy(context.targetLanguage);
  const de = input.locale === "de";
  const make = (
    id: string,
    source: PracticeSuggestion["source"],
    kind: PracticeSuggestion["kind"],
    title: string,
    naturalRequest: string,
    rationale: string,
    estimatedMinutes = 10,
    context = emptyContext(),
  ): PracticeSuggestion =>
    practiceSuggestionSchema.parse({
      id,
      rootGeneration: input.rootGeneration,
      source,
      kind,
      title: title.slice(0, 160),
      naturalRequest: naturalRequest.slice(0, 1_000),
      rationale,
      estimatedMinutes,
      context,
    });
  const review: PracticeSuggestion[] = [];
  if (input.dueVocabulary.length) {
    const words = input.dueVocabulary.slice(0, 12);
    review.push(
      make(
        "due-vocabulary",
        "due-vocabulary",
        "vocabulary-review",
        de ? "Fällige Wörter wiederholen" : "Review your due words",
        de
          ? "Rufe die Bedeutung deiner fälligen Wörter ab und bilde jeweils einen Satz."
          : "Recall the meaning of your due words and use each in a sentence.",
        de ? "Diese Wörter sind jetzt zur Wiederholung fällig." : "These words are due for review.",
        5,
        { ...emptyContext(), vocabularyIds: words.map(({ vocabularyId }) => vocabularyId) },
      ),
    );
  }
  for (const mistake of input.recurringMistakes.slice(0, 4)) {
    const topic = mistake.category.lemma ?? mistake.category.categoryKey.replace(/[-_]/gu, " ");
    review.push(
      make(
        `mistake:${mistake.mistakeId}`,
        "mistake",
        mistake.category.kind === "grammar" ? "grammar" : "custom-lesson",
        de ? `Übe: ${topic}` : `Practise: ${topic}`,
        policy.practiceRequest("mistake", context.explanationLanguage, topic, input.level),
        de
          ? `Dieses Muster kam ${String(mistake.occurrenceCount)} Mal vor.`
          : `This pattern appeared ${String(mistake.occurrenceCount)} times.`,
        10,
        { ...emptyContext(), mistakeIds: [mistake.mistakeId] },
      ),
    );
  }
  const topic =
    context.goal.preferredTopics[0] ?? context.goal.interests[0] ?? context.goal.description;
  const reason = de
    ? `Passend zu deinem Niveau ${input.level.toUpperCase()}.`
    : `Matched to your ${input.level.toUpperCase()} level.`;
  const starters = [
    make(
      "starter:writing",
      "starter",
      "writing",
      de ? "Eine kurze Nachricht schreiben" : "Write a short message",
      policy.practiceRequest("writing", context.explanationLanguage, topic, input.level),
      reason,
    ),
    make(
      "starter:reading",
      "starter",
      "reading",
      de ? "Lesen und verstehen" : "Read and understand",
      policy.practiceRequest("reading", context.explanationLanguage, topic, input.level),
      reason,
    ),
    make(
      "starter:speaking",
      "starter",
      "voice-speaking",
      de ? "Einen Termin vereinbaren" : "Arrange an appointment",
      policy.practiceRequest("speaking", context.explanationLanguage, topic, input.level),
      reason,
    ),
    make(
      "starter:grammar",
      "starter",
      "grammar",
      de ? "Sicherere Sätze bilden" : "Build clearer sentences",
      policy.practiceRequest("grammar", context.explanationLanguage, topic, input.level),
      reason,
    ),
    make(
      "starter:listening",
      "starter",
      "codex-listening",
      de ? "Eine Alltagssituation hören" : "Listen to an everyday situation",
      policy.practiceRequest("listening", context.explanationLanguage, topic, input.level),
      reason,
    ),
    make(
      "starter:lesson",
      "starter",
      "custom-lesson",
      de ? "Wörter im Alltag verwenden" : "Use words in everyday life",
      policy.practiceRequest("lesson", context.explanationLanguage, topic, input.level),
      reason,
    ),
  ];
  // Interleave evidence-based review and independent practice.
  const candidates: PracticeSuggestion[] = [];
  for (let i = 0; i < Math.max(review.length, starters.length); i += 1) {
    for (const group of [review, starters]) {
      const item = group[i];
      if (item) candidates.push(item);
    }
  }
  const seen = new Set<string>();
  const firstKinds = new Set<PracticeSuggestion["kind"]>();
  const leading: PracticeSuggestion[] = [];
  const remaining: PracticeSuggestion[] = [];
  for (const item of candidates) {
    const key = `${item.kind}:${item.naturalRequest.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (leading.length < 3 && !firstKinds.has(item.kind)) {
      leading.push(item);
      firstKinds.add(item.kind);
    } else remaining.push(item);
  }
  return [...leading, ...remaining].slice(0, 24);
}
