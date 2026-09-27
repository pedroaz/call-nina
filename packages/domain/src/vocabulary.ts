import {
  vocabularyLexemeSchema,
  vocabularyExampleSchema,
  activityIdSchema,
  attemptIdSchema,
  calendarDateSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  reviewIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  vocabularyIdSchema,
  z,
} from "@call-nina/contracts";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);

export const vocabularyReviewGrades = ["again", "hard", "good", "easy"] as const;
export const vocabularyReviewGradeSchema = z.enum(vocabularyReviewGrades);

export const vocabularySourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("correction"),
    correctionId: correctionIdSchema,
    attemptId: attemptIdSchema,
    context: text(500),
  }),
  z.strictObject({
    kind: z.literal("activity"),
    activityId: activityIdSchema,
    context: text(500),
  }),
  z.strictObject({
    kind: z.literal("curriculum"),
    curriculumTopicId: curriculumTopicIdSchema,
    context: text(500),
  }),
  z.strictObject({
    kind: z.literal("learner"),
    context: text(500),
  }),
]);

export const vocabularyCandidateOriginSchema = z.enum([
  "correction",
  "exercise",
  "goal",
  "topic",
  "curriculum",
  "mistake",
]);

export const vocabularyCandidateSchema = strictBoundaryObject({
  lemma: text(160),
  meaning: text(500),
  article: z.enum(["der", "die", "das"]).optional(),
  plural: text(160).optional(),
  example: text(500),
  sourceContext: text(500),
  origin: vocabularyCandidateOriginSchema,
});

export const vocabularyLessonSetRequestSchema = strictBoundaryObject({
  requestedFrom: z.enum(["desktop", "codex"]),
  title: text(160),
  naturalRequest: text(1_000),
  goal: text(500).optional(),
  topic: text(160).optional(),
  curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
  mistakeCategories: z.array(text(120)).max(12),
  candidates: z.array(vocabularyCandidateSchema).min(1).max(50),
});

export type VocabularyCandidate = z.infer<typeof vocabularyCandidateSchema>;
export type VocabularyLessonSetRequest = z.infer<typeof vocabularyLessonSetRequestSchema>;

/**
 * Convert a bounded candidate into the learner-facing entry shape. The model
 * may omit morphology; missing article/plural data is represented explicitly
 * instead of being guessed and presented as fact.
 */
export function vocabularyEntryFromCandidate(input: {
  vocabularyId: string;
  candidate: VocabularyCandidate;
  source: VocabularySource;
  exampleMeaning?: string;
}): VocabularyEntry {
  const candidate = vocabularyCandidateSchema.parse(input.candidate);
  const lexeme = candidate.article
    ? {
        partOfSpeech: "noun" as const,
        nounForm: {
          gender:
            candidate.article === "der"
              ? ("masculine" as const)
              : candidate.article === "die"
                ? ("feminine" as const)
                : ("neuter" as const),
          article: candidate.article,
        },
        plural: candidate.plural
          ? { status: "form" as const, form: candidate.plural }
          : { status: "unknown" as const },
      }
    : { partOfSpeech: "other" as const };
  return vocabularyEntrySchema.parse({
    schemaVersion: 1,
    vocabularyId: input.vocabularyId,
    lemma: candidate.lemma,
    meaning: candidate.meaning,
    lexeme,
    examples: [{ german: candidate.example, meaning: input.exampleMeaning ?? candidate.meaning }],
    source: input.source,
    state: { status: "candidate", confirmation: "required" },
  });
}

const newReviewScheduleSchema = z.strictObject({
  status: z.literal("new"),
  dueOn: calendarDateSchema,
  stage: z.literal(1),
});

const reviewedScheduleSchema = z
  .strictObject({
    status: z.literal("reviewed"),
    dueOn: calendarDateSchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    lastReview: z.strictObject({
      reviewId: reviewIdSchema,
      reviewedAt: utcInstantSchema,
      grade: vocabularyReviewGradeSchema,
    }),
  })
  .refine(({ dueOn, lastReview }) => dueOn >= lastReview.reviewedAt.slice(0, 10), {
    path: ["dueOn"],
    message: "due date cannot precede the last review",
  });

export const vocabularyReviewScheduleSchema = z.union([
  newReviewScheduleSchema,
  reviewedScheduleSchema,
]);

function scheduleFollowsConfirmation(
  schedule: z.infer<typeof vocabularyReviewScheduleSchema>,
  confirmedAt: z.infer<typeof utcInstantSchema>,
): boolean {
  return (
    schedule.dueOn >= confirmedAt.slice(0, 10) &&
    (schedule.status === "new" || schedule.lastReview.reviewedAt >= confirmedAt)
  );
}

const candidateVocabularyStateSchema = z.strictObject({
  status: z.literal("candidate"),
  confirmation: z.literal("required"),
});

