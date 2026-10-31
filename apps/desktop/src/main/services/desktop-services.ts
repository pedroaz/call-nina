import type { DesktopIpcResponse } from "@call-nina/contracts";
import type { ActivitiesController } from "./activities.js";
import type { LocalAssets } from "./local-assets.js";
import type { GenerationContext } from "./generation-context.js";
import type { CurriculumService } from "./curriculum.js";
import type { DiagnosticsService } from "./diagnostics.js";
import type { IpcDispatcher } from "./dispatcher.js";
import type { ExerciseGenerationContext } from "./exercise-context.js";
import type { LearningOperations } from "./generation.js";
import type { HistoryService } from "./history.js";
import type { HomeService } from "./home.js";
import type { WebsiteCaptures } from "./website-captures.js";
import type { LearnerService } from "./learner.js";
import type { MaterialsService } from "./materials.js";
import type { MobilePublishing } from "./mobile.js";
import type { OperationScope } from "./operation-scope.js";
import type { ProviderCommands } from "./provider-commands.js";
import type { ProviderAccessService } from "./providers.js";
import type { LearnerRoot } from "./learner-root.js";
import type { RequestScheduler } from "./scheduler.js";
import type { SpeechController } from "./speech.js";
import type { TranslationController } from "./translations.js";
import type { UploadsService } from "./uploads.js";
import type { VocabularyWorker } from "./vocabulary-worker.js";
import type { VocabularyService } from "./vocabulary-library.js";

export type CodexIntegration = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "codex/integration/read" }
>["result"];
export interface DesktopServices {
  operationScope: OperationScope;
  dispatcher: IpcDispatcher;
  exerciseContext: ExerciseGenerationContext;
  providerCommands: ProviderCommands;
  root: LearnerRoot;
  assets: LocalAssets;
  providers: ProviderAccessService;
  generation: LearningOperations;
  context: GenerationContext;
  vocabulary: VocabularyWorker;
  imports: WebsiteCaptures;
  mobile: MobilePublishing;
  learner: LearnerService;
  diagnostics: DiagnosticsService;
  activities: ActivitiesController;
  curriculum: CurriculumService;
  home: HomeService;
  words: VocabularyService;
  uploads: UploadsService;
  materials: MaterialsService;
  history: HistoryService;
  speech: SpeechController;
  translations: TranslationController;
  scheduler: RequestScheduler;
}
