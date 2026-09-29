import {
  learningCourseSchema,
  learningContextSchema,
  learningScopeSchema,
  type LearningScope,
} from "@call-nina/contracts";
import { learnerProfileSchema, type LearnerProfile } from "./learner-profile.js";

export const supportedCourse = { courseId: "german-foundations", targetLanguage: "de" } as const;

export function resolveLearningContext(scopeValue: LearningScope, profileValue: LearnerProfile) {
  const scope = learningScopeSchema.parse(scopeValue);
  const profile = learnerProfileSchema.parse(profileValue);
  if (
    scope.learnerId !== profile.learnerId ||
    scope.targetLanguage !== profile.targetLanguage ||
    (scope.courseId !== null &&
      (scope.courseId !== supportedCourse.courseId || scope.targetLanguage !== "de"))
  )
    throw new Error("OD_LEARNING_CONTEXT_UNSUPPORTED");
  return learningContextSchema.parse({
    ...scope,
    explanationLanguage: profile.explanationLanguage,
    goal: {
      purpose: "everyday-life",
      description: profile.everydayLifeGoal,
      motivation: profile.motivation,
      targetLevel: profile.levelEstimate.targetLevel,
      interests: profile.interests,
      preferredTopics: profile.preferredTopics,
    },
  });
}

/** Product policy for the only packaged course, separate from generic wire validation. */
export function parseSupportedLearningCourse(value: unknown) {
  const course = learningCourseSchema.parse(value);
  if (
    course.courseId !== supportedCourse.courseId ||
    course.targetLanguage !== supportedCourse.targetLanguage
  )
    throw new Error("OD_COURSE_UNSUPPORTED");
  if (
    course.units.length !== 15 ||
    course.units.filter((unit) => unit.kind === "launchpad").length !== 1 ||
    course.units.filter((unit) => unit.kind === "checkpoint").length !== 2 ||
    ["a1-1", "a1-2"].some(
      (stage) =>
        course.units.filter((unit) => unit.stage === stage && unit.kind === "module").length !== 6,
    ) ||
    course.units.some(
      (unit) =>
        !["a1-1", "a1-2"].includes(unit.stage) ||
        unit.examples.length < 3 ||
        unit.objectives.length < 3 ||
        unit.activities.length < 3 ||
        unit.variants.length < 3 ||
        new Set(unit.objectives.flatMap((objective) => objective.skills)).size !== 4 ||
        !unit.activities.some((activity) => activity.purpose === "capstone"),
    )
  )
    throw new Error("OD_COURSE_STRUCTURE_INVALID");
  return course;
}
