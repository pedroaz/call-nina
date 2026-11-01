import {
  activityIdSchema,
  utcInstantSchema,
  type CapturedTeachingContext,
  type DesktopIpcRequest,
  type LearningScope,
} from "@call-nina/contracts";
import { assertExerciseGenerationContext, evaluateExerciseAnswer } from "@call-nina/domain";
import { buildLearningCalibration, generationLevel } from "@call-nina/learning-workflows";
import {
  readUpload,
  readVocabularyAnalysis,
  vocabularyPracticeContext,
  type CallNinaRepository,
  type LearnerSettingsRecord,
} from "@call-nina/persistence";
import { nativeImage } from "electron";
import { opaqueId, selectionId, type AcceptedOperation } from "../backend-support.js";
import type { DesktopEnvironment } from "../desktop-environment.js";
import type { DesktopServices } from "./desktop-services.js";
import { readUploadImage, validateUploadImage } from "./upload-images.js";

export class GenerationContext {
  readonly #environment: DesktopEnvironment;
  readonly #services: () => Pick<
    DesktopServices,
    "exerciseContext" | "root" | "imports" | "providers" | "generation"
  >;

  get #exerciseContext() {
    return this.#services().exerciseContext;
  }
  get #root() {
    return this.#services().root;
  }

  get #imports() {
    return this.#services().imports;
  }
  get #providers() {
    return this.#services().providers;
  }
  get #generation() {
    return this.#services().generation;
  }
  constructor(
    environment: DesktopEnvironment,
    services: () => Pick<
      DesktopServices,
      "exerciseContext" | "root" | "imports" | "providers" | "generation"
    >,
  ) {
    this.#environment = environment;
    this.#services = services;
  }
  async reviewContext(scope: LearningScope) {
    const [relevantMistakes, vocabularyContext] = await Promise.all([
      this.#root.repository?.readCorrectionMistakeSample(6, scope) ?? Promise.resolve([]),
      this.#root.database
        ? vocabularyPracticeContext(this.#root.database, scope.targetLanguage)
        : Promise.resolve({ words: [], focuses: [] }),
    ]);
    return {
      relevantMistakes,
      vocabularyFocuses: vocabularyContext.focuses,
      vocabularyToReview: vocabularyContext.words.slice(0, 12).map((entry) => ({
        vocabularyId: entry.vocabularyId,
        lemma: entry.lemma,
        meaning: entry.meaning,
        ...(entry.examples[0] ? { example: entry.examples[0].text } : {}),
      })),
    };
  }

  async prepareExerciseFeedback(input: NonNullable<AcceptedOperation["exerciseFeedback"]>) {
    if (!this.#root.repository || input.expectedGeneration !== this.#root.database?.rootGeneration)
      throw new Error("OD_DATA_ROOT_STALE");
    const saved = await this.#root.repository.saveGeneratedExerciseAnswer({
      activityId: input.activityId,
      attemptId: input.attemptId,
      submittedAt: utcInstantSchema.parse(new Date().toISOString()),
      answer: input.answer,
    });
    const activity = await this.#root.repository.readPreparedActivity(input.activityId);
    if (!activity) throw new Error("OD_ACTIVITY_NOT_FOUND");
    if (
      evaluateExerciseAnswer(
        saved.snapshot.exercise,
        input.answer,
        activity.context.learningScope.targetLanguage,
      ).status !== "requires-ai"
    )
      throw new Error("OD_EXERCISE_AI_FEEDBACK_NOT_REQUIRED");
    return saved;
  }

  async enrichedOperationInput(
    input: Extract<DesktopIpcRequest, { channel: "learning-operation/start" }>["payload"]["input"],
    settings: LearnerSettingsRecord & { capturedContext?: CapturedTeachingContext },
    feedbackSnapshot?: Awaited<
      ReturnType<CallNinaRepository["saveGeneratedExerciseAnswer"]>
    >["snapshot"],
  ) {
    const resolvedUpload =
      "practiceSource" in input && input.practiceSource?.kind === "upload" && this.#root.database
        ? await readUpload(
            this.#root.database,
            input.practiceSource.reference,
            settings.learningContext.targetLanguage,
          )
        : undefined;
    const review = await this.reviewContext(settings.learningContext);
    const sourceTerms = resolvedUpload
      ? [resolvedUpload.text, ...resolvedUpload.items.map((item) => item.lemma)]
          .join("\n")
          .normalize("NFKC")
          .toLocaleLowerCase(settings.learningContext.targetLanguage)
      : undefined;
    const inSource = (lemma: string) =>
      sourceTerms?.includes(
        lemma.normalize("NFKC").toLocaleLowerCase(settings.learningContext.targetLanguage),
      ) ?? true;
    // History can shape scaffolding, but an upload must not inherit unrelated topics/words.
    const adaptiveContext = resolvedUpload
      ? {
          relevantMistakes: review.relevantMistakes.filter(
            (mistake) => mistake.kind === "grammar" || inSource(mistake.lemma),
          ),
          vocabularyFocuses: [],
          vocabularyToReview: review.vocabularyToReview.filter((word) => inSource(word.lemma)),
        }
      : review;
    const uploadContext = resolvedUpload?.material
      ? {
          uploadSource: {
            upload: { uploadId: resolvedUpload.uploadId, revisionId: resolvedUpload.revisionId },
            material: resolvedUpload.material,
            items: resolvedUpload.items,
          },
        }
      : {};
    const profile = settings.profile;
    const calibration =
      settings.capturedContext?.calibration ??
      buildLearningCalibration(settings.learningContext, profile);
    if (input.kind === "website-study-pack") {
      const capture = this.#imports.capture(input.captureId);
      if (
        !capture ||
        input.rootGeneration !== this.#root.database?.rootGeneration ||
        capture.rootGeneration !== input.rootGeneration ||
        capture.language !== settings.learningContext.targetLanguage
      )
        throw new Error("OD_UPLOAD_ANALYSIS_STALE");
      return { kind: input.kind, source: capture.source, calibration };
    }
    if (input.kind === "vocabulary-analysis") {
      if (!this.#root.database || input.rootGeneration !== this.#root.database.rootGeneration)
        throw new Error("OD_DATA_ROOT_STALE");
      const known = await vocabularyPracticeContext(
        this.#root.database,
        settings.learningContext.targetLanguage,
      );
      if (input.source.kind === "activity") {
        const source = await readVocabularyAnalysis(
          this.#root.database,
          input.source.activityId,
          input.source.sourceKey,
        );
        return {
          kind: input.kind,
          mode: "activity",
          sourceKey: source.sourceKey,
          sourceText: source.sourceText,
          guidance: "",
          calibration,
          knownWords: source.knownWords,
        };
      }
      if (input.source.kind === "upload") {
        const upload = await readUpload(
          this.#root.database,
          input.source.reference,
          settings.learningContext.targetLanguage,
        );
        if (upload.archived) throw new Error("OD_UPLOAD_NOT_FOUND");
        const image =
          upload.image && !upload.hasText
            ? await readUploadImage(this.#root.database.dataRoot, upload.image)
            : undefined;
        return {
          kind: input.kind,
          mode: "upload",
          upload: input.source.reference,
          sourceKey: `upload:${selectionId()}`,
          sourceText: upload.text,
          guidance:
            "Extract vocabulary only from this supplied content. Read image text when present.",
          ...(image ? { image } : {}),
          calibration,
          knownWords: [],
        };
      }
      if (input.source.kind === "preview") {
        validateUploadImage(input.source.image);
        return {
          kind: input.kind,
          mode: "preview",
          sourceKey: `preview:${selectionId()}`,
          sourceText: "",
          guidance: "Read the image text verbatim. Return no proposed vocabulary.",
          image: input.source.image,
          calibration,
          knownWords: [],
        };
      }
      const { image, guidance, text } = input.source;
      if (!image && !guidance.trim() && !text.trim()) throw new Error("OD_VOCABULARY_SOURCE_EMPTY");
      if (image) {
        const active = await this.#providers.requireRoutedConnection("vocabulary-analysis", true);
        if (active.routeId !== "chatgpt") throw new Error("OD_VOCABULARY_IMAGE_UNAVAILABLE");
        const bytes = Buffer.from(image.data, "base64");
        if (bytes.length > 10 * 1024 * 1024 || bytes.toString("base64") !== image.data)
          throw new Error("OD_VOCABULARY_IMAGE_INVALID");
        const decoded = nativeImage.createFromBuffer(bytes);
        const size = decoded.getSize();
        if (decoded.isEmpty() || size.width * size.height > 20_000_000)
          throw new Error("OD_VOCABULARY_IMAGE_INVALID");
      }
      return {
        kind: input.kind,
        mode: "import",
        sourceKey: `import:${selectionId()}`,
        sourceText: text,
        guidance,
        ...(image ? { image } : {}),
        calibration,
        knownWords: known.words.map((w) => ({
          vocabularyId: w.vocabularyId,
          lemma: w.lemma,
          meaning: w.meaning,
        })),
      };
    }
    if (input.kind === "flashcard-generation")
      return {
        kind: input.kind,
        topic: input.topic,
        cardCount: input.cardCount,
        targetLevel: generationLevel[input.targetLevel],
        adaptiveContext,
        ...uploadContext,
      };
    if (input.kind === "writing-prompt") {
      return {
        kind: input.kind,
        ...(input.naturalRequest ? { naturalRequest: input.naturalRequest } : {}),
        ...uploadContext,
        adaptiveContext,
        calibration,
      };
    }
    if (input.kind === "voice-activity-draft") {
      return {
        kind: input.kind,
        voiceKind: input.voiceKind,
        naturalRequest: input.naturalRequest,
        difficulty: input.difficulty,
        correctionTiming: input.correctionTiming,
        ...(input.speakingPace ? { speakingPace: input.speakingPace } : {}),
        ...uploadContext,
        adaptiveContext,
        targetLevel: generationLevel[input.targetLevel],
        calibration: { ...calibration, approximateLevel: generationLevel[input.targetLevel] },
      };
    }
    if (input.kind === "writing-correction") {
      return {
        kind: input.kind,
        ...uploadContext,
        adaptiveContext,
        learnerText: input.learnerText,
        activityGoal: input.activityGoal ?? settings.learningContext.goal.description,
        calibration: {
          ...calibration,
          teachingProfile:
            input.teachingProfile === "profile-default"
              ? profile.defaultTeachingProfileId
              : (input.teachingProfile ?? "strict-corrector"),
        },
        feedback: {
          coverage: input.feedbackCoverage ?? profile.correctionPreferences.coverage,
          showConciseExplanation: profile.correctionPreferences.showConciseExplanation,
          showNaturalAlternative: profile.correctionPreferences.showNaturalAlternative,
        },
        relevantMistakes: adaptiveContext.relevantMistakes,
      };
    }
    if (input.kind === "contextual-help") {
      if (!this.#root.repository) throw new Error("OD_DATA_ROOT_STALE");
      await this.#root.repository.recordCourseHelperSupport(input.intent, settings.learningContext);
      const helperKey = `${input.sessionId}:${settings.learningContext.targetLanguage}`;
      const session = this.#generation.operations.helperSession(helperKey, () => ({
        activityId: activityIdSchema.parse(opaqueId("activity")),
        turns: [],
      }));
      return {
        kind: input.kind,
        activityId: session.activityId,
        intent: input.intent,
        selectedText: input.selectedText,
        containingSentence: input.containingSentence,
        question: input.question,
        ...(input.activeResultSummary ? { activeResultSummary: input.activeResultSummary } : {}),
        calibration,
        relevantMistakes: await this.#root.repository.readCorrectionMistakeSample(
          4,
          settings.learningContext,
        ),
        priorTurns: session.turns,
      };
    }
    if (input.kind === "exercise-feedback") {
      if (!this.#root.repository) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      if (!feedbackSnapshot) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
      const snapshot = feedbackSnapshot;
      const generated = await this.#root.repository.readGeneratedActivity(input.activityId);
      const readingPassage = generated?.content.payload.readingMaterial?.passage;
      const readingContext = {
        ...(generated?.context.uploadSource
          ? { uploadSource: generated.context.uploadSource }
          : {}),
        ...(readingPassage ? { readingPassage } : {}),
        ...(generated?.context.courseTeaching?.objectives.length
          ? {
              courseCriterion: generated.context.courseTeaching.objectives
                .map((o) => o.criterion)
                .join("\n")
                .slice(0, 4000),
            }
          : {}),
      };
      const exercise = snapshot.exercise;
      if (exercise.kind === "free-writing" && input.answer.kind === "free-writing") {
        return {
          kind: input.kind,
          ...readingContext,
          learningContext: settings.learningContext,
          exercise: {
            kind: exercise.kind,
            instructions: exercise.instructions,
            prompt: exercise.content.prompt,
            objectives: exercise.objectives.map(({ description }) => description),
            learnerAnswer: input.answer.text,
          },
          calibration,
        };
      }
      if (exercise.kind === "short-answer" && input.answer.kind === "short-answer") {
        return {
          kind: input.kind,
          ...readingContext,
          learningContext: settings.learningContext,
          exercise: {
            kind: exercise.kind,
            instructions: exercise.instructions,
            question: exercise.content.question,
            objectives: exercise.objectives.map(({ description }) => description),
            acceptedAnswers: exercise.answerContract.acceptedAnswers,
            learnerAnswer: input.answer.text,
          },
          calibration,
        };
      }
      if (exercise.kind === "sentence-correction" && input.answer.kind === "sentence-correction") {
        return {
          kind: input.kind,
          ...readingContext,
          learningContext: settings.learningContext,
          exercise: {
            kind: exercise.kind,
            instructions: exercise.instructions,
            sentence: exercise.content.sentence,
            objectives: exercise.objectives.map(({ description }) => description),
            acceptedAnswers: exercise.answerContract.acceptedAnswers,
            learnerAnswer: input.answer.text,
          },
          calibration,
        };
      }
      throw new Error("OD_EXERCISE_ANSWER_KIND_MISMATCH");
    }
    {
      assertExerciseGenerationContext(input);
      const reviewContext = {
        ...uploadContext,
        ...adaptiveContext,
        entry: input.context,
      };
      return this.#exerciseContext.prepare(input, settings, reviewContext, calibration);
    }
    throw new Error("OD_LEARNING_OPERATION_UNSUPPORTED");
  }
}
