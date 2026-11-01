import {
  learnerIdSchema,
  utcInstantSchema,
  type DesktopIpcRequest,
  type DesktopIpcResponse,
} from "@call-nina/contracts";
import { createInitialLearnerProfile } from "@call-nina/domain";
import { type CallNinaRepository, type LearnerSettingsRecord } from "@call-nina/persistence";
import { freshTimestampAfter, opaqueId } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class LearnerService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root">;

  get #root() {
    return this.#services().root;
  }
  constructor(environment: DesktopEnvironment, services: () => Pick<DesktopServices, "root">) {
    this.#environment = environment;
    this.#services = services;
  }
  async hasAcknowledgedAiDisclosure(): Promise<boolean> {
    return this.#root.repository
      ? this.#root.repository.hasAcknowledgedFirstAiDisclosure()
      : Promise.resolve(false);
  }

  profileSummary(settings: Awaited<ReturnType<CallNinaRepository["createLearnerSettings"]>>) {
    const profile = settings.profile;
    return {
      learnerName: settings.learnerName,
      learningContext: settings.learningContext,
      onboardingState: profile.onboardingState,
      approximateLevel: profile.levelEstimate.currentLevel,
      everydayLifeGoal: profile.everydayLifeGoal,
      defaultTeachingProfileId: profile.defaultTeachingProfileId,
      explanationLanguage: profile.explanationLanguage,
      uiLocale: profile.uiLocale,
      placement: {
        status: profile.levelEstimate.optionalDiagnosticCompletedOn ? "completed" : "skipped",
      },
      updatedAt: profile.updatedAt,
    } as const;
  }

  async readActiveLearnerSettings(): Promise<LearnerSettingsRecord | undefined> {
    return this.#root.repository?.readCurrentLearnerSettings();
  }

  settingsProjection(
    settings: LearnerSettingsRecord,
    dataRoot: Readonly<{ generation: number; displayName: string }>,
  ) {
    const profile = settings.profile;
    return {
      dataRoot: { generation: dataRoot.generation, displayName: dataRoot.displayName },
      settings: {
        learnerName: settings.learnerName,
        learningScope: {
          learnerId: settings.learningContext.learnerId,
          courseId: settings.learningContext.courseId,
          targetLanguage: settings.learningContext.targetLanguage,
        },
        approximateLevel: profile.levelEstimate.currentLevel,
        everydayLifeGoal: profile.everydayLifeGoal,
        defaultTeachingProfileId: profile.defaultTeachingProfileId,
        explanationLanguage: profile.explanationLanguage,
        uiLocale: profile.uiLocale,
        correctionPreferences: profile.correctionPreferences,
      },
      updatedAt: profile.updatedAt,
    } as const;
  }

  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "privacy/ai-disclosure/read"
          | "privacy/ai-disclosure/acknowledge"
          | "learner-profile/read"
          | "learner-profile/start-onboarding"
          | "learner-profile/finish-onboarding"
          | "placement/complete"
          | "development-notice/read"
          | "development-notice/dismiss"
          | "learner-settings/select-language"
          | "learner-settings/read"
          | "learner-settings/update";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "privacy/ai-disclosure/read": {
        const acknowledged = this.#root.repository
          ? await this.#root.repository.hasAcknowledgedFirstAiDisclosure()
          : false;
        return this.#environment.success(request, { acknowledged });
      }
      case "privacy/ai-disclosure/acknowledge": {
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        await this.#root.repository.acknowledgeFirstAiDisclosure(new Date().toISOString());
        return this.#environment.success(request, { acknowledged: true });
      }
      case "learner-profile/read": {
        const settings = await this.readActiveLearnerSettings();
        return this.#environment.success(
          request,
          settings
            ? { status: "ready", profile: this.profileSummary(settings) }
            : { status: "not-created" },
        );
      }
      case "learner-profile/start-onboarding": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready" || root.generation !== request.payload.expectedGeneration)
          return this.#environment.failure(request, "stale-data-root");
        const learnerId = learnerIdSchema.parse(opaqueId("learner"));
        const existing = await this.readActiveLearnerSettings();
        if (existing) {
          const summary = this.profileSummary(existing);
          const same =
            summary.onboardingState === "in-progress" &&
            summary.learnerName === request.payload.learnerName &&
            summary.uiLocale === request.payload.uiLocale &&
            summary.approximateLevel === request.payload.approximateLevel &&
            summary.everydayLifeGoal === request.payload.everydayLifeGoal &&
            summary.defaultTeachingProfileId === request.payload.defaultTeachingProfileId &&
            summary.explanationLanguage === request.payload.explanationLanguage &&
            summary.placement.status === request.payload.placement.status;
          if (!same) return this.#environment.failure(request, "conflict");
          return this.#environment.success(request, { status: "ready", profile: summary });
        }
        const timestamp = utcInstantSchema.parse(new Date().toISOString());
        const profile = createInitialLearnerProfile({
          targetLanguage: request.payload.targetLanguage,
          schemaVersion: 1,
          learnerId,
          levelEstimate: {
            currentLevel: request.payload.approximateLevel,
            targetLevel: request.payload.approximateLevel,
            basis: "self-reported",
            updatedAt: timestamp,
          },
          everydayLifeGoal: request.payload.everydayLifeGoal,
          motivation: request.payload.everydayLifeGoal,
          interests: [],
          preferredTopics: [],
          correctionPreferences: {
            timing: "immediate",
            coverage: "all-meaningful",
            showConciseExplanation: true,
            showNaturalAlternative: true,
          },
          onboardingState: "in-progress",
          inferredStrengths: [],
          inferredWeaknesses: [],
          explanationLanguage: request.payload.explanationLanguage,
          defaultTeachingProfileId: request.payload.defaultTeachingProfileId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        const settings = {
          learnerName: request.payload.learnerName,
          profile: { ...profile, uiLocale: request.payload.uiLocale },
        };
        const stored = await this.#root.repository.createLearnerSettings(settings);
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          status: "ready",
          profile: this.profileSummary(stored),
        });
      }
      case "learner-profile/finish-onboarding": {
        const root = await this.#root.dataRootState(request.requestId);
        if (
          root.status !== "ready" ||
          root.generation !== request.payload.expectedGeneration ||
          !this.#root.repository
        )
          return this.#environment.failure(request, "stale-data-root");
        const repository = this.#root.repository;
        const current = await repository.readCurrentLearnerSettings();
        if (!current) return this.#environment.failure(request, "not-found");
        if (current.profile.updatedAt !== request.payload.expectedUpdatedAt)
          return this.#environment.failure(request, "conflict");
        if (current.profile.onboardingState === "complete")
          return this.#environment.success(request, {
            status: "ready",
            profile: this.profileSummary(current),
          });
        if (repository !== this.#root.repository)
          return this.#environment.failure(request, "stale-data-root");
        const stored = await repository.updateLearnerSettings({
          expectedUpdatedAt: current.profile.updatedAt,
          settings: {
            ...current,
            profile: {
              ...current.profile,
              onboardingState: "complete",
              updatedAt: freshTimestampAfter(current.profile.updatedAt),
            },
          },
        });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "settings" });
        return this.#environment.success(request, {
          status: "ready",
          profile: this.profileSummary(stored),
        });
      }
      case "placement/complete": {
        const current = await this.readActiveLearnerSettings();
        if (!current) return this.#environment.failure(request, "not-found");
        // A short local diagnostic records evidence; level changes remain explicit Settings edits.
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        const historyEntryId = (
          await this.#root.repository.savePlacementResult(request.payload.result, request.requestId)
        ).historyEntryId;
        this.#environment.emitEvent({ event: "state-invalidated", scope: "settings" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "history" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        return this.#environment.success(request, {
          status: "completed",
          historyEntryId,
          profile: this.profileSummary(current),
        });
      }
      case "development-notice/read":
      case "development-notice/dismiss": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready" || !this.#root.repository)
          return this.#environment.failure(request, "stale-data-root");
        if (request.channel === "development-notice/read")
          return this.#environment.success(request, {
            pending: await this.#root.repository.readDevelopmentNotice(),
          });
        await this.#root.repository.dismissDevelopmentNotice();
        return this.#environment.success(request, { dismissed: true });
      }
      case "learner-settings/select-language": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (
          dataRoot.status !== "ready" ||
          dataRoot.generation !== request.payload.expectedGeneration ||
          !this.#root.repository
        )
          return this.#environment.failure(request, "stale-data-root");
        const settings = await this.#root.repository.selectLearningLanguage(
          request.payload.targetLanguage,
        );
        this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "history" });
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        return this.#environment.success(request, this.settingsProjection(settings, dataRoot));
      }
      case "learner-settings/read": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (dataRoot.status !== "ready")
          return this.#environment.failure(request, "stale-data-root");
        const settings = await this.readActiveLearnerSettings();
        if (!settings) return this.#environment.failure(request, "not-found");
        return this.#environment.success(request, this.settingsProjection(settings, dataRoot));
      }
      case "learner-settings/update": {
        const dataRoot = await this.#root.dataRootState(request.requestId);
        if (dataRoot.status !== "ready")
          return this.#environment.failure(request, "stale-data-root");
        const current = await this.readActiveLearnerSettings();
        if (!current) return this.#environment.failure(request, "not-found");
        const timestamp = freshTimestampAfter(current.profile.updatedAt);
        const editable = request.payload.settings;
        if (
          editable.learningScope.learnerId !== current.profile.learnerId ||
          editable.learningScope.targetLanguage !== current.profile.targetLanguage
        )
          return this.#environment.failure(request, "conflict");
        const levelChanged =
          editable.approximateLevel !== current.profile.levelEstimate.currentLevel;
        const next: LearnerSettingsRecord = {
          ...current,
          learnerName: editable.learnerName,
          learningContext: { ...current.learningContext, ...editable.learningScope },
          profile: {
            ...current.profile,
            levelEstimate: levelChanged
              ? {
                  ...current.profile.levelEstimate,
                  currentLevel: editable.approximateLevel,
                  basis: "self-reported",
                  updatedAt: timestamp,
                }
              : current.profile.levelEstimate,
            everydayLifeGoal: editable.everydayLifeGoal,
            defaultTeachingProfileId: editable.defaultTeachingProfileId,
            explanationLanguage: editable.explanationLanguage,
            uiLocale: editable.uiLocale,
            correctionPreferences: editable.correctionPreferences,
            updatedAt: timestamp,
          },
        };
        if (!this.#root.repository) return this.#environment.failure(request, "stale-data-root");
        let stored: LearnerSettingsRecord;
        try {
          stored = await this.#root.repository.updateLearnerSettings({
            expectedUpdatedAt: utcInstantSchema.parse(request.payload.expectedUpdatedAt),
            settings: next,
          });
        } catch (error) {
          if (error instanceof Error && error.message === "OD_LEARNER_SETTINGS_CONFLICT") {
            return this.#environment.failure(request, "conflict");
          }
          throw error;
        }
        this.#environment.emitEvent({ event: "state-invalidated", scope: "settings" });
        return this.#environment.success(request, this.settingsProjection(stored, dataRoot));
      }
    }
  }
}
