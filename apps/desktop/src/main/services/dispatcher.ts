import {
  type DesktopIpcRequest,
  type DesktopIpcResponse,
  type ErrorKind,
} from "@call-nina/contracts";
import { diagnosticErrorCode } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { CodexIntegration, DesktopServices } from "./desktop-services.js";

export class IpcDispatcher {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<
    DesktopServices,
    | "root"
    | "materials"
    | "mobile"
    | "words"
    | "speech"
    | "providerCommands"
    | "translations"
    | "learner"
    | "activities"
    | "curriculum"
    | "diagnostics"
    | "home"
    | "uploads"
    | "history"
    | "generation"
  >;
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<
      DesktopServices,
      | "root"
      | "materials"
      | "mobile"
      | "words"
      | "speech"
      | "providerCommands"
      | "translations"
      | "learner"
      | "activities"
      | "curriculum"
      | "diagnostics"
      | "home"
      | "uploads"
      | "history"
      | "generation"
    >,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  get #root() {
    return this.#services().root;
  }
  get #materials() {
    return this.#services().materials;
  }
  get #mobile() {
    return this.#services().mobile;
  }
  get #words() {
    return this.#services().words;
  }
  get #speech() {
    return this.#services().speech;
  }
  get #providerCommands() {
    return this.#services().providerCommands;
  }
  get #translations() {
    return this.#services().translations;
  }
  get #learner() {
    return this.#services().learner;
  }
  get #activities() {
    return this.#services().activities;
  }
  get #curriculum() {
    return this.#services().curriculum;
  }
  get #diagnostics() {
    return this.#services().diagnostics;
  }
  get #home() {
    return this.#services().home;
  }
  get #uploads() {
    return this.#services().uploads;
  }
  get #history() {
    return this.#services().history;
  }
  get #generation() {
    return this.#services().generation;
  }
  async dispatch(
    request: DesktopIpcRequest,
    integration?: CodexIntegration,
  ): Promise<DesktopIpcResponse> {
    try {
      if (
        (request.channel.startsWith("vocabulary/") ||
          request.channel.startsWith("vocabulary-set/") ||
          request.channel.startsWith("flashcards/")) &&
        "rootGeneration" in request.payload &&
        this.#root.database?.rootGeneration !== request.payload.rootGeneration
      ) {
        return this.#environment.failure(request, "stale-data-root");
      }
      switch (request.channel) {
        case "material/import-web":
          return await this.#materials.handle(request);
        case "material/cancel-import":
          return await this.#materials.handle(request);
        case "nina-account/credentials/read":
          return await this.#mobile.handle(request);
        case "nina-account/credentials/save":
          return await this.#mobile.handle(request);
        case "nina-account/diagnostic":
          return await this.#mobile.handle(request);
        case "mobile-sync/publish":
          return await this.#mobile.handle(request);
        case "mobile-sync/read":
          return await this.#mobile.handle(request);
        case "nina-account/read":
          return await this.#mobile.handle(request);
        case "nina-account/update":
          return await this.#mobile.handle(request);
        case "vocabulary/learning-read":
          return await this.#words.handle(request);
        case "vocabulary/learning-update":
          return await this.#words.handle(request);
        case "speech/availability":
          return await this.#speech.handle(request);
        case "speech/read":
          return await this.#speech.handle(request);
        case "speech/manage":
          return await this.#speech.handle(request);
        case "speech/synthesize":
          return await this.#speech.handle(request);
        case "offline-model/read":
          return await this.#providerCommands.handle(request, integration);
        case "offline-model/manage":
          return await this.#providerCommands.handle(request, integration);
        case "ai-connections/read":
          return await this.#providerCommands.handle(request, integration);
        case "ai-connections/update":
          return await this.#providerCommands.handle(request, integration);
        case "translation/flashcard-visibility":
          return await this.#translations.handle(request);
        case "translation/read":
          return await this.#translations.handle(request);
        case "translation/start":
          return await this.#translations.handle(request);
        case "translation/cancel":
          return await this.#translations.handle(request);
        case "app/readiness":
          return await this.#root.handle(request, integration);
        case "provider/access/read":
          return await this.#providerCommands.handle(request, integration);
        case "data-root/read":
          return await this.#root.handle(request, integration);
        case "data-root/choose":
          return await this.#root.handle(request, integration);
        case "data-root/confirm":
          return await this.#root.handle(request, integration);
        case "privacy/ai-disclosure/read":
          return await this.#learner.handle(request);
        case "privacy/ai-disclosure/acknowledge":
          return await this.#learner.handle(request);
        case "learner-profile/read":
          return await this.#learner.handle(request);
        case "learner-profile/start-onboarding":
          return await this.#learner.handle(request);
        case "learner-profile/finish-onboarding":
          return await this.#learner.handle(request);
        case "placement/complete":
          return await this.#learner.handle(request);
        case "codex-activity/prepare":
          return await this.#activities.handle(request, integration);
        case "development-notice/read":
          return await this.#learner.handle(request);
        case "development-notice/dismiss":
          return await this.#learner.handle(request);
        case "learner-settings/select-language":
          return await this.#learner.handle(request);
        case "stories/read":
          return await this.#curriculum.handle(request);
        case "stories/position":
          return await this.#curriculum.handle(request);
        case "stories/vocabulary":
          return await this.#curriculum.handle(request);
        case "learner-settings/read":
          return await this.#learner.handle(request);
        case "learner-settings/update":
          return await this.#learner.handle(request);
        case "personal-data/clear":
          return await this.#diagnostics.handle(request);
        case "personal-data/read":
          return await this.#diagnostics.handle(request);
        case "diagnostics/read":
          return await this.#diagnostics.handle(request);
        case "diagnostics/export":
          return await this.#diagnostics.handle(request);
        case "logs/clear":
          return await this.#diagnostics.handle(request);
        case "learning-path/vocabulary":
          return await this.#curriculum.handle(request);
        case "learning-path/read":
          return await this.#curriculum.handle(request);
        case "learning-path/update":
          return await this.#curriculum.handle(request);
        case "learning-path/prepare-voice":
          return await this.#curriculum.handle(request);
        case "nina/read":
          return await this.#home.handle(request);
        case "nina/plan":
          return await this.#home.handle(request);
        case "dashboard/read":
          return await this.#home.handle(request);
        case "activity/list":
          return await this.#activities.handle(request, integration);
        case "activity/reuse":
          return await this.#activities.handle(request, integration);
        case "activity/resolve":
          return await this.#activities.handle(request, integration);
        case "flashcards/create":
          return await this.#words.handle(request);
        case "flashcards/read":
          return await this.#words.handle(request);
        case "flashcards/progress":
          return await this.#words.handle(request);
        case "flashcards/save-vocabulary":
          return await this.#words.handle(request);
        case "vocabulary/read":
          return await this.#words.handle(request);
        case "vocabulary/detail":
          return await this.#words.handle(request);
        case "vocabulary/review-queue":
          return await this.#words.handle(request);
        case "vocabulary/bulk":
          return await this.#words.handle(request);
        case "vocabulary-set/list":
          return await this.#words.handle(request);
        case "vocabulary-set/create":
          return await this.#words.handle(request);
        case "vocabulary/confirm":
          return await this.#words.handle(request);
        case "vocabulary/review":
          return await this.#words.handle(request);
        case "vocabulary/edit":
          return await this.#words.handle(request);
        case "vocabulary/suspend":
          return await this.#words.handle(request);
        case "vocabulary/resume":
          return await this.#words.handle(request);
        case "vocabulary/delete":
          return await this.#words.handle(request);
        case "uploads/list":
          return await this.#uploads.handle(request);
        case "uploads/read":
          return await this.#uploads.handle(request);
        case "uploads/save":
          return await this.#uploads.handle(request);
        case "uploads/archive":
          return await this.#uploads.handle(request);
        case "uploads/image":
          return await this.#uploads.handle(request);
        case "uploads/analyses":
          return await this.#uploads.handle(request);
        case "uploads/commit":
          return await this.#uploads.handle(request);
        case "material/list":
          return await this.#materials.handle(request);
        case "material/read":
          return await this.#materials.handle(request);
        case "material/save":
          return await this.#materials.handle(request);
        case "material/delete":
          return await this.#materials.handle(request);
        case "prepared-activity/read":
          return await this.#activities.handle(request, integration);
        case "voice-activity/open-in-codex":
          return await this.#activities.handle(request, integration);
        case "voice-activity/read":
          return await this.#activities.handle(request, integration);
        case "prepared-activity/delete":
          return await this.#activities.handle(request, integration);
        case "exercise-set/support":
          return await this.#activities.handle(request, integration);
        case "exercise-set/answer":
          return await this.#activities.handle(request, integration);
        case "exercise-set/start":
          return await this.#activities.handle(request, integration);
        case "exercise-set/complete":
          return await this.#activities.handle(request, integration);
        case "exercise-set/abandon":
          return await this.#activities.handle(request, integration);
        case "history/read":
          return await this.#history.handle(request);
        case "history/mistake-amend":
          return await this.#history.handle(request);
        case "history/delete":
          return await this.#history.handle(request);
        case "codex/integration/read":
          return await this.#providerCommands.handle(request, integration);
        case "codex/integration/action":
          return await this.#providerCommands.handle(request, integration);
        case "chatgpt/usage/open":
          return await this.#providerCommands.handle(request, integration);
        case "chatgpt/account/read":
          return await this.#providerCommands.handle(request, integration);
        case "chatgpt/accounts/read":
          return await this.#providerCommands.handle(request, integration);
        case "chatgpt/account/logout":
          return await this.#providerCommands.handle(request, integration);
        case "chatgpt/account/login/start":
          return await this.#providerCommands.handle(request, integration);
        case "chatgpt/account/login/cancel":
          return await this.#providerCommands.handle(request, integration);
        case "chatgpt/models/read":
          return await this.#providerCommands.handle(request, integration);
        case "learning-operation/start":
          return await this.#generation.handle(request);
        case "learning-operation/retry":
          return await this.#generation.handle(request);
        case "learning-operation/cancel":
          return await this.#generation.handle(request);
        default: {
          const unhandled: never = request;
          throw new Error(String(unhandled));
        }
      }
    } catch (error) {
      if (
        request.channel === "learning-operation/start" ||
        request.channel === "learning-operation/retry"
      ) {
        this.#environment.operationLog(
          "error",
          "DESKTOP_OPERATION_REQUEST_FAILED",
          request.requestId,
          request.channel,
          diagnosticErrorCode(error),
          "Learning operation request failed before completion.",
          { action: request.channel, phase: "failed", outcome: "error" },
        );
      }
      const code = diagnosticErrorCode(error);
      if (request.channel.startsWith("speech/")) {
        this.#environment.operationLog(
          "warn",
          "DESKTOP_SPEECH_FAILED",
          request.requestId,
          request.channel,
          code,
          "Speech operation failed.",
          { action: request.channel, phase: "failed", outcome: "error" },
        );
        const kind: ErrorKind =
          code === "OD_SPEECH_INITIALIZATION_TIMEOUT"
            ? "speech-initialization-timeout"
            : code === "OD_SPEECH_SYNTHESIS_TIMEOUT"
              ? "speech-synthesis-timeout"
              : code === "OD_SPEECH_CANCELLED"
                ? "cancellation"
                : "speech-unavailable";
        return this.#environment.failure(request, kind);
      }
      const kind =
        request.channel === "uploads/save" &&
        error instanceof Error &&
        "code" in error &&
        ["ENOSPC", "EACCES", "EROFS", "EIO"].includes(String(error.code))
          ? "upload-save-failed"
          : code === "OD_UPLOAD_IMAGE_UNAVAILABLE"
            ? "upload-image-unavailable"
            : code === "OD_UPLOAD_SAVE_FAILED"
              ? "upload-save-failed"
              : code === "OD_UPLOAD_TEXT_REQUIRED"
                ? "upload-text-required"
                : code === "OD_VOCABULARY_IMAGE_INVALID"
                  ? "upload-image-invalid"
                  : code === "OD_MATERIAL_REFERENCED"
                    ? "material-referenced"
                    : code === "OD_EXERCISE_CONTEXT_MISSING"
                      ? "exercise-context-missing"
                      : code === "OD_MATERIAL_REVISION_STALE"
                        ? "conflict"
                        : code.includes("HANDOFF")
                          ? "handoff"
                          : code.includes("STALE")
                            ? "stale-data-root"
                            : code.includes("CONFLICT") || code.includes("DELETE_BLOCKED")
                              ? "conflict"
                              : code.includes("NOT_FOUND")
                                ? "not-found"
                                : code.includes("DATABASE") || code.includes("SQLITE")
                                  ? "database"
                                  : "validation";
      return this.#environment.failure(request, kind);
    }
  }
}