const activeVocabularyStateSchema = z
  .strictObject({
    status: z.literal("active"),
    confirmedAt: utcInstantSchema,
    schedule: vocabularyReviewScheduleSchema,
  })
  .refine(({ schedule, confirmedAt }) => scheduleFollowsConfirmation(schedule, confirmedAt), {
    path: ["schedule"],
    message: "schedule cannot precede confirmation",
  });

const suspendedVocabularyStateSchema = z
  .strictObject({
    status: z.literal("suspended"),
    confirmedAt: utcInstantSchema,
    schedule: vocabularyReviewScheduleSchema,
    suspendedAt: utcInstantSchema,
    reason: z.enum(["learner-paused", "duplicate", "not-useful", "other"]),
  })
  .refine(
    ({ schedule, confirmedAt, suspendedAt }) =>
      scheduleFollowsConfirmation(schedule, confirmedAt) &&
      suspendedAt >= confirmedAt &&
      (schedule.status === "new" || suspendedAt >= schedule.lastReview.reviewedAt),
    {
      path: ["suspendedAt"],
      message: "suspension chronology is invalid",
    },
  );

export const vocabularyStateSchema = z.union([
  candidateVocabularyStateSchema,
  activeVocabularyStateSchema,
  suspendedVocabularyStateSchema,
]);

export const vocabularyEntrySchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  vocabularyId: vocabularyIdSchema,
  lemma: text(160),
  meaning: text(500),
  lexeme: vocabularyLexemeSchema,
  examples: z.array(vocabularyExampleSchema).min(1).max(12),
  source: vocabularySourceSchema,
  state: vocabularyStateSchema,
});

export const vocabularyReviewSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  vocabularyId: vocabularyIdSchema,
  transition: z
    .strictObject({
      expectedActiveState: activeVocabularyStateSchema,
      result: z.strictObject({
        reviewId: reviewIdSchema,
        reviewedAt: utcInstantSchema,
        grade: vocabularyReviewGradeSchema,
        nextSchedule: z.strictObject({
          dueOn: calendarDateSchema,
          stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
        }),
      }),
    })
    .refine(
      ({ expectedActiveState, result }) =>
        result.reviewedAt >= expectedActiveState.confirmedAt &&
        (expectedActiveState.schedule.status === "new" ||
          result.reviewedAt >= expectedActiveState.schedule.lastReview.reviewedAt) &&
        result.nextSchedule.dueOn >= result.reviewedAt.slice(0, 10),
      {
        path: ["result"],
        message: "review transition chronology is invalid",
      },
    ),
});

const reviewIntervalsByStage = Object.freeze({ 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });

function addCalendarDays(calendarDate: string, days: number): string {
  const instant = new Date(`${calendarDate}T12:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return calendarDateSchema.parse(instant.toISOString().slice(0, 10));
}

export function scheduleVocabularyReview(
  input: Readonly<{
    vocabularyId: string;
    expectedActiveState: Extract<VocabularyEntry["state"], { status: "active" }>;
    reviewId: string;
    reviewedAt: string;
    grade: VocabularyReviewGrade;
    retrievalStage: 1 | 2 | 3 | 4 | 5;
  }>,
): VocabularyReview {
  const currentStage = input.retrievalStage;
  const nextStage =
    input.grade === "again"
      ? 1
      : input.grade === "hard"
        ? currentStage
        : input.grade === "good"
          ? Math.min(5, currentStage + 1)
          : Math.min(5, currentStage + 2);
  const stage = z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .parse(nextStage);
  const baseInterval = reviewIntervalsByStage[stage];
  const intervalDays =
    input.grade === "again"
      ? 1
      : input.grade === "hard"
        ? Math.max(1, Math.floor(baseInterval / 2))
        : baseInterval;
  const reviewedAt = utcInstantSchema.parse(input.reviewedAt);
  return vocabularyReviewSchema.parse({
    schemaVersion: 1,
    vocabularyId: input.vocabularyId,
    transition: {
      expectedActiveState: input.expectedActiveState,
      result: {
        reviewId: input.reviewId,
        reviewedAt,
        grade: input.grade,
        nextSchedule: {
          dueOn: addCalendarDays(reviewedAt.slice(0, 10), intervalDays),
          stage,
        },
      },
    },
  });
}

export type VocabularyLexeme = z.infer<typeof vocabularyLexemeSchema>;
export type VocabularySource = z.infer<typeof vocabularySourceSchema>;
export type VocabularyReviewSchedule = z.infer<typeof vocabularyReviewScheduleSchema>;
export type VocabularyEntry = z.infer<typeof vocabularyEntrySchema>;
export type VocabularyReview = z.infer<typeof vocabularyReviewSchema>;
export type VocabularyReviewGrade = z.infer<typeof vocabularyReviewGradeSchema>;

export { vocabularyLexemeSchema, vocabularyExampleSchema } from "@call-nina/contracts";
