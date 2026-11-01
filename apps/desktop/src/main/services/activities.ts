import {
  historyEntryIdSchema,
  utcInstantSchema,
  type ActivityAction,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import { generationLevel } from "@call-nina/learning-workflows";
import { readAiConnections } from "@call-nina/persistence";
import { opaqueId, selectionId } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import { ActivityService } from "./activity-service.js";
import type { CodexIntegration, DesktopServices } from "./desktop-services.js";

export class ActivitiesController {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<
    DesktopServices,
    "root" | "scheduler" | "generation" | "providers"
  >;

  get #root() {
    return this.#services().root;
  }
  get #scheduler() {
    return this.#services().scheduler;
  }
  get #generation() {
    return this.#services().generation;
  }
  get #providers() {
    return this.#services().providers;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "scheduler" | "generation" | "providers">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async activities(requestId: string): Promise<ActivityService> {
    const root = await this.#root.dataRootState(requestId);
    if (root.status !== "ready" || !this.#root.database || !this.#root.repository)
      throw new Error("OD_DATA_ROOT_STALE");
    return new ActivityService({
      ...this.#root.capture(),
      curriculumRoot: this.#environment.curriculumRoot,
      emitEvent: this.#environment.emitEvent,
    });
  }

  async openActivityLink(
    action: Extract<ActivityAction, { action: "open-activity" }>,
  ): Promise<void> {
    await this.#scheduler.enqueue(async () => {
      if (this.#scheduler.closing) return;
      const resolved = await (await this.activities(selectionId())).resolve(action);
      this.#environment.emitEvent({
        event: "prepared-activity-open",
        activityId: resolved.activity.activityId,
        source: "url-scheme",
      });
    });
  }

  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "codex-activity/prepare"
          | "activity/list"
          | "activity/reuse"
          | "activity/resolve"
          | "prepared-activity/read"
          | "voice-activity/open-in-codex"
          | "voice-activity/read"
          | "prepared-activity/delete"
          | "exercise-set/support"
          | "exercise-set/answer"
          | "exercise-set/start"
          | "exercise-set/complete"
          | "exercise-set/abandon";
      }
    >,
    integration?: CodexIntegration,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "codex-activity/prepare": {
        if (
          !this.#root.database ||
          (await readAiConnections(this.#root.database)).routing.liveConversation !== "codex"
        )
          return this.#environment.failure(request, "not-found");
        const activities = await this.activities(request.requestId);
        const accepted = this.#generation.operations.findSubmission(
          (operation) =>
            operation.validatedVoiceModelRequestId === request.payload.draftModelRequestId,
        );
        if (!accepted || accepted.dataRootGeneration !== activities.generation)
          return this.#environment.failure(request, "exercise-context-missing");
        const input = accepted.operation.input;
        if (
          input.kind !== "voice-activity-draft" ||
          input.voiceKind !== request.payload.context.kind ||
          input.targetLevel !== generationLevel[request.payload.context.targetLevel]
        )
          return this.#environment.failure(request, "validation");
        return this.#environment.success(
          request,
          await activities.prepareVoice(
            {
              action: "prepare-voice",
              title: request.payload.title,
              context: request.payload.context,
              learningScope: {
                learnerId: input.learningContext.learnerId,
                courseId: input.learningContext.courseId,
                targetLanguage: input.learningContext.targetLanguage,
              },
              expectedGeneration: activities.generation,
            },
            request.requestId,
            { learningContext: input.learningContext, calibration: input.calibration },
            input.uploadSource,
          ),
        );
      }
      case "activity/list": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready" || !this.#root.repository)
          return this.#environment.failure(request, "stale-data-root");
        return this.#environment.success(
          request,
          await this.#root.repository.listPreparedActivities(request.payload),
        );
      }
      case "activity/reuse": {
        return this.#environment.success(
          request,
          await (await this.activities(request.requestId)).reuseExercises(request.payload),
        );
      }
      case "activity/resolve": {
        const resolved = await (await this.activities(request.requestId)).resolve(request.payload);
        if (request.payload.recordUse)
          await this.#root.repository?.recordActivityUse(
            resolved.activity.activityId,
            resolved.rootGeneration,
          );
        return this.#environment.success(request, resolved);
      }
      case "prepared-activity/read": {
        return this.#environment.success(
          request,
          await (
            await this.activities(request.requestId)
          ).readGenerated(request.payload.activityId),
        );
      }
      case "voice-activity/open-in-codex": {
        const activities = await this.activities(request.requestId);
        return this.#environment.success(
          request,
          await activities.openVoice(request.payload.activityId, {
            isCodexVoiceAvailable: async () => {
              return (
                (
                  await this.#providers.providerAccess(
                    "voice-handoff",
                    request.requestId,
                    undefined,
                    undefined,
                    integration,
                  )
                ).status === "available"
              );
            },
            ...(this.#environment.openExternal
              ? { openExternal: this.#environment.openExternal }
              : {}),
          }),
        );
      }
      case "voice-activity/read": {
        return this.#environment.success(
          request,
          await (await this.activities(request.requestId)).readVoice(request.payload.activityId),
        );
      }
      case "prepared-activity/delete": {
        return this.#environment.success(
          request,
          await (await this.activities(request.requestId)).delete(request.payload.activityId),
        );
      }
      case "exercise-set/support": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.recordExerciseSupport(
          request.payload.activityId,
          request.payload.attemptId,
        );
        return this.#environment.success(request, { recorded: true });
      }
      case "exercise-set/answer": {
        if (
          !this.#root.repository ||
          request.payload.expectedGeneration !== this.#root.database?.rootGeneration
        )
          return this.#environment.failure(request, "stale-data-root");
        const saved = await this.#root.repository.saveGeneratedExerciseAnswer({
          activityId: request.payload.activityId,
          attemptId: request.payload.attemptId,
          answer: request.payload.answer,
          submittedAt: utcInstantSchema.parse(new Date().toISOString()),
        });
        return this.#environment.success(request, {
          saved: true,
          feedback: saved.feedback?.output ?? null,
          feedbackProvenance: saved.feedback?.provenance ?? null,
        });
      }
      case "exercise-set/start": {
        return this.#environment.success(
          request,
          await (await this.activities(request.requestId)).startExercises(request.payload),
        );
      }
      case "exercise-set/complete": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        const completedAt = utcInstantSchema.parse(new Date().toISOString());
        await this.#root.repository.completeGeneratedExerciseSet({
          activityId: request.payload.activityId,
          completedAt,
          answers: request.payload.answers.map((answer) => ({
            ...answer,
            historyEntryId: historyEntryIdSchema.parse(opaqueId("history-entry")),
          })),
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "history" });
        return this.#environment.success(request, {
          activityId: request.payload.activityId,
          status: "completed",
          completedAt,
        });
      }
      case "exercise-set/abandon": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        const abandonedAt = utcInstantSchema.parse(new Date().toISOString());
        await this.#root.repository.abandonGeneratedExerciseSet({
          activityId: request.payload.activityId,
          abandonedAt,
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          activityId: request.payload.activityId,
          status: "abandoned",
          abandonedAt,
        });
      }
    }
  }
}
