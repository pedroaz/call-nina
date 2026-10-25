import {
  activityIdSchema,
  voiceActivityDraftCandidateSchema,
  voiceActivityContextSchema,
} from "@call-nina/contracts";
import { generatePracticeActivity } from "./generatePracticeActivity.js";
import { invokeDesktop } from "./ipc.js";
import type { PracticeKind } from "./PracticeTypeChooser.js";
import type { useLearningOperation } from "./useLearningOperation.js";

/** The same topic defaults and generation routes are used by Home and Practice. */
export const practiceDefaults = { exerciseCount: 6, cardCount: 10 } as const;
export async function startTopicPractice(
  {
    kind,
    topic,
    targetLevel,
    count,
  }: {
    kind: PracticeKind;
    topic: string;
    targetLevel: "a1" | "a2" | "b1" | "b2";
    count?: number;
  },
  run: ReturnType<typeof useLearningOperation>["run"],
) {
  const naturalRequest = topic.trim();
  if (kind === "flashcards") {
    const result = await run({
      kind: "flashcard-generation",
      topic: naturalRequest,
      targetLevel,
      cardCount: count ?? practiceDefaults.cardCount,
    });
    return activityIdSchema.parse(result.activityId);
  }
  if (kind === "listening" || kind === "speaking") {
    const settings = {
      targetLevel,
      difficulty: "intermediate",
      correctionTiming: "after-each",
      ...(kind === "speaking" ? { speakingPace: "normal" as const } : {}),
    } as const;
    const result = await run({
      kind: "voice-activity-draft",
      voiceKind: kind,
      naturalRequest,
      ...settings,
    });
    if (result.status !== "validated" || !result.learningScope)
      throw new Error("OD_LEARNING_CONTEXT_REQUIRED");
    const output = voiceActivityDraftCandidateSchema.parse(result.output);
    const prepared = await invokeDesktop("codex-activity/prepare", {
      draftModelRequestId: result.modelRequestId,
      title: output.scenario.slice(0, 160),
      context: voiceActivityContextSchema.parse({
        schemaVersion: 1,
        kind,
        ...settings,
        scenario: output.scenario,
        objectives: output.objectives,
        questions: output.questions,
        answerGuidance: output.answerGuidance,
        ...(kind === "listening" && output.script ? { script: output.script } : {}),
      }),
    });
    return prepared.activityId;
  }
  return generatePracticeActivity(
    {
      source: kind === "custom" ? "natural-request" : kind,
      naturalRequest,
      targetLevel,
      exerciseCount: count ?? practiceDefaults.exerciseCount,
    },
    run,
  );
}
