import { attemptEvidenceSchema } from "./attempt-evidence.js";
import { germanArticleSchema } from "./german-language.js";
import { learningContextSchema, targetLanguageSchema } from "./learning-context.js";
import {
  activityIdSchema,
  curriculumTopicIdSchema,
  dataRootGenerationSchema,
  historyEntryIdSchema,
  utcInstantSchema,
} from "./common.js";
import { z } from "./schema-system.js";

const text = (max: number) => z.string().trim().min(1).max(max);
const key = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u);
const localized = z.strictObject({ en: text(8000), de: text(8000) });
export const courseStageSchema = key;
export const courseSkillSchema = z.enum(["reading", "writing", "listening", "speaking"]);
export const coursePurposeSchema = z.enum([
  "input",
  "discovery",
  "practice",
  "interaction",
  "capstone",
  "review",
]);
export const courseReferenceSchema = z.strictObject({
  version: text(40),
  unitId: key,
  activityKey: key,
  mode: z.enum(["course", "review"]),
  retrieval: z.enum(["recognition", "recall", "use"]).optional(),
});
export const courseObjectiveSchema = z.strictObject({
  id: key,
  skills: z.array(courseSkillSchema).min(1).max(4),
  modes: z
    .array(z.enum(["reception", "production", "interaction", "mediation"]))
    .min(1)
    .max(4),
  critical: z.boolean(),
  description: localized,
  criterion: localized,
});
export const courseTargetSchema = z.strictObject({
  id: key,
  kind: z.enum(["word", "chunk", "construction", "pronunciation", "pragmatics"]),
  german: text(500),
  meaning: localized,
  example: text(500),
  exampleMeaning: localized.optional(),
  article: germanArticleSchema.optional(),
  plural: text(160).optional(),
  pattern: text(160).optional(),
  function: text(160).optional(),
  register: z.enum(["informal", "formal", "neutral"]).optional(),
});
export const courseActivitySchema = z.strictObject({
  id: key,
  title: localized,
  purpose: coursePurposeSchema,
  delivery: z.enum(["explanation", "practice", "reading", "writing", "listening", "speaking"]),
  objectiveIds: z.array(key).max(5),
  targetIds: z.array(key).max(40),
  instructions: localized,
  input: text(6000).optional(),
  questions: z.array(localized).max(8),
  answers: z.array(localized).max(8),
  exerciseCount: z.int().min(1).max(6),
});
export const courseUnitSchema = z.strictObject({
  id: key,
  stage: courseStageSchema,
  kind: z.enum(["module", "launchpad", "checkpoint"]),
  title: localized,
  scenario: localized,
  curriculumTopicIds: z.array(curriculumTopicIdSchema).min(1).max(4),
  prerequisites: z.array(key).max(15),
  grammar: localized,
  explanation: localized,
  examples: z
    .array(z.strictObject({ german: text(500), meaning: localized }))
    .min(1)
    .max(20),
  objectives: z.array(courseObjectiveSchema).min(1).max(5),
  targetIds: z.array(key).min(1).max(60),
  reviewTargetIds: z.array(key).max(60),
  activities: z.array(courseActivitySchema).min(1).max(16),
  variants: z
    .array(z.strictObject({ id: key, facts: localized }))
    .min(1)
    .max(8),
  sourceIds: z.array(key).min(1).max(10),
});
export const learningCourseSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    courseId: key,
    targetLanguage: targetLanguageSchema,
    version: text(40),
    sources: z
      .array(
        z.strictObject({
          id: key,
          title: text(300),
          url: z.url().startsWith("https://"),
          publisher: text(160),
          reviewedOn: z.iso.date(),
          claim: text(1000),
        }),
      )
      .min(1)
      .max(20),
    targets: z.array(courseTargetSchema).min(1).max(1000),
    units: z.array(courseUnitSchema).min(1).max(200),
  })
  .superRefine((course, ctx) => {
    const issue = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    const ids = new Set<string>();
    const objectives = new Set<string>();
    const targets = new Set(course.targets.map((t) => t.id));
    const introduced = new Set<string>();
    if (course.targets.some((t) => ["word", "chunk"].includes(t.kind) && !t.exampleMeaning))
      issue("Lexical examples require matching meanings");
    if (targets.size !== course.targets.length) issue("Duplicate language target");
    for (const unit of course.units) {
      if (ids.has(unit.id) || unit.prerequisites.some((id) => !ids.has(id)))
        issue("Invalid unit order or identity");
      ids.add(unit.id);
      for (const objective of unit.objectives) {
        if (objectives.has(objective.id)) issue("Duplicate objective");
        objectives.add(objective.id);
      }
      if (
        unit.targetIds.some((id) => !targets.has(id)) ||
        unit.reviewTargetIds.some((id) => !introduced.has(id))
      )
        issue("Invalid language target or spiral link");
      unit.targetIds.forEach((id) => introduced.add(id));
      const activityIds = new Set<string>();
      for (const activity of unit.activities) {
        if (activityIds.has(activity.id)) issue("Duplicate activity");
        activityIds.add(activity.id);
        if (activity.objectiveIds.some((id) => !unit.objectives.some((o) => o.id === id)))
          issue("Unknown objective");
        if (
          activity.targetIds.some(
            (id) => !unit.targetIds.includes(id) && !unit.reviewTargetIds.includes(id),
          )
        )
          issue("Unknown activity target");
        if (activity.questions.length !== activity.answers.length) issue("Input guidance mismatch");
        if (activity.delivery === "listening" && (!activity.input || !activity.questions.length))
          issue("Listening input required");
      }
      if (unit.objectives.some((o) => !unit.activities.some((a) => a.objectiveIds.includes(o.id))))
        issue("Unassessed objective");
      if (new Set(unit.variants.map((v) => v.id)).size !== unit.variants.length)
        issue("Duplicate scenario variant");
      if (unit.sourceIds.some((id) => !course.sources.some((s) => s.id === id)))
        issue("Unknown course source");
    }
  });
