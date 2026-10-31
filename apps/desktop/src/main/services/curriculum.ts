import { type DesktopIpcRequest, type DesktopIpcResponse } from "@call-nina/contracts";
import {
  addCourseVocabulary,
  readAiConnections,
  readLearningCourse,
  readStories,
  saveStoryPosition,
  saveStoryWord,
  storyPositions,
} from "@call-nina/persistence";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";

export class CurriculumService {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<DesktopServices, "root" | "activities">;

  get #root() {
    return this.#services().root;
  }
  get #activities() {
    return this.#services().activities;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<DesktopServices, "root" | "activities">,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async handle(
    request: Extract<
      DesktopIpcRequest,
      {
        channel:
          | "stories/read"
          | "stories/position"
          | "stories/vocabulary"
          | "learning-path/vocabulary"
          | "learning-path/read"
          | "learning-path/update"
          | "learning-path/prepare-voice";
      }
    >,
  ): Promise<DesktopIpcResponse> {
    switch (request.channel) {
      case "stories/read":
      case "stories/position":
      case "stories/vocabulary": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready" || !this.#root.repository || !this.#root.database)
          return this.#environment.failure(request, "stale-data-root");
        const db = this.#root.database;
        const context = await this.#root.repository.requireLearningContext();
        const stories = (await readStories(this.#environment.curriculumRoot)).filter(
          (story) => story.language === context.targetLanguage,
        );
        if (request.channel === "stories/read")
          return this.#environment.success(request, {
            rootGeneration: root.generation,
            learningContext: context,
            stories,
            positions: await storyPositions(db, context),
          });
        if (
          request.payload.expectedGeneration !== root.generation ||
          request.payload.language !== context.targetLanguage
        )
          return this.#environment.failure(request, "stale-data-root");
        const story = stories.find((item) => item.id === request.payload.storyId);
        if (!story) return this.#environment.failure(request, "not-found");
        if (request.channel === "stories/position") {
          await saveStoryPosition(db, context, story, request.payload.paragraph);
          return this.#environment.success(request, { saved: true });
        }
        const added = await saveStoryWord(db, context, story, request.payload.word);
        this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
        return this.#environment.success(request, { added });
      }
      case "learning-path/vocabulary":
      case "learning-path/read":
      case "learning-path/update":
      case "learning-path/prepare-voice": {
        const root = await this.#root.dataRootState(request.requestId);
        if (root.status !== "ready" || !this.#root.repository || !this.#root.database)
          return this.#environment.failure(request, "stale-data-root");
        const learningContext = await this.#root.repository.requireLearningContext();
        const course =
          learningContext.courseId !== null
            ? await readLearningCourse(
                this.#environment.curriculumRoot,
                learningContext.targetLanguage,
              )
            : null;
        const explanationLanguage =
          learningContext.explanationLanguage === "en-US"
            ? "en"
            : learningContext.explanationLanguage;
        if (request.channel === "learning-path/read")
          return this.#environment.success(request, {
            rootGeneration: root.generation,
            learningContext,
            course,
            state: await this.#root.repository.readLearningPathState(),
          });
        if (request.payload.expectedGeneration !== root.generation)
          return this.#environment.failure(request, "stale-data-root");
        if (!course) return this.#environment.failure(request, "not-found");
        if (request.channel === "learning-path/vocabulary") {
          const added = await addCourseVocabulary(
            this.#root.database,
            course,
            request.payload.reference,
            explanationLanguage,
          );
          this.#environment.emitEvent({ event: "state-invalidated", scope: "vocabulary" });
          return this.#environment.success(request, { added });
        }
        if (request.channel === "learning-path/update") {
          await this.#root.repository.updateLearningPath(
            course,
            request.payload,
            explanationLanguage,
          );
          this.#environment.emitEvent({ event: "state-invalidated", scope: "dashboard" });
          return this.#environment.success(request, {
            rootGeneration: root.generation,
            learningContext,
            course,
            state: await this.#root.repository.readLearningPathState(),
          });
        }
        if ((await readAiConnections(this.#root.database)).routing.liveConversation !== "codex")
          return this.#environment.failure(request, "not-found");
        const activities = await this.#activities.activities(request.requestId);
        return this.#environment.success(
          request,
          await activities.prepareCourseVoice(
            {
              action: "prepare-course-voice",
              ...request.payload,
            },
            request.requestId,
            explanationLanguage,
          ),
        );
      }
    }
  }
}
