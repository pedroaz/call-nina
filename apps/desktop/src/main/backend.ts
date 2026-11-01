import { ProductFeedback } from "./services/product-feedback.js";
import type { DesktopIpcRequest } from "@call-nina/contracts";
import { DesktopEnvironment, type DesktopOptions } from "./desktop-environment.js";
import { ActivitiesController } from "./services/activities.js";
import { LocalAssets } from "./services/local-assets.js";
import { GenerationContext } from "./services/generation-context.js";
import { CurriculumService } from "./services/curriculum.js";
import type { DesktopServices } from "./services/desktop-services.js";
import { DiagnosticsService } from "./services/diagnostics.js";
import { IpcDispatcher } from "./services/dispatcher.js";
import { ExerciseGenerationContext } from "./services/exercise-context.js";
import { LearningOperations } from "./services/generation.js";
import { HistoryService } from "./services/history.js";
import { HomeService } from "./services/home.js";
import { WebsiteCaptures } from "./services/website-captures.js";
import { LearnerService } from "./services/learner.js";
import { MaterialsService } from "./services/materials.js";
import { MobilePublishing } from "./services/mobile.js";
import { OperationScope } from "./services/operation-scope.js";
import { ProviderCommands } from "./services/provider-commands.js";
import { ProviderAccessService } from "./services/providers.js";
import { LearnerRoot } from "./services/learner-root.js";
import { RequestScheduler } from "./services/scheduler.js";
import { SpeechController } from "./services/speech.js";
import { TranslationController } from "./services/translations.js";
import { UploadsService } from "./services/uploads.js";
import { VocabularyWorker } from "./services/vocabulary-worker.js";
import { VocabularyService } from "./services/vocabulary-library.js";

import { selectionId } from "./backend-support.js";

export class DesktopBackend {
  readonly #environment: DesktopEnvironment;
  readonly #services: DesktopServices;
  constructor(options: DesktopOptions) {
    const environment = new DesktopEnvironment(
      options,
      (event) => {
        services.vocabulary.observe(event);
      },
      async () => {
        await services.providers.connections.shutdownManaged();
        environment.emitEvent({ event: "state-invalidated", scope: "ai-connections" });
      },
    );
    const services: DesktopServices = {
      productFeedback: new ProductFeedback(environment),
      operationScope: new OperationScope(environment, () => services),
      dispatcher: new IpcDispatcher(environment, () => services),
      exerciseContext: new ExerciseGenerationContext(environment, () => services),
      providerCommands: new ProviderCommands(environment, () => services),
      root: new LearnerRoot(environment, () => services),
      assets: new LocalAssets(environment, () => services),
      providers: new ProviderAccessService(environment, () => services),
      generation: new LearningOperations(environment, () => services),
      context: new GenerationContext(environment, () => services),
      vocabulary: new VocabularyWorker(environment, () => services),
      imports: new WebsiteCaptures(environment, () => services),
      mobile: new MobilePublishing(environment, () => services),
      learner: new LearnerService(environment, () => services),
      diagnostics: new DiagnosticsService(environment, () => services),
      activities: new ActivitiesController(environment, () => services),
      curriculum: new CurriculumService(environment, () => services),
      home: new HomeService(environment, () => services),
      words: new VocabularyService(environment, () => services),
      uploads: new UploadsService(environment, () => services),
      materials: new MaterialsService(environment, () => services),
      history: new HistoryService(environment, () => services),
      speech: new SpeechController(environment, () => services),
      translations: new TranslationController(environment, () => services),
      scheduler: new RequestScheduler(environment, () => services),
    };
    this.#environment = environment;
    this.#services = services;
  }
  async interfaceLocale() {
    return (await this.#services.learner.readActiveLearnerSettings())?.profile.uiLocale;
  }
  handle(request: DesktopIpcRequest) {
    return this.#services.scheduler.handle(request);
  }
  openActivityLink(...args: Parameters<ActivitiesController["openActivityLink"]>) {
    return this.#services.activities.openActivityLink(...args);
  }
  close() {
    this.#services.productFeedback.close();
    this.#services.imports.clear();
    this.#services.generation.reset();
    this.#services.vocabulary.stop();
    this.#services.providers.connections.reset();
    this.#services.mobile.cancel();
    this.#services.root.close();
  }
  async shutdown() {
    this.#services.scheduler.beginShutdown();
    this.#environment.operationLog(
      "info",
      "DESKTOP_SHUTDOWN_STARTED",
      selectionId(),
      "lifecycle",
      undefined,
      "Call Nina desktop shutdown started.",
      { action: "lifecycle/shutdown", phase: "started" },
    );
    await this.#services.scheduler.enqueue(() => {
      this.close();
    });
    await this.#services.assets.speech.close();
    await this.#environment.offline.stop();
    await this.#environment.chatgpt.shutdown();
    this.#environment.operationLog(
      "info",
      "DESKTOP_SHUTDOWN_COMPLETED",
      selectionId(),
      "lifecycle",
      undefined,
      "Call Nina desktop shutdown completed.",
      { action: "lifecycle/shutdown", phase: "completed", outcome: "ok" },
    );
  }
}
