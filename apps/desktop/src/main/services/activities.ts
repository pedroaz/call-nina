import { createHash } from "node:crypto";
import {
  activityActionSchema,
  openActivityActionSchema,
  activityIdSchema,
  attemptIdSchema,
  exerciseIdSchema,
  correlationIdSchema,
  utcInstantSchema,
  type ActivityAction,
  type DesktopIpcEvent,
  type DesktopIpcRequest,
} from "@call-nina/contracts";
import {
  materializeContentExercises,
  assertSharedExerciseActivity,
  resolveActivityDestination,
  resolveCourseReference,
} from "@call-nina/domain";
import {
  assertCallNinaDatabaseLease,
  prepareCourseTeaching,
  readFlashcards,
  readLearningCourse,
  type CallNinaDatabase,
  type CallNinaRepository,
} from "@call-nina/persistence";
import { opaqueId } from "../backend-support.js";
import { createCodexVoiceActivityUrl } from "../deep-link.js";

/** Request-scoped application service. Never retain it across a data-root switch. */
export class ActivityService {
  readonly #database: CallNinaDatabase;
  readonly #repository: CallNinaRepository;
  readonly #curriculumRoot: string;
  readonly #emitEvent: ((event: DesktopIpcEvent) => void) | undefined;

  constructor(options: {
    database: CallNinaDatabase;
    repository: CallNinaRepository;
    curriculumRoot: string;
    emitEvent?: (event: DesktopIpcEvent) => void;
  }) {
    this.#database = options.database;
    this.#repository = options.repository;
    this.#curriculumRoot = options.curriculumRoot;
    this.#emitEvent = options.emitEvent;
  }

  get generation() {
    return this.#database.rootGeneration;
  }

  async #validate(value: ActivityAction) {
    const action = activityActionSchema.parse(value);
    if (action.expectedGeneration !== undefined && action.expectedGeneration !== this.generation)
      throw new Error("OD_DATA_ROOT_STALE");
    await assertCallNinaDatabaseLease(this.#database);
    return action;
  }

