import {
  utcInstantSchema,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import { evaluateExerciseAnswer } from "@call-nina/domain";
import { exerciseHistoryPrompt, opaqueId } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class HistoryService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root">;

  get #root() {
    return this.#services().root;
  }
  constructor(environment: DesktopEnvironment, services: () => Pick<DesktopServices, "root">) {
    this.#environment = environment;
    this.#services = services;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      { channel: "history/read" | "history/mistake-amend" | "history/delete" }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "history/read": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (dataRoot.status !== "ready" || !this.#root.repository) {
          return this.#environment.failure(request, "stale-data-root");
        }
        const [history, mistakePatterns, allTimeSkillTotals] = await Promise.all([
          this.#root.repository.listHistory(request.payload),
          this.#root.repository.listMistakePatterns({
            ...(request.payload.fromDate ? { fromDate: request.payload.fromDate } : {}),
            ...(request.payload.toDate ? { toDate: request.payload.toDate } : {}),
            ...(request.payload.curriculumTopicId
              ? { curriculumTopicId: request.payload.curriculumTopicId }
              : {}),
            ...(request.payload.mistakeCategory
              ? { mistakeCategory: request.payload.mistakeCategory }
              : {}),
            maximum: 50,
          }),
          this.#root.repository.readHistorySkillTotals(),
        ]);
        return this.#environment.success(request, {
          rootGeneration: dataRoot.generation,
          mistakePatterns,
          allTimeSkillTotals,
          nextCursor: history.nextCursor,
          entries: history.entries.map((entry) => {
            const detail =
              entry.detail.kind === "reference" || entry.detail.kind === "attempt-feedback"
                ? entry.detail
                : entry.detail.kind === "exercise-attempt"
                  ? {
                      kind: entry.detail.kind,
                      readingMaterial: entry.detail.readingMaterial,
                      activityId: entry.detail.activityId,
                      ...(entry.detail.translation
                        ? { translation: entry.detail.translation }
                        : {}),
                      answerLanguage:
                        entry.detail.snapshot.exercise.kind === "vocabulary-recall" &&
                        entry.detail.snapshot.exercise.content.direction === "recognition"
                          ? null
                          : entry.targetLanguage,
                      exerciseKind: entry.detail.snapshot.exercise.kind,
                      instructions: entry.detail.snapshot.exercise.instructions,
                      prompt: exerciseHistoryPrompt(entry.detail.snapshot.exercise),
                      answer: entry.detail.answer,
                      objectiveEvaluations: entry.detail.objectiveEvaluations.map(
                        ({ outcome, evidence }) => ({ outcome, evidence }),
                      ),
                      feedback: {
                        summary: entry.detail.feedback.summary,
                        strengths: entry.detail.feedback.strengths,
                        improvements: entry.detail.feedback.improvements,
                        ...(entry.detail.feedback.nextStep
                          ? { nextStep: entry.detail.feedback.nextStep }
                          : {}),
                      },
                      feedbackProvenance: entry.detail.feedbackProvenance,
                      acceptedAnswerReveal: evaluateExerciseAnswer(
                        entry.detail.snapshot.exercise,
                        entry.detail.answer,
                        entry.targetLanguage,
                      ).acceptedAnswerReveal,
                      suggestedAnswer: entry.detail.suggestedAnswer,
                    }
                  : entry.detail.kind === "voice-summary" ||
                      entry.detail.kind === "placement" ||
                      entry.detail.kind === "listening"
                    ? entry.detail
                    : {
                        kind: entry.detail.kind,
                        learnerText: entry.detail.learnerText,
                        correctedText: entry.detail.correctedText,
                        vocabularyCandidates: entry.detail.vocabularyCandidates,
                        feedback: {
                          summary: entry.detail.feedback.summary,
                          strengths: entry.detail.feedback.strengths,
                          improvements: entry.detail.feedback.improvements,
                          ...(entry.detail.feedback.nextStep
                            ? { nextStep: entry.detail.feedback.nextStep }
                            : {}),
                          overallUncertainty: entry.detail.feedback.overallUncertainty,
                        },
                        provenance:
                          entry.detail.aiProvenance.modelSelection.availability === "reported"
                            ? {
                                availability: "reported" as const,
                                modelRequestId: entry.detail.aiProvenance.modelRequestId,
                                generatedAt: entry.detail.aiProvenance.generatedAt,
                                modelId: entry.detail.aiProvenance.modelSelection.modelId,
                                effortId: entry.detail.aiProvenance.modelSelection.effortId,
                              }
                            : {
                                availability: "not-reported" as const,
                                modelRequestId: entry.detail.aiProvenance.modelRequestId,
                                generatedAt: entry.detail.aiProvenance.generatedAt,
                              },
                        changes: entry.detail.changes,
                      };
            return {
              historyEntryId: entry.historyEntryId,
              targetLanguage: entry.targetLanguage,
              activityAvailable: entry.activityAvailable,
              evidence: entry.evidence,
              entityKind: entry.entityKind,
              skill: entry.skill,
              activityType: entry.activityType,
              title: entry.title,
              occurredAt: entry.occurredAt,
              curriculumTopicIds: entry.curriculumTopicIds,
              mistakeCategories: entry.mistakeCategories,
              detail,
            };
          }),
        });
      }
      case "history/mistake-amend": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (dataRoot.status !== "ready" || !this.#root.repository) {
          return this.#environment.failure(request, "stale-data-root");
        }
        if (dataRoot.generation !== request.payload.expectedGeneration) {
          return this.#environment.failure(request, "stale-data-root");
        }
        const amendedAt = utcInstantSchema.parse(new Date().toISOString());
        await this.#root.repository.amendMistakeClassification({
          amendmentId: opaqueId("amendment"),
          mistakeId: request.payload.mistakeId,
          effectiveCategory: request.payload.effectiveCategory,
          ...(request.payload.note ? { note: request.payload.note } : {}),
          amendedAt,
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "history" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          mistakeId: request.payload.mistakeId,
          rootGeneration: dataRoot.generation,
          status: "amended",
        });
      }
      case "history/delete": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.deleteHistoryEntry(
          request.payload.historyEntryId,
          new Date().toISOString(),
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "history" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          historyEntryId: request.payload.historyEntryId,
          status: "deleted",
        });
      }
    }
  }
}