export const courseSupportSchema = z.enum([
  "hint",
  "model-answer",
  "translation",
  "transcript",
  "repetition",
  "slow-delivery",
  "repeat-attempt",
]);
export const courseEvidenceSchema = z.strictObject({
  objectiveId: key,
  skill: courseSkillSchema,
  outcome: z.enum(["not-yet", "supported", "independent", "transfer", "not-evaluated"]),
  support: z.array(courseSupportSchema).max(7),
  retrieval: z.enum(["recognition", "recall", "use"]).optional(),
  evidence: text(1000),
  uncertainty: z.enum(["none", "some", "substantial"]),
});
export const courseMissionSchema = z.strictObject({
  id: key,
  version: text(40),
  unitId: key,
  variantId: key,
  mode: z.enum(["course", "review"]),
  startedAt: utcInstantSchema,
  facts: text(4000),
});
export const courseActivityResultSchema = z.strictObject({
  reference: courseReferenceSchema,
  activityId: activityIdSchema,
  missionId: key,
  variantId: key,
  preparedAt: utcInstantSchema,
  completed: z.boolean(),
  historyEntryIds: z.array(historyEntryIdSchema).max(100),
  evidence: z
    .array(
      courseEvidenceSchema.extend({
        occurredAt: utcInstantSchema,
        historyEntryId: historyEntryIdSchema,
        attemptEvidence: attemptEvidenceSchema.nullable(),
      }),
    )
    .max(500),
});
export const learningPathStateSchema = z.strictObject({
  selectedStage: courseStageSchema,
  current: courseReferenceSchema.nullable(),
  missions: z.array(courseMissionSchema).max(2000),
  marks: z
    .array(
      z.strictObject({
        reference: courseReferenceSchema,
        status: z.enum(["completed", "skipped", "not-started"]),
        updatedAt: utcInstantSchema,
      }),
    )
    .max(2000),
  activities: z.array(courseActivityResultSchema).max(2000),
});
export const learningPathSnapshotSchema = z.strictObject({
  learningContext: learningContextSchema,
  rootGeneration: dataRootGenerationSchema,
  course: learningCourseSchema.nullable(),
  state: learningPathStateSchema,
});
export const learningPathUpdateSchema = z.strictObject({
  expectedGeneration: dataRootGenerationSchema,
  reference: courseReferenceSchema,
  action: z.enum(["select", "complete-explanation", "skip", "reopen", "new-mission"]),
});
export const courseTeachingContextSchema = z.strictObject({
  objectives: z
    .array(
      z.strictObject({
        id: key,
        targetId: key.optional(),
        skills: z.array(courseSkillSchema).min(1).max(4),
        description: text(1000),
        criterion: text(1000),
      }),
    )
    .max(5),
  purpose: coursePurposeSchema,
  priorFeedback: z.boolean(),
  delivery: courseActivitySchema.shape.delivery,
  mission: courseMissionSchema,
  targetIds: z.array(key).max(60),
  foundation: text(24000),
});
export type LearningCourse = z.infer<typeof learningCourseSchema>;
export type CourseReference = z.infer<typeof courseReferenceSchema>;
export type CourseUnit = z.infer<typeof courseUnitSchema>;
export type CourseActivity = z.infer<typeof courseActivitySchema>;
export type CourseMission = z.infer<typeof courseMissionSchema>;
export type LearningPathState = z.infer<typeof learningPathStateSchema>;
export type CourseEvidence = z.infer<typeof courseEvidenceSchema>;
export type CourseTeachingContext = z.infer<typeof courseTeachingContextSchema>;
