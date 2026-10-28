import {
  type activityIdSchema,
  contextualHelpCandidateSchema,
  correlationIdSchema,
  desktopIpcEventSchema,
  exerciseFeedbackCandidateSchema,
  exerciseGenerationCandidateSchema,
  generationProvenanceSchema,
  modelRequestIdSchema,
  writingCorrectionCandidateSchema,
  type CorrelationId,
  type DesktopIpcEvent,
  type GenerationEvent,
  type GenerationService,
} from "@call-nina/contracts";
import { DirectApiGenerationService } from "@call-nina/direct-api";
import { type CallNinaRepository } from "@call-nina/persistence";
import {
  type OperationLog,
  diagnosticErrorCode,
  maximumRetainedSubmissions,
  safeError,
  type AcceptedOperation,
} from "../backend-support.js";
import { type LearningResultService } from "./learning-results.js";

interface Dependencies {
  repository: () => Pick<CallNinaRepository, "saveGeneratedExerciseFeedback"> | undefined;
  closing: () => boolean;
  enqueue: <T>(work: () => T | Promise<T>) => Promise<T>;
  operationServices: Map<string, GenerationService>;
  releaseOperation: (id: CorrelationId) => void;
  emitEvent: ((event: DesktopIpcEvent) => void) | undefined;
  operationLog: OperationLog;
  dataRootState: (
    id: string,
  ) => Promise<
    { status: "ready"; generation: number } | { status: "unconfigured" | "unavailable" }
  >;
  learningResults: () => Pick<
    LearningResultService,
    | "persistWritingCorrection"
    | "persistFlashcards"
    | "persistTargetedPractice"
    | "persistVocabulary"
  >;
}
export class GenerationOperations {
  readonly #dependencies: Dependencies;
  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }
  get #repository() {
    return this.#dependencies.repository();
  }
  get #closing() {
    return this.#dependencies.closing();
  }

  readonly operationsBySubmission = new Map<string, AcceptedOperation>();

  readonly activeOperations = new Set<string>();

  readonly retryableOperations = new Set<string>();

  readonly helperSessions = new Map<
    string,
    {
      activityId: ReturnType<typeof activityIdSchema.parse>;
      turns: Array<{ question: string; answer: string }>;
    }
  >();

  makeOperationRoom(protectedOperationId?: string): boolean {
    for (const [submissionId, operation] of this.operationsBySubmission) {
      if (this.operationsBySubmission.size < maximumRetainedSubmissions) return true;
      if (
        this.activeOperations.has(operation.operationId) ||
        operation.operationId === protectedOperationId
      )
        continue;
      this.#dependencies.releaseOperation(correlationIdSchema.parse(operation.operationId));
      this.operationsBySubmission.delete(submissionId);
      this.retryableOperations.delete(operation.operationId);
    }
    return this.operationsBySubmission.size < maximumRetainedSubmissions;
  }

  async rejectUnsettledOperation(
    operation: AcceptedOperation["operation"],
    error?: unknown,
  ): Promise<void> {
    await this.#dependencies.enqueue(() => {
      if (
        !this.#closing &&
        error !== undefined &&
        this.#dependencies.operationServices.get(operation.operationId) instanceof
          DirectApiGenerationService
      )
        this.#dependencies.operationLog(
          "warn",
          "DESKTOP_DIRECT_API_OPERATION_FAILED",
          operation.operationId,
          operation.input.kind,
          diagnosticErrorCode(error),
          "Personal API generation did not complete.",
          { phase: "failed", outcome: "error" },
        );
      if (!this.activeOperations.delete(operation.operationId) || this.#closing) return;
      this.#dependencies.emitEvent?.({
        event: "learning-operation-finished",
        operationId: operation.operationId,
        submissionId: operation.submissionId,
        kind: operation.input.kind,
        submission: "retained",
        outcome: { status: "failed", error: safeError("app-server", operation.operationId) },
      });
    });
  }

  async handleGenerationEvent(event: GenerationEvent): Promise<void> {
    if (event.event === "operation-progress") {
      const accepted = this.operationsBySubmission.get(event.submissionId);
      if (
        !accepted ||
        accepted.operationId !== event.operationId ||
        !this.activeOperations.has(event.operationId)
      )
        return;
      this.operationsBySubmission.set(event.submissionId, {
        ...accepted,
        attempt: event.attempt,
      });
      this.#dependencies.emitEvent?.({
        event: "learning-operation-progress",
        operationId: event.operationId,
        submissionId: event.submissionId,
        kind: event.kind,
        submission: "retained",
        stage: event.stage,
        attempt: event.attempt,
      });
    } else if (event.event === "operation-state-changed") {
      const state = event.state;
      const owned = this.operationsBySubmission.get(state.submissionId);
      if (
        !owned ||
        owned.operationId !== state.operationId ||
        !this.activeOperations.has(state.operationId)
      )
        return;
      if (state.status === "validated") {
        const projectionStartedAt = performance.now();
        let savedActivityId: ReturnType<typeof activityIdSchema.parse> | undefined;
        const acceptedOperation = this.operationsBySubmission.get(state.submissionId);
        if (acceptedOperation)
          state.provenance = {
            ...state.provenance,
            connectionId: acceptedOperation.connection.id,
            capability: acceptedOperation.operation.capability ?? "text",
          };
        const root = await this.#dependencies.dataRootState(state.operationId);
        if (
          !acceptedOperation ||
          acceptedOperation.operationId !== state.operationId ||
          root.status !== "ready" ||
          acceptedOperation.dataRootGeneration !== root.generation
        ) {
          this.activeOperations.delete(state.operationId);
          this.retryableOperations.delete(state.operationId);
          this.#dependencies.emitEvent?.({
            event: "learning-operation-finished",
            operationId: state.operationId,
            submissionId: state.submissionId,
            kind: state.kind,
            submission: "retained",
            outcome: { status: "failed", error: safeError("stale-data-root", state.operationId) },
          });
          return;
        }
        if (
          state.kind === "writing-correction" ||
          state.kind === "exercise-generation" ||
          state.kind === "flashcard-generation"
        ) {
          this.#dependencies.emitEvent?.({
            event: "learning-operation-progress",
            operationId: state.operationId,
            submissionId: state.submissionId,
            kind: state.kind,
            submission: "retained",
            stage: "persisting",
            attempt: acceptedOperation.attempt ?? 1,
          });
        }
        if (state.kind === "vocabulary-analysis") {
          await this.#dependencies
            .learningResults()
            .persistVocabulary(acceptedOperation, state.output);
        }
        if (state.kind === "writing-correction") {
          const accepted = [...this.operationsBySubmission.values()].find(
            ({ operationId }) => operationId === state.operationId,
          );
          try {
            if (!accepted || !this.#repository) throw new Error("OD_WRITING_ATTEMPT_UNAVAILABLE");
            await this.#dependencies.learningResults().persistWritingCorrection(accepted, {
              operationId: state.operationId,
              submissionId: state.submissionId,
              modelRequestId: state.modelRequestId,
              provenance: state.provenance,
              output: writingCorrectionCandidateSchema.parse(state.output),
            });
          } catch (error) {
            this.#dependencies.operationLog(
              "error",
              "DESKTOP_OPERATION_PERSIST_FAILED",
              state.operationId,
              state.kind,
              diagnosticErrorCode(error),
              "Validated operation output could not be saved.",
              {
                phase: "failed",
                outcome: "error",
                durationMs: Math.round(performance.now() - projectionStartedAt),
              },
            );
            this.activeOperations.delete(state.operationId);
            this.#dependencies.emitEvent?.({
              event: "learning-operation-finished",
              operationId: state.operationId,
              submissionId: state.submissionId,
              kind: state.kind,
              submission: "retained",
              outcome: { status: "failed", error: safeError("database", state.operationId) },
            });
            return;
          }
        } else if (state.kind === "exercise-generation" || state.kind === "flashcard-generation") {
          const accepted = [...this.operationsBySubmission.values()].find(
            ({ operationId }) => operationId === state.operationId,
          );
          try {
            if (!accepted || !this.#repository) {
              throw new Error("OD_TARGETED_PRACTICE_UNAVAILABLE");
            }
            savedActivityId =
              state.kind === "flashcard-generation"
                ? await this.#dependencies
                    .learningResults()
                    .persistFlashcards(accepted, state.output, state.provenance)
                : await this.#dependencies.learningResults().persistTargetedPractice(accepted, {
                    modelRequestId: state.modelRequestId,
                    provenance: state.provenance,
                    output: exerciseGenerationCandidateSchema.parse(state.output),
                  });
          } catch (error) {
            this.#dependencies.operationLog(
              "error",
              "DESKTOP_OPERATION_PERSIST_FAILED",
              state.operationId,
              state.kind,
              diagnosticErrorCode(error),
              "Validated operation output could not be saved.",
              {
                phase: "failed",
                outcome: "error",
                durationMs: Math.round(performance.now() - projectionStartedAt),
              },
            );
            this.activeOperations.delete(state.operationId);
            this.#dependencies.emitEvent?.({
              event: "learning-operation-finished",
              operationId: state.operationId,
              submissionId: state.submissionId,
              kind: state.kind,
              submission: "retained",
              outcome: { status: "failed", error: safeError("database", state.operationId) },
            });
            return;
          }
        } else if (state.kind === "contextual-help") {
          const accepted = [...this.operationsBySubmission.values()].find(
            ({ operationId }) => operationId === state.operationId,
          );
          const session = accepted?.helperSessionId
            ? this.helperSessions.get(accepted.helperSessionId)
            : undefined;
          if (accepted && session && accepted.operation.input.kind === "contextual-help") {
            const output = contextualHelpCandidateSchema.parse(state.output);
            session.turns.push({
              question: accepted.operation.input.question,
              answer: output.answer,
            });
            if (session.turns.length > 6) session.turns.splice(0, session.turns.length - 6);
          }
        } else if (state.kind === "exercise-feedback") {
          const accepted = [...this.operationsBySubmission.values()].find(
            ({ operationId }) => operationId === state.operationId,
          );
          if (!accepted?.exerciseFeedback) {
            throw new Error("OD_EXERCISE_FEEDBACK_OPERATION_INVALID");
          }
          const selection = accepted.operation.modelSelection;
          const provenance = generationProvenanceSchema.parse(state.provenance);
          const expectedProducer =
            accepted.connection.routeId === "chatgpt"
              ? "chatgpt-plan"
              : accepted.connection.routeId;
          const capturedEffort =
            selection.effort.selection === "exact"
              ? selection.effort.effortId
              : accepted.connection.routeId === "managed"
                ? "runtime-default"
                : undefined;
          if (
            selection.model.selection !== "exact" ||
            capturedEffort === undefined ||
            provenance.producer !== expectedProducer ||
            provenance.modelId !== selection.model.modelId ||
            provenance.effortId !== capturedEffort
          )
            throw new Error("OD_EXERCISE_FEEDBACK_OPERATION_INVALID");
          if (!this.#repository) throw new Error("OD_DATA_ROOT_STALE");
          await this.#repository.saveGeneratedExerciseFeedback(
            accepted.exerciseFeedback.activityId,
            accepted.exerciseFeedback.attemptId,
            {
              modelRequestId: modelRequestIdSchema.parse(state.modelRequestId),
              provenance,
              output: exerciseFeedbackCandidateSchema.parse(state.output),
            },
          );
        }
        this.#dependencies.operationLog(
          "info",
          "DESKTOP_OPERATION_OUTPUT_APPLIED",
          state.operationId,
          state.kind,
          undefined,
          "Validated AI output applied to learning state.",
          {
            phase: "completed",
            outcome: "ok",
            durationMs: Math.round(performance.now() - projectionStartedAt),
            metadata: { stage: "apply-output" },
          },
        );
        this.activeOperations.delete(state.operationId);
        this.retryableOperations.delete(state.operationId);
        if (state.kind === "voice-activity-draft")
          this.operationsBySubmission.set(state.submissionId, {
            ...acceptedOperation,
            validatedVoiceModelRequestId: state.modelRequestId,
          });
        this.#dependencies.emitEvent?.(
          desktopIpcEventSchema.parse({
            event: "learning-operation-finished",
            operationId: state.operationId,
            submissionId: state.submissionId,
            kind: state.kind,
            submission: "retained",
            outcome: {
              status: "validated",
              modelRequestId: state.modelRequestId,
              provenance: state.provenance,
              output: state.output,
              learningScope: {
                learnerId: acceptedOperation.operation.input.learningContext.learnerId,
                courseId: acceptedOperation.operation.input.learningContext.courseId,
                targetLanguage: acceptedOperation.operation.input.learningContext.targetLanguage,
              },
              ...(savedActivityId ? { activityId: savedActivityId } : {}),
            },
          }),
        );
      } else if (
        state.status === "cancelled" ||
        state.status === "rate-limited" ||
        state.status === "failed"
      ) {
        this.activeOperations.delete(state.operationId);
        if (state.status === "failed" || state.status === "rate-limited") {
          this.retryableOperations.add(state.operationId);
        } else {
          this.retryableOperations.delete(state.operationId);
        }
        const outcome =
          state.status === "cancelled"
            ? { status: "cancelled" as const }
            : state.status === "rate-limited"
              ? {
                  status: "rate-limited" as const,
                  reached: state.reached,
                  retryAt: state.retryAt,
                }
              : { status: "failed" as const, error: state.error };
        this.#dependencies.emitEvent?.({
          event: "learning-operation-finished",
          operationId: state.operationId,
          submissionId: state.submissionId,
          kind: state.kind,
          submission: "retained",
          outcome,
        });
      }
    }
  }

  hasActiveExerciseFeedback(input: NonNullable<AcceptedOperation["exerciseFeedback"]>) {
    return [...this.operationsBySubmission.values()].some(
      (accepted) =>
        this.activeOperations.has(accepted.operationId) &&
        accepted.dataRootGeneration === input.expectedGeneration &&
        accepted.exerciseFeedback?.activityId === input.activityId &&
        accepted.exerciseFeedback.attemptId === input.attemptId,
    );
  }
}
