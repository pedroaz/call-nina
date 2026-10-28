import {
  learningCourseSchema,
  languageDefinitions,
  learningContextSchema,
  learningScopeSchema,
  type LearningScope,
} from "@call-nina/contracts";
import { learnerProfileSchema, type LearnerProfile } from "./learner-profile.js";

export function resolveLearningContext(scopeValue: LearningScope, profileValue: LearnerProfile) {
  const scope = learningScopeSchema.parse(scopeValue);
  const profile = learnerProfileSchema.parse(profileValue);
  if (
    scope.learnerId !== profile.learnerId ||
    scope.targetLanguage !== profile.targetLanguage ||
    (scope.courseId !== null &&
      scope.courseId !== languageDefinitions[scope.targetLanguage].structuredCourseId)
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

/** Catalog ownership is language-specific; each path declares its own size and sequence. */
export function parseSupportedLearningCourse(value: unknown) {
  const course = learningCourseSchema.parse(value);
  if (course.courseId !== languageDefinitions[course.targetLanguage].structuredCourseId)
    throw new Error("OD_COURSE_UNSUPPORTED");
  return course;
}
