import {
  activityIdSchema,
  attemptIdSchema,
  calendarDateSchema,
  correctionIdSchema,
  curriculumTopicIdSchema,
  mistakeIdSchema,
  strictBoundaryObject,
  utcInstantSchema,
  z,
} from "@call-nina/contracts";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const categoryKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);

export const mistakeCategorySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("grammar"),
    categoryKey: categoryKeySchema,
    curriculumTopicIds: z.array(curriculumTopicIdSchema).max(12),
  }),
  z.strictObject({
    kind: z.literal("vocabulary"),
    categoryKey: categoryKeySchema,
    lemma: text(160),
  }),
]);

export const mistakeEvidenceSpanSchema = z.strictObject({
  beforeContext: z.string().max(500),
  evidenceText: text(1_000),
  afterContext: z.string().max(500),
});

export const mistakeOccurrenceSchema = z.strictObject({
  correctionId: correctionIdSchema,
  attemptId: attemptIdSchema,
  alignmentSegmentPosition: z.int().nonnegative().max(499),
  observedOn: calendarDateSchema,
  evidence: mistakeEvidenceSpanSchema,
  explanation: text(800),
});

const singleOccurrenceSchema = z.strictObject({
  status: z.literal("single-occurrence"),
  occurrence: mistakeOccurrenceSchema,
});

const recurringOccurrencesSchema = z
  .strictObject({
    status: z.literal("recurring"),
    occurrences: z.array(mistakeOccurrenceSchema).min(2).max(100),
  })
  .refine(
    ({ occurrences }) => {
      const references = occurrences.map(
        ({ correctionId, alignmentSegmentPosition }) =>
          `${correctionId}:${String(alignmentSegmentPosition)}`,
      );
      return new Set(references).size === references.length;
    },
    { path: ["occurrences"], message: "recurrence evidence must be distinct" },
  );

export const mistakeRecurrenceSchema = z.union([
  singleOccurrenceSchema,
  recurringOccurrencesSchema,
]);

const learnerAmendmentSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unchanged") }),
  z.strictObject({
    status: z.literal("amended"),
    category: mistakeCategorySchema,
    amendedAt: utcInstantSchema,
    note: text(500).optional(),
  }),
]);

export const mistakeClassificationSchema = z
  .strictObject({
    inferredCategory: mistakeCategorySchema,
    learnerAmendment: learnerAmendmentSchema,
  })
  .refine(
    ({ inferredCategory, learnerAmendment }) =>
      learnerAmendment.status === "unchanged" ||
      JSON.stringify(inferredCategory) !== JSON.stringify(learnerAmendment.category),
    {
      path: ["learnerAmendment", "category"],
      message: "amendment must change the category",
    },
  );

export const mistakeDispositionSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("active") }),
  z.strictObject({
    status: z.literal("dismissed"),
    dismissedAt: utcInstantSchema,
    reason: z.enum(["not-a-mistake", "not-useful", "duplicate", "other"]),
  }),
]);

export const targetedPracticeLinkSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-created") }),
  z.strictObject({
    status: z.literal("created"),
    activityId: activityIdSchema,
    createdAt: utcInstantSchema,
  }),
]);

export const mistakeSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  mistakeId: mistakeIdSchema,
  classification: mistakeClassificationSchema,
  recurrence: mistakeRecurrenceSchema,
  disposition: mistakeDispositionSchema,
  targetedPractice: targetedPracticeLinkSchema,
});

export const deleteMistakeCommandSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  mistakeId: mistakeIdSchema,
  deletedAt: utcInstantSchema,
});

export function effectiveMistakeCategory(
  classification: z.infer<typeof mistakeClassificationSchema>,
): z.infer<typeof mistakeCategorySchema> {
  return classification.learnerAmendment.status === "amended"
    ? classification.learnerAmendment.category
    : classification.inferredCategory;
}

export function mistakeOccurrences(
  recurrence: z.infer<typeof mistakeRecurrenceSchema>,
): readonly z.infer<typeof mistakeOccurrenceSchema>[] {
  return recurrence.status === "recurring" ? recurrence.occurrences : [recurrence.occurrence];
}

export type MistakeCategory = z.infer<typeof mistakeCategorySchema>;
export type MistakeOccurrence = z.infer<typeof mistakeOccurrenceSchema>;
export type Mistake = z.infer<typeof mistakeSchema>;
export type DeleteMistakeCommand = z.infer<typeof deleteMistakeCommandSchema>;
