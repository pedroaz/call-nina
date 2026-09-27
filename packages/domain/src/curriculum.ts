import {
  calendarDateSchema,
  curriculumTopicIdSchema,
  strictBoundaryObject,
  z,
} from "@call-nina/contracts";

import { cefrBandSchema } from "./learner-profile.js";

const text = (maximum: number) => z.string().min(1).max(maximum).regex(/\S/u);
const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const curriculumDomains = [
  "personal-social-life",
  "housing-neighborhood",
  "shopping-services",
  "food",
  "transport-travel",
  "health-appointments",
  "work",
  "education-language-learning",
  "public-administration-residency",
  "digital-communication-media",
  "leisure-culture",
  "safety-emergencies",
] as const;
export const curriculumDomainSchema = z.enum(curriculumDomains);

export const curriculumSourceIdSchema = z.string().regex(/^curriculum-source_[0-9a-z]{16,64}$/u);

const mappedCoverageDimensionSchema = z.strictObject({
  status: z.literal("mapped"),
  outcomes: z.array(text(500)).min(1).max(20),
});
const coverageDimensionSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-applicable") }),
  mappedCoverageDimensionSchema,
]);

export const curriculumCoverageSchema = z.strictObject({
  reception: coverageDimensionSchema,
  production: coverageDimensionSchema,
  interaction: coverageDimensionSchema,
  mediation: coverageDimensionSchema,
});

const foundationSchema = z.strictObject({ key: slugSchema, description: text(500) });

const topicIdentity = {
  schemaVersion: z.literal(1),
  topicId: curriculumTopicIdSchema,
  slug: slugSchema,
  band: cefrBandSchema,
  domain: curriculumDomainSchema,
  title: text(160),
  communicativeGoals: z.array(text(500)).min(1).max(20),
  prerequisiteTopicIds: z.array(curriculumTopicIdSchema).max(20),
  sourceIds: z.array(curriculumSourceIdSchema).min(1).max(30),
} as const;

const lessonFoundationSchema = z.strictObject({
  explanation: text(4_000),
  examples: z.array(text(500)).min(1).max(20),
});

export const curriculumTopicFrontMatterSchema = strictBoundaryObject({
  ...topicIdentity,
  grammarFoundations: z.array(foundationSchema).max(30),
  vocabularyFoundations: z.array(foundationSchema).max(60),
  lessonFoundation: lessonFoundationSchema.optional(),
  exerciseConcepts: z.array(foundationSchema).max(30),
  coverage: curriculumCoverageSchema,
}).superRefine((topic, ctx) => {
  if (
    topic.lessonFoundation &&
    (!topic.grammarFoundations.length ||
      !topic.vocabularyFoundations.length ||
      !topic.exerciseConcepts.length ||
      !Object.values(topic.coverage).some((dimension) => dimension.status === "mapped"))
  )
    ctx.addIssue({
      code: "custom",
      message: "Lesson foundations require language, exercises and mapped outcomes",
    });
});

const freshnessSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("stable") }),
  z.strictObject({ status: z.literal("time-sensitive"), reviewDueOn: calendarDateSchema }),
]);

const sourceMetadata = {
  sourceId: curriculumSourceIdSchema,
  title: text(300),
  supportedClaims: z.array(text(500)).min(1).max(30),
  retrievedOn: calendarDateSchema,
  reviewedOn: calendarDateSchema,
  freshness: freshnessSchema,
} as const;

export const curriculumSourceSchema = z
  .union([
    z.strictObject({
      ...sourceMetadata,
      sourceClass: z.enum(["official-framework", "german-public-service", "reputable-pedagogy"]),
      url: z
        .url()
        .max(2_000)
        .regex(/^https:\/\//u),
      publisher: text(200),
    }),
    z.strictObject({
      ...sourceMetadata,
      sourceClass: z.literal("repository-original"),
      repositoryPath: z
        .string()
        .max(500)
        .regex(
          /^(?:docs|content\/curriculum)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?$/u,
        ),
      publisher: z.literal("Call Nina"),
    }),
  ])
  .refine(
    ({ retrievedOn, reviewedOn, freshness }) =>
      reviewedOn >= retrievedOn &&
      (freshness.status === "stable" || freshness.reviewDueOn >= reviewedOn),
    { path: ["reviewedOn"], message: "source review chronology is invalid" },
  );

const manifestEntry = (band: "a1" | "a2" | "b1" | "b2") =>
  z.strictObject({
    topicId: curriculumTopicIdSchema,
    domain: curriculumDomainSchema,
    path: z.string().regex(new RegExp(`^topics/${band}/[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`, "u")),
  });

export const curriculumManifestSchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  snapshotVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  bands: z.strictObject({
    a1: z.array(manifestEntry("a1")).max(200),
    a2: z.array(manifestEntry("a2")).max(200),
    b1: z.array(manifestEntry("b1")).max(200),
    b2: z.array(manifestEntry("b2")).max(200),
  }),
});

export const curriculumSourceRegistrySchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  sources: z.array(curriculumSourceSchema).max(1_000),
});

export const curriculumReadPolicySchema = strictBoundaryObject({
  schemaVersion: z.literal(1),
  source: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("development-repository"),
      contentRoot: z.literal("content/curriculum"),
      mutability: z.literal("repository-authoring"),
    }),
    z.strictObject({
      mode: z.literal("packaged-snapshot"),
      resourceRoot: z.literal("resources/curriculum"),
      snapshotVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
      mutability: z.literal("read-only"),
    }),
  ]),
});

export const curriculumFilesystemLayout = {
  manifest: "manifest.yaml",
  sources: "sources.yaml",
  topics: "topics/{a1,a2,b1,b2}/*.md",
} as const;

export type CurriculumTopicFrontMatter = z.infer<typeof curriculumTopicFrontMatterSchema>;
export type CurriculumManifest = z.infer<typeof curriculumManifestSchema>;
export type CurriculumSourceRegistry = z.infer<typeof curriculumSourceRegistrySchema>;