  async #load(value: ActivityAction) {
    const action = await this.#validate(value);
    if (!("activityId" in action)) throw new Error("OD_ACTIVITY_ACTION_INVALID");
    const activity = await this.#repository.readPreparedActivity(action.activityId);
    const deletionStatus = await this.#repository.readPreparedActivityDeletionStatus(
      action.activityId,
    );
    if (!activity || !deletionStatus) throw new Error("OD_ACTIVITY_NOT_FOUND");
    const generated = await this.#repository.readGeneratedActivity(action.activityId);
    return { activity, deletionStatus, generated };
  }

  async resolve(value: Extract<ActivityAction, { action: "open-activity" }>) {
    const loaded = await this.#load(openActivityActionSchema.parse(value));
    const destination = resolveActivityDestination(loaded.activity, Boolean(loaded.generated));
    if (destination === "flashcards") {
      await readFlashcards(this.#database, {
        activityId: loaded.activity.activityId,
        rootGeneration: this.generation,
      });
    }
    if (
      destination === "generated-exercises" &&
      loaded.generated?.aiProvenance.modelSelection.availability !== "reported"
    )
      throw new Error("OD_ACTIVITY_NOT_FOUND");
    await assertCallNinaDatabaseLease(this.#database);
    return {
      activity: loaded.activity,
      deletionStatus: loaded.deletionStatus,
      destination,
      rootGeneration: this.generation,
    };
  }

  async readGenerated(activityId: string) {
    const { generated, deletionStatus } = await this.#load({
      action: "read-generated",
      activityId: activityIdSchema.parse(activityId),
      expectedGeneration: this.generation,
    });
    if (!generated || generated.aiProvenance.modelSelection.availability !== "reported")
      throw new Error("OD_ACTIVITY_NOT_FOUND");
    const activeSet = await this.#repository.readActiveGeneratedExerciseSet(generated.activityId);
    return {
      learningScope: generated.context.learningScope,
      activityId: generated.activityId,
      title: generated.title,
      curriculumTopicIds: generated.context.curriculumTopicIds,
      deletionStatus,
      activeSet: activeSet ?? null,
      ...(generated.context.courseTeaching
        ? { missionFacts: generated.context.courseTeaching.mission.facts }
        : {}),
      provenance: {
        modelRequestId: generated.aiProvenance.modelRequestId,
        generatedAt: generated.aiProvenance.generatedAt,
        modelId: generated.aiProvenance.modelSelection.modelId,
        effortId: generated.aiProvenance.modelSelection.effortId,
      },
      content: generated.content,
    };
  }

  async readGenerationSource(activityId: string) {
    const { activity } = await this.#load({
      action: "prepare-exercises",
      activityId: activityIdSchema.parse(activityId),
      expectedGeneration: this.generation,
    });
    return assertSharedExerciseActivity(activity);
  }

  async reuseExercises(value: Extract<ActivityAction, { action: "reuse-exercises" }>) {
    await this.#validate(value);
    // Validate course association against the installed course only when credit is requested.
    if (value.context.origin === "learning-path") {
      const course = await readLearningCourse(this.#curriculumRoot);
      resolveCourseReference(course, value.context.reference);
    }
    return this.#repository.reuseGeneratedActivity(value);
  }

  async startExercises(
    input: Extract<DesktopIpcRequest, { channel: "exercise-set/start" }>["payload"],
  ) {
    const { activityId } = input;
    const { activity, generated } = await this.#load({
      action: "start-exercises",
      activityId: activityIdSchema.parse(activityId),
      expectedGeneration: input.expectedGeneration,
    });
    if (!generated) throw new Error("OD_ACTIVITY_NOT_FOUND");
    assertSharedExerciseActivity(activity);
    const active = await this.#repository.readActiveGeneratedExerciseSet(activityId);
    if (active && input.intent === "resume") {
      return {
        activityId: generated.activityId,
        status: "started" as const,
        startedAt: active.startedAt,
        attemptIds: active.attemptIds,
      };
    }
    if (activity.context.learningPath) {
      const course = await readLearningCourse(this.#curriculumRoot);
      resolveCourseReference(course, activity.context.learningPath);
    }
    const startedAt = utcInstantSchema.parse(new Date().toISOString());
    const definitions = materializeContentExercises(generated.content, {
      exerciseIds: generated.content.payload.exercises.map((_, position) =>
        exerciseIdSchema.parse(
          `exercise_${createHash("sha256")
            .update(`${input.launchId}:exercise:${String(position)}`)
            .digest("hex")
            .slice(0, 32)}`,
        ),
      ),
      aiProvenance: generated.aiProvenance,
      curriculumTopicIds: generated.context.curriculumTopicIds,
    });
    const attemptIds = definitions.map((_, position) =>
      attemptIdSchema.parse(
        `attempt_${createHash("sha256")
          .update(`${input.launchId}:attempt:${String(position)}`)
          .digest("hex")
          .slice(0, 32)}`,
      ),
    );
    const set = await this.#repository.startGeneratedExerciseSet({
      activityId: generated.activityId,
      startedAt,
      replaces: input.intent === "new-attempt" ? (active?.attemptIds ?? []) : [],
      exercises: definitions.map((exercise, position) => ({
        attemptId: attemptIdSchema.parse(attemptIds[position]),
        snapshot: { schemaVersion: 1, lifecycle: "started", startedAt, exercise },
      })),
    });
    return { activityId: generated.activityId, status: "started" as const, ...set };
  }

  async #voice(action: ActivityAction) {
    const loaded = await this.#load(action);
    if (
      !loaded.activity.context.voiceContext ||
      (loaded.activity.activityType !== "voice-speaking" &&
        loaded.activity.activityType !== "codex-listening")
    )
      throw new Error("OD_ACTIVITY_NOT_FOUND");
    return { ...loaded, context: loaded.activity.context.voiceContext };
  }

  async readVoice(activityId: string) {
    const { activity, deletionStatus, context } = await this.#voice({
      action: "read-voice",
      activityId: activityIdSchema.parse(activityId),
      expectedGeneration: this.generation,
    });
    return {
      activityId: activity.activityId,
      title: activity.title,
      originSurface: activity.originSurface,
      preparedAt: activity.preparedAt,
      deletionStatus,
      context,
    };
  }

  async openVoice(
    activityId: string,
    ports: {
      isCodexVoiceAvailable: () => Promise<boolean>;
      openExternal?: (url: string) => Promise<void>;
    },
  ) {
    const { activity } = await this.#voice({
      action: "open-voice-in-codex",
      activityId: activityIdSchema.parse(activityId),
      expectedGeneration: this.generation,
    });
    if (!(await ports.isCodexVoiceAvailable())) return { status: "setup-required" as const };
    if (!ports.openExternal) throw new Error("OD_ACTIVITY_HANDOFF_FAILED");
    // Capability discovery can await a runtime: recheck current state before the side effect.
    await this.#voice({
      action: "open-voice-in-codex",
      activityId: activity.activityId,
      expectedGeneration: this.generation,
    });
    const url = createCodexVoiceActivityUrl(
      activity.activityId,
      this.generation,
      activity.context.learningScope,
    );
    try {
      await ports.openExternal(url);
    } catch {
      throw new Error("OD_ACTIVITY_HANDOFF_FAILED");
    }
    return { status: "open-requested" as const };
  }

  async delete(activityId: string) {
    await this.#validate({
      action: "delete-activity",
      activityId: activityIdSchema.parse(activityId),
      expectedGeneration: this.generation,
    });
    if (!(await this.#repository.readPreparedActivity(activityId)))
      throw new Error("OD_ACTIVITY_NOT_FOUND");
    // Persistence owns the transactional current-state/deletion policy.
    await this.#repository.deletePreparedActivity(activityId);
    this.#emitEvent?.({ event: "state-invalidated", scope: "dashboard" });
    this.#emitEvent?.({ event: "state-invalidated", scope: "vocabulary" });
    return { activityId, status: "deleted" as const };
  }

  async prepareVoice(
    value: Extract<ActivityAction, { action: "prepare-voice" }>,
    requestIdValue: string,
  ) {
    const action = await this.#validate(value);
    if (action.action !== "prepare-voice") throw new Error("OD_ACTIVITY_ACTION_INVALID");
    const requestId = correlationIdSchema.parse(requestIdValue);
    const context = action.context;
    const digest = createHash("sha256").update(requestId, "utf8").digest("hex").slice(0, 32);
    const activityId = activityIdSchema.parse(`activity_${digest}`);
    await this.#repository.savePreparedActivity(
      {
        activityId,
        activityType: context.kind === "listening" ? "codex-listening" : "voice-speaking",
        title: action.title,
        originSurface: "desktop",
        context: {
          learningScope: action.learningScope,
          naturalRequest: context.scenario,
          instructions: `Prepared ${context.kind} context for ${context.scenario}.`,
          curriculumTopicIds: [],
          mistakeIds: [],
          vocabularyIds: [],
          voiceContext: context,
        },
        preparedAt: utcInstantSchema.parse(new Date().toISOString()),
      },
      requestId,
    );
    this.#emitEvent?.({ event: "state-invalidated", scope: "dashboard" });
    return { status: "prepared" as const, activityId };
  }

  async prepareCourseVoice(
    value: Extract<ActivityAction, { action: "prepare-course-voice" }>,
    requestIdValue: string,
    locale: "en" | "de",
  ) {
    const action = await this.#validate(value);
    if (action.action !== "prepare-course-voice") throw new Error("OD_ACTIVITY_ACTION_INVALID");
    const requestId = correlationIdSchema.parse(requestIdValue);
    const learningScope = await this.#repository.requireLearningScope();
    if (learningScope.targetLanguage !== "de" || learningScope.courseId !== "german-foundations")
      throw new Error("OD_COURSE_UNAVAILABLE");
    const course = await readLearningCourse(this.#curriculumRoot);
    if (!course) throw new Error("OD_COURSE_NOT_FOUND");
    const { reference, unit, activity } = resolveCourseReference(course, action.reference);
    if (activity.delivery !== "listening" && activity.delivery !== "speaking")
      throw new Error("OD_ACTIVITY_CAPABILITY_INVALID");
    const teaching = await prepareCourseTeaching(this.#database, course, reference, locale);
    const activityId = activityIdSchema.parse(opaqueId("activity"));
    await this.#repository.savePreparedActivity(
      {
        activityId,
        activityType: activity.delivery === "listening" ? "codex-listening" : "voice-speaking",
        title: `${unit.title[locale]} · ${activity.title[locale]}`.slice(0, 160),
        originSurface: "desktop",
        context: {
          learningScope,
          naturalRequest: activity.instructions[locale].slice(0, 1000),
          curriculumTopicIds: unit.curriculumTopicIds,
          mistakeIds: [],
          vocabularyIds: [],
          learningPath: reference,
          courseTeaching: teaching,
          voiceContext: {
            schemaVersion: 1,
            kind: activity.delivery,
            targetLevel: "a1",
            scenario: unit.scenario[locale].slice(0, 240),
            difficulty: "beginner",
            correctionTiming: "end",
            objectives: teaching.objectives.map((o) => o.description.slice(0, 500)),
            ...(activity.delivery === "listening"
              ? { script: activity.input?.slice(0, 2400) }
              : {}),
            questions: activity.questions.length
              ? activity.questions.map((q) => q[locale].slice(0, 500))
              : [activity.instructions[locale].slice(0, 500)],
            answerGuidance: activity.answers.length
              ? activity.answers.map((a) => a[locale].slice(0, 500))
              : teaching.objectives.map((o) => o.criterion.slice(0, 500)),
          },
        },
        preparedAt: utcInstantSchema.parse(new Date().toISOString()),
      },
      requestId,
    );
    this.#emitEvent?.({ event: "state-invalidated", scope: "dashboard" });
    return { activityId };
  }
}
