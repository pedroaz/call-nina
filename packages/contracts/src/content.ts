import { exerciseGenerationCandidateSchema } from "./app-server.js";
import {
  portableContentShape,
  portableAiProvenanceSchema,
  contentExerciseRevisionSchema,
} from "./content-reference.js";
import { portableFlashcardContentSchema } from "./flashcards.js";
import { z } from "./schema-system.js";

export function contentEvaluation(kind: string) {
  return kind === "free-writing"
    ? ("requires-ai" as const)
    : kind === "short-answer"
      ? ("accepted-answer-or-ai" as const)
      : ("deterministic" as const);
}

export const portableExerciseContentSchema = z
  .strictObject({
    ...portableContentShape,
    kind: z.literal("exercise-set"),
    provenance: portableAiProvenanceSchema,
    exercises: z.array(contentExerciseRevisionSchema).min(1).max(30),
    // Contains prompts, answer keys, objectives and prepared explanations; never runtime transport state.
    payload: exerciseGenerationCandidateSchema,
  })
  .superRefine((content, ctx) => {
    if (
      JSON.stringify(content).length > 262_144 ||
      content.exercises.length !== content.payload.exercises.length ||
      new Set(content.exercises.map((item) => item.exerciseId)).size !== content.exercises.length ||
      new Set(content.exercises.map((item) => item.revisionId)).size !== content.exercises.length ||
      new Set(content.materials.map((item) => item.materialId)).size !== content.materials.length ||
      content.exercises.some(
        (item, index) =>
          item.evaluation !== contentEvaluation(content.payload.exercises[index]?.kind ?? ""),
      )
    ) {
      ctx.addIssue({ code: "custom", message: "OD_CONTENT_CAPABILITY_INVALID" });
    }
  });
export type PortableExerciseContent = z.infer<typeof portableExerciseContentSchema>;

/** Safe, content-free errors for persisted/portable boundaries, including newer versions. */
export function parsePortableExerciseContent(value: unknown): PortableExerciseContent {
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion !== 1
  )
    throw new Error("OD_CONTENT_VERSION_UNSUPPORTED");
  const parsed = portableExerciseContentSchema.safeParse(value);
  if (!parsed.success) throw new Error("OD_CONTENT_INVALID");
  return parsed.data;
}

export const portableContentSchema = z.discriminatedUnion("kind", [
  portableExerciseContentSchema,
  portableFlashcardContentSchema,
]);
export type PortableContent = z.infer<typeof portableContentSchema>;
