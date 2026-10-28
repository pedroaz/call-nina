import { PracticeComposer } from "./PracticeComposer.js";
import { ActivityVisual } from "./activityPresentation.js";
import type { PracticeKind } from "./PracticeTypeChooser.js";
import { startTopicPractice, practiceDefaults } from "./startTopicPractice.js";
import { CompletionActions } from "./CompletionActions.js";
import {
  MaterialPractice,
  emptyMaterialPracticeState,
  type MaterialPracticeState,
} from "./MaterialPractice.js";
import {
  type ProviderOperation,
  exerciseFeedbackCandidateSchema,
  type DesktopIpcResponse,
  type CallNinaError,
  type Language,
  type DataRootGeneration,
} from "@call-nina/contracts";
import { practiceStarterExamples } from "./practiceStarterExamples.js";
import { PracticeCount, validPracticeCount } from "./PracticeCount.js";
import { FlashcardWorkspace } from "./FlashcardWorkspace.js";
import { OperationProgress } from "./OperationProgress.js";
import type { PracticeLaunch } from "./usePracticeSuggestion.js";
import { CodexActivityPreparation } from "./CodexActivityPreparation.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { ReadingPractice } from "./ReadingPractice.js";
import { PreparedActivityWorkspace } from "./PreparedActivityWorkspace.js";
import { useActivityLibrary } from "./useActivityLibrary.js";
import { reusePracticeActivity } from "./generatePracticeActivity.js";
import { OperationError } from "./Startup.js";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { materializeContentExercises } from "@call-nina/domain";
import { FilePenLine, BookOpen, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ActivityWorkspace,
  ActivityReference,
  type ActivityReferenceItem,
} from "./components/activity/index.js";
import { ExerciseEngine } from "./ExerciseEngine.js";
import styles from "./PracticePage.module.css";
import {
  SelectControl,
  Button,
  Tabs,
  ConfirmDialog,
  FieldGroup,
  InfoHint,
  ItemList,
  Muted,
} from "./components/ui/index.js";
import { ActionGroup, Page, Section, ContentRow } from "./components/layout/index.js";
import { createDesktopSubmissionId, invokeDesktop, normalizeDesktopError } from "./ipc.js";

type PreparedActivityId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number]["activityId"];
type PreparedActivity = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number];
type PracticeLibraryFilter =
  | "flashcards"
  | "all"
  | "custom-lesson"
  | "grammar"
  | "reading"
  | "codex-listening"
  | "voice-speaking";
type PracticeLevel = "a1" | "a2" | "b1" | "b2";

export function PracticePage({
  onLanguageSwitchBlockedChange,
  selectedTab,
  onTabChange,
  targetLanguage,
  autoStart = false,
  initialPreparation,
  parentLabel,
  activityBreadcrumbs,
  activityTitle,
  courseCompletionActions,
  activityId,
  requestAiAccess,
  onOpenActivity,
  onCloseActivity,
  onVocabulary,
  onWriting,
  onHistory,
  onNina,
}: {
  onLanguageSwitchBlockedChange?: (blocked: boolean) => void;
  selectedTab?: "new" | "saved";
  onTabChange?: (tab: "new" | "saved") => void;
  targetLanguage?: Language | undefined;
  autoStart?: boolean;
  parentLabel?: string;
  activityBreadcrumbs?: ReadonlyArray<{ label: string; onPress: () => void }> | undefined;
  activityTitle?: string | undefined;
  courseCompletionActions?: ReactNode;
  initialPreparation?: Extract<PracticeLaunch, { destination: "preparation" }>;
  activityId?: PreparedActivityId;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onOpenActivity: (activityId: PreparedActivityId) => void;
  onCloseActivity: () => void;
  onVocabulary?: () => void;
  onWriting?: () => void;
  onHistory: (language: Language, rootGeneration: DataRootGeneration) => void;
  onNina: (language: Language, rootGeneration: DataRootGeneration) => void;
}) {
  const { t } = useTranslation();
  const [generatedResult, setGenerated] =
    useState<
      Extract<DesktopIpcResponse, { status: "ok"; channel: "prepared-activity/read" }>["result"]
    >();
  const [error, setError] = useState<CallNinaError>();
  const launchIds = useRef({
    resume: createDesktopSubmissionId(),
    newAttempt: createDesktopSubmissionId(),
  });
  const [startedAttemptIds, setStartedAttemptIds] =
    useState<
      Extract<
        DesktopIpcResponse,
        { status: "ok"; channel: "exercise-set/start" }
      >["result"]["attemptIds"]
    >();
  const [customRequest, setCustomRequest] = useState(
    initialPreparation?.kind === "custom" ? initialPreparation.prompt : "",
  );
  const [grammarRequest, setGrammarRequest] = useState(
    initialPreparation?.kind === "grammar" ? initialPreparation.prompt : "",
  );
  const [quizCount, setQuizCount] = useState(String(practiceDefaults.exerciseCount));
  const [cardCount, setCardCount] = useState(String(practiceDefaults.cardCount));
  const [flashcardTopic, setFlashcardTopic] = useState(
    initialPreparation?.kind === "flashcards" ? initialPreparation.prompt : "",
  );
  const [listeningTopic, setListeningTopic] = useState(
    initialPreparation?.kind === "listening" ? initialPreparation.prompt : "",
  );
  const [speakingTopic, setSpeakingTopic] = useState(
    initialPreparation?.kind === "speaking" ? initialPreparation.prompt : "",
  );
  const [readingTopic, setReadingTopic] = useState(
    initialPreparation?.kind === "reading" ? initialPreparation.prompt : "",
  );
  const [vocabularyMaterialState, setVocabularyMaterialState] = useState<MaterialPracticeState>(
    emptyMaterialPracticeState,
  );
  const [readingMaterialState, setReadingMaterialState] = useState<MaterialPracticeState>(
    emptyMaterialPracticeState,
  );
  const exerciseCount = Number(quizCount);
  const quizCountValid = validPracticeCount(quizCount);
  const [targetLevel, setTargetLevel] = useState<PracticeLevel>("a2");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [readingBusy, setReadingBusy] = useState(false);
  const [materialBusy, setMaterialBusy] = useState(false);
  const levelEdited = useRef(false);
  useEffect(() => {
    let current = true;
    void invokeDesktop("learner-profile/read", {})
      .then((result) => {
        if (current && !levelEdited.current && result.status === "ready") {
          setTargetLevel(result.profile.approximateLevel);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  const generation = useLearningOperation();
  const feedback = useLearningOperation();
  const generating = generation.busy;
  const formBusy = generating || voiceBusy || readingBusy || materialBusy;
  const [generationError, setGenerationError] = useState<CallNinaError>();
  const [deleting, setDeleting] = useState(false);
  const [localLibraryView, setLocalLibraryView] = useState(false);
  const libraryView = selectedTab ? selectedTab === "saved" : localLibraryView;
  const setLibraryView = (saved: boolean) => {
    setLocalLibraryView(saved);
    onTabChange?.(saved ? "saved" : "new");
  };
  const returnPosition = useRef<{ y: number; id: string } | undefined>(undefined);
  const openSavedActivity = async (id: PreparedActivityId) => {
    returnPosition.current = { y: window.scrollY, id };
    try {
      const source = await invokeDesktop("activity/resolve", {
        action: "open-activity",
        activityId: id,
      });
      if (source.destination === "generated-exercises" && source.activity.context.learningPath) {
        const content = await invokeDesktop("prepared-activity/read", { activityId: id });
        onOpenActivity(
          await reusePracticeActivity({
            activityId: id,
            content: content.content,
            context: { origin: "free-practice" },
            expectedGeneration: source.rootGeneration,
          }),
        );
      } else onOpenActivity(id);
    } catch (cause) {
      setLibraryMutationError(normalizeDesktopError(cause).detail);
    }
  };
  const [selectedKind, setSelectedKind] = useState<PracticeKind>(
    initialPreparation?.kind ?? "custom",
  );
  const [libraryFilter, setLibraryFilter] = useState<PracticeLibraryFilter>("all");
  const library = useActivityLibrary(
    libraryFilter === "all"
      ? [
          "flashcards",
          "grammar",
          "custom-lesson",
          "reading",
          "writing",
          "vocabulary-review",
          "placement",
          "codex-listening",
          "voice-speaking",
        ]
      : [libraryFilter],
  );
  const preparedActivities = library.entries;
  const libraryBusy = library.busy;
  const [libraryMutationError, setLibraryMutationError] = useState<CallNinaError>();
  const libraryError = libraryMutationError ?? library.error;
  const [prepared, setPrepared] =
    useState<
      Extract<DesktopIpcResponse, { status: "ok"; channel: "activity/resolve" }>["result"]
    >();

  const languageSwitchBlocked = Boolean(
    activityId ||
    prepared ||
    formBusy ||
    deleting ||
    [
      customRequest,
      grammarRequest,
      flashcardTopic,
      listeningTopic,
      speakingTopic,
      readingTopic,
    ].some((text) => text.trim().length > 0) ||
    [vocabularyMaterialState, readingMaterialState].some(
      (state) => state.selected || state.view === "edit" || Object.keys(state.drafts).length > 0,
    ),
  );
  useEffect(() => {
    onLanguageSwitchBlockedChange?.(languageSwitchBlocked);
    return () => onLanguageSwitchBlockedChange?.(false);
  }, [languageSwitchBlocked, onLanguageSwitchBlockedChange]);

  const generated = prepared?.activity.activityId === activityId ? generatedResult : undefined;
  useEffect(() => {
    if (!activityId && !libraryBusy && returnPosition.current) {
      const position = returnPosition.current;
      const frame = window.requestAnimationFrame(() => {
        window.scrollTo(0, position.y);
        document.getElementById(`activity-open-${position.id}`)?.focus({ preventScroll: true });
        returnPosition.current = undefined;
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    return undefined;
  }, [activityId, libraryBusy, preparedActivities.length]);
  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    const timer = window.setTimeout(() => {
      setPrepared(undefined);
      setGenerated(undefined);
      setStartedAttemptIds(undefined);
      launchIds.current = {
        resume: createDesktopSubmissionId(),
        newAttempt: createDesktopSubmissionId(),
      };
      setError(undefined);
      if (!activityId) return;
      window.scrollTo(0, 0);
      void invokeDesktop("activity/resolve", { action: "open-activity", activityId })
        .then(async (result) => {
          if (!current) return;
          if (result.destination === "generated-exercises") {
            const loaded = await invokeDesktop("prepared-activity/read", { activityId });
            if (!isCurrent()) return;
            const opened = await invokeDesktop("activity/resolve", {
              action: "open-activity",
              activityId,
              expectedGeneration: result.rootGeneration,
            });
            if (isCurrent()) {
              setPrepared(opened);
              setGenerated(loaded);
            }
          } else {
            const opened = await invokeDesktop("activity/resolve", {
              action: "open-activity",
              activityId,
              expectedGeneration: result.rootGeneration,
            });
            if (isCurrent()) setPrepared(opened);
          }
        })
        .catch((cause: unknown) => {
          if (current) setError(normalizeDesktopError(cause).detail);
        });
    }, 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [activityId]);
  useEffect(() => {
    if (!activityId || prepared?.activity.activityId !== activityId) return;
    // This effect runs after the resolved activity has committed to the view.
    // Loading and reuse probes must never advance Continue's last-used marker.
    let current = true;
    void invokeDesktop("activity/resolve", {
      action: "open-activity",
      activityId,
      expectedGeneration: prepared.rootGeneration,
      recordUse: true,
    }).catch((cause: unknown) => {
      if (current) setError(normalizeDesktopError(cause).detail);
    });
    return () => {
      current = false;
    };
  }, [activityId, prepared]);
  const exercises = useMemo(
    () =>
      generated
        ? materializeContentExercises(generated.content, {
            exerciseIds: generated.content.payload.exercises.map(
              (_, position) => `exercise_${String(position).padStart(16, "0")}`,
            ),
            aiProvenance: {
              source: "ai",
              producer: "desktop-app-server",
              modelRequestId: generated.provenance.modelRequestId,
              generatedAt: generated.provenance.generatedAt,
              modelSelection: {
                availability: "reported",
                modelId: generated.provenance.modelId,
                effortId: generated.provenance.effortId,
              },
            },
            curriculumTopicIds: generated.curriculumTopicIds,
          })
        : [],
    [generated],
  );
  const filteredActivities = preparedActivities;
  const deletePreparedActivity = async (activityToDelete: PreparedActivity) => {
    setLibraryMutationError(undefined);
    try {
      await invokeDesktop("prepared-activity/delete", { activityId: activityToDelete.activityId });
      await library.refresh();
    } catch (cause: unknown) {
      setLibraryMutationError(normalizeDesktopError(cause).detail);
    }
  };
  if (
    activityId &&
    prepared?.activity.activityId === activityId &&
    prepared.destination === "flashcards"
  ) {
    return (
      <FlashcardWorkspace
        activityBreadcrumbs={activityBreadcrumbs}
        activityTitle={activityTitle}
        key={activityId}
        activityId={activityId}
        parentLabel={parentLabel ?? t("practice.title")}
        onHistory={() => {
          onHistory(
            prepared.activity.context.learningScope.targetLanguage,
            prepared.rootGeneration,
          );
        }}
        onNina={() => {
          onNina(prepared.activity.context.learningScope.targetLanguage, prepared.rootGeneration);
        }}
        courseCompletionActions={courseCompletionActions}
        onClose={onCloseActivity}
        onVocabulary={onVocabulary ?? onCloseActivity}
      />
    );
  }
  if (
    activityId &&
    prepared &&
    prepared.activity.activityId === activityId &&
    prepared.destination === "prepared"
  ) {
    return (
      <PreparedActivityWorkspace
        activityBreadcrumbs={activityBreadcrumbs}
        activityTitle={activityTitle}
        parentLabel={parentLabel ?? t("practice.title")}
        prepared={prepared}
        courseCompletionActions={courseCompletionActions}
        onClose={onCloseActivity}
        onOpenActivity={onOpenActivity}
        requestAiAccess={requestAiAccess}
      />
    );
  }
  if (activityId) {
    const deleteGeneratedLesson = async () => {
      setDeleting(true);
      setError(undefined);
      try {
        await invokeDesktop("prepared-activity/delete", { activityId });
        onCloseActivity();
      } catch (cause: unknown) {
        setError(normalizeDesktopError(cause).detail);
      } finally {
        setDeleting(false);
      }
    };
    const references: ActivityReferenceItem[] = [];
    const reading = generated?.content.payload.readingMaterial;
    const lesson = generated?.content.payload.lesson;
    if (reading)
      references.push({
        id: "reading",
        label: t("activity.reading"),
        content: (
          <article>
            <h2>{reading.title}</h2>
            <p className={styles.readingPassage}>{reading.passage}</p>
          </article>
        ),
      });
    if (generated?.missionFacts)
      references.push({
        id: "facts",
        label: t("missions.sharedFacts"),
        content: (
          <article>
            <h2>{t("missions.sharedFacts")}</h2>
            <p className={styles.readingPassage}>{generated.missionFacts}</p>
          </article>
        ),
      });
    if (lesson)
      references.push({
        id: "lesson",
        label: t("activity.lesson"),
        content: (
          <article className={styles.practiceLessonBody}>
            <h2>{lesson.title}</h2>
            <p>{lesson.explanation}</p>
            {lesson.sections.map((section) => (
              <section key={section.heading}>
                <h3>{section.heading}</h3>
                <p>{section.content}</p>
              </section>
            ))}
            {lesson.vocabularyFoundations.length > 0 && (
              <section>
                <h3>{t("exercises.custom.vocabulary")}</h3>
                <ItemList>
                  {lesson.vocabularyFoundations.map((item) => (
                    <li key={`${item.term}:${item.example}`}>
                      <strong>{item.term}</strong> — {item.explanation}
                      <Muted as="span">{item.example}</Muted>
                    </li>
                  ))}
                </ItemList>
              </section>
            )}
          </article>
        ),
      });
    return (
      <ActivityWorkspace
        data-activity-id={activityId}
        data-activity-material-id={generated?.content.materials[0]?.materialId}
        data-activity-material-revision={generated?.content.materials[0]?.revisionId}
        data-root-generation={prepared?.rootGeneration}
        data-learning-language={prepared?.activity.context.learningScope.targetLanguage}
        title={activityTitle ?? generated?.title ?? t("exercises.loading")}
        breadcrumbs={
          activityBreadcrumbs ?? [
            { label: parentLabel ?? t("practice.title"), onPress: onCloseActivity },
          ]
        }
        actions={
          generated &&
          generated.deletionStatus !== "retained-data" && (
            <ConfirmDialog
              body={t(
                generated.deletionStatus === "cascade"
                  ? "exercises.delete.cascadeBody"
                  : "exercises.delete.body",
              )}
              cancel={t("actions.cancel")}
              confirm={t("exercises.delete.confirm")}
              onConfirm={() => deleteGeneratedLesson()}
              title={t("exercises.delete.title")}
              trigger={deleting ? t("exercises.delete.deleting") : t("practice.session.delete")}
              menuLabel={t("ui.activityActions")}
              triggerVariant="secondary"
            />
          )
        }
      >
        {error && <OperationError error={error} />}
        {generated && (
          <ExerciseEngine
            reference={
              references.length > 0 ? (
                <ActivityReference label={t("activity.reference")} items={references} />
              ) : undefined
            }
            autoStart={autoStart}
            completionActions={
              courseCompletionActions ??
              (prepared && (
                <CompletionActions
                  targetLanguage={generated.learningScope.targetLanguage}
                  rootGeneration={prepared.rootGeneration}
                  parentLabel={parentLabel ?? t("practice.title")}
                  onReturn={onCloseActivity}
                  onHistory={() => {
                    onHistory(generated.learningScope.targetLanguage, prepared.rootGeneration);
                  }}
                  onNina={() => {
                    onNina(generated.learningScope.targetLanguage, prepared.rootGeneration);
                  }}
                />
              ))
            }
            targetLanguage={generated.learningScope.targetLanguage}
            {...(feedback.busy ? { onCancelAiEvaluation: feedback.cancel } : {})}
            key={activityId}
            exercises={exercises}
            evaluationProgress={<OperationProgress progress={feedback.progress} />}
            {...(generated.activeSet ? { progress: generated.activeSet.progress } : {})}
            onStarted={async () => {
              if (!prepared) throw new Error("OD_ACTIVITY_NOT_FOUND");
              const started = await invokeDesktop("exercise-set/start", {
                activityId,
                intent: "resume",
                launchId: launchIds.current.resume,
                expectedGeneration: prepared.rootGeneration,
              });
              setStartedAttemptIds(started.attemptIds);
            }}
            onNewAttempt={async () => {
              if (!prepared) throw new Error("OD_ACTIVITY_NOT_FOUND");
              const started = await invokeDesktop("exercise-set/start", {
                activityId,
                intent: "new-attempt",
                launchId: launchIds.current.newAttempt,
                expectedGeneration: prepared.rootGeneration,
              });
              setStartedAttemptIds(started.attemptIds);
            }}
            onAnswerSubmitted={async (answer, position) => {
              const attemptId = startedAttemptIds?.[position];
              if (!attemptId) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
              if (!prepared) throw new Error("OD_ACTIVITY_NOT_FOUND");
              const saved = await invokeDesktop("exercise-set/answer", {
                activityId,
                attemptId,
                answer,
                expectedGeneration: prepared.rootGeneration,
              });
              return saved.feedback;
            }}
            onAiEvaluationRequested={async (evaluation, exercisePosition) => {
              if (!(await requestAiAccess("exercise-feedback")))
                throw new Error("OD_AI_DISCLOSURE_REQUIRED");
              if (!prepared) throw new Error("OD_ACTIVITY_NOT_FOUND");
              const attemptId = startedAttemptIds?.[exercisePosition];
              if (!attemptId) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
              if (
                evaluation.answer.kind !== "free-writing" &&
                evaluation.answer.kind !== "short-answer" &&
                evaluation.answer.kind !== "sentence-correction"
              ) {
                throw new Error("OD_EXERCISE_AI_FEEDBACK_NOT_REQUIRED");
              }
              const result = await feedback.run({
                kind: "exercise-feedback",
                expectedGeneration: prepared.rootGeneration,
                activityId,
                attemptId,
                answer: evaluation.answer,
              });
              return exerciseFeedbackCandidateSchema.parse(result.output);
            }}
            onSupportUsed={async (position) => {
              const attemptId = startedAttemptIds?.[position];
              if (!attemptId) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
              await invokeDesktop("exercise-set/support", { activityId, attemptId });
            }}
            onCompleted={async (evaluations) => {
              if (!startedAttemptIds || startedAttemptIds.length !== evaluations.length) {
                throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
              }
              await invokeDesktop("exercise-set/complete", {
                activityId,
                answers: evaluations.map((evaluation, position) => {
                  const attemptId = startedAttemptIds[position];
                  if (!attemptId) throw new Error("OD_EXERCISE_ATTEMPT_SET_INVALID");
                  return { attemptId, answer: evaluation.answer };
                }),
              });
            }}
          />
        )}
      </ActivityWorkspace>
    );
  }
  const generateCustomLesson = async (
    requestedLesson: string,
    source: "natural-request" | "grammar",
  ) => {
    if (
      !quizCountValid ||
      !requestedLesson.trim() ||
      !(await requestAiAccess("exercise-generation"))
    )
      return;
    setGenerationError(undefined);
    try {
      const createdId = await startTopicPractice(
        {
          kind: source === "grammar" ? "grammar" : "custom",
          topic: requestedLesson,
          count: exerciseCount,
          targetLevel,
        },
        generation.run,
      );
      onOpenActivity(createdId);
    } catch (cause) {
      setGenerationError(normalizeDesktopError(cause).detail);
    }
  };
  const quizLengthControl = (
    <PracticeCount
      value={selectedKind === "flashcards" ? cardCount : quizCount}
      onChange={selectedKind === "flashcards" ? setCardCount : setQuizCount}
      disabled={formBusy}
      flashcards={selectedKind === "flashcards"}
    />
  );
  const practiceSettings = (
    <div className={styles.practiceControls}>
      <FieldGroup>
        {t("practice.targetLevel")}
        <SelectControl
          value={targetLevel}
          disabled={formBusy}
          onChange={(event) => {
            levelEdited.current = true;
            setTargetLevel(event.target.value as PracticeLevel);
          }}
        >
          {(["a1", "a2", "b1", "b2"] as const).map((level) => (
            <option key={level} value={level}>
              {level.toUpperCase()}
            </option>
          ))}
        </SelectControl>
      </FieldGroup>
      {selectedKind !== "listening" && selectedKind !== "speaking" && quizLengthControl}
    </div>
  );
  const generateFlashcards = async () => {
    if (
      !validPracticeCount(cardCount) ||
      !flashcardTopic.trim() ||
      !(await requestAiAccess("flashcard-generation"))
    )
      return;
    setGenerationError(undefined);
    try {
      const activityId = await startTopicPractice(
        { kind: "flashcards", topic: flashcardTopic, count: Number(cardCount), targetLevel },
        generation.run,
      );
      onOpenActivity(activityId);
    } catch (cause) {
      setGenerationError(normalizeDesktopError(cause).detail);
    }
  };

  return (
    <Page
      title={t("practice.title")}
      width="form"
      className={styles.creationPage}
      refresh={{ onRefresh: library.refresh, busy: libraryBusy }}
      actions={
        onWriting && (
          <Button
            variant="secondary"
            leadingIcon={<FilePenLine aria-hidden="true" />}
            onPress={onWriting}
          >
            {t("nav.writing")}
          </Button>
        )
      }
    >
      <Tabs
        label={t("practice.title")}
        selectedKey={libraryView ? "saved" : "new"}
        onSelectionChange={(key) => {
          setLibraryView(key === "saved");
        }}
        items={[
          {
            id: "new",
            label: t("ui.newPractice"),
            children: (
              <div className={styles.creationStudio}>
                <PracticeComposer
                  kind={selectedKind}
                  onKindChange={(kind) => {
                    const topics = {
                      custom: customRequest,
                      grammar: grammarRequest,
                      flashcards: flashcardTopic,
                      reading: readingTopic,
                      listening: listeningTopic,
                      speaking: speakingTopic,
                    };
                    const setters = {
                      custom: setCustomRequest,
                      grammar: setGrammarRequest,
                      flashcards: setFlashcardTopic,
                      reading: setReadingTopic,
                      listening: setListeningTopic,
                      speaking: setSpeakingTopic,
                    };
                    if (!topics[kind]) setters[kind](topics[selectedKind]);
                    setSelectedKind(kind);
                  }}
                  disabled={formBusy}
                  topic={
                    {
                      custom: customRequest,
                      grammar: grammarRequest,
                      flashcards: flashcardTopic,
                      reading: readingTopic,
                      listening: listeningTopic,
                      speaking: speakingTopic,
                    }[selectedKind]
                  }
                  onTopicChange={
                    {
                      custom: setCustomRequest,
                      grammar: setGrammarRequest,
                      flashcards: setFlashcardTopic,
                      reading: setReadingTopic,
                      listening: setListeningTopic,
                      speaking: setSpeakingTopic,
                    }[selectedKind]
                  }
                />
                {(selectedKind === "listening" || selectedKind === "speaking") && practiceSettings}

                {generationError && <OperationError error={generationError} />}
                <Section>
                  <div hidden={selectedKind !== "flashcards"}>
                    <Section as="article">
                      {practiceSettings}
                      <OperationProgress progress={generation.progress} />
                      <ActionGroup>
                        <Button
                          variant="primary"
                          isDisabled={
                            formBusy || !validPracticeCount(cardCount) || !flashcardTopic.trim()
                          }
                          onPress={() => void generateFlashcards()}
                        >
                          {t("flashcards.generate")}
                        </Button>
                        {generating && (
                          <Button variant="secondary" onPress={generation.cancel}>
                            {t("actions.cancel")}
                          </Button>
                        )}
                      </ActionGroup>
                      <MaterialPractice
                        state={vocabularyMaterialState}
                        setState={setVocabularyMaterialState}
                        practiceType="vocabulary-review"
                        targetLevel={targetLevel}
                        exerciseCount={Number(cardCount)}
                        countValid={validPracticeCount(cardCount)}
                        disabled={generating}
                        onBusyChange={setMaterialBusy}
                        requestAiAccess={requestAiAccess}
                        onOpenActivity={onOpenActivity}
                      />
                    </Section>
                  </div>
                  <div hidden={selectedKind !== "custom"}>
                    <Section as="article">
                      {practiceSettings}
                      <OperationProgress progress={generation.progress} />
                      <ActionGroup>
                        <Button
                          variant="primary"
                          isDisabled={generating || !quizCountValid || !customRequest.trim()}
                          onPress={() =>
                            void generateCustomLesson(customRequest, "natural-request")
                          }
                        >
                          {generating
                            ? t("exercises.custom.generating")
                            : t("exercises.custom.generate")}
                        </Button>
                        {generating && (
                          <Button variant="secondary" onPress={generation.cancel}>
                            {t("actions.cancel")}
                          </Button>
                        )}
                      </ActionGroup>
                    </Section>
                  </div>
                  <div hidden={selectedKind !== "grammar"}>
                    <Section as="article">
                      {practiceSettings}
                      <Button
                        variant="secondary"
                        isDisabled={generating || !targetLanguage}
                        onPress={() => {
                          if (targetLanguage)
                            setGrammarRequest(practiceStarterExamples[targetLanguage].grammar);
                        }}
                      >
                        {t("practice.useExample")}
                      </Button>
                      <OperationProgress progress={generation.progress} />
                      <ActionGroup>
                        <Button
                          variant="primary"
                          isDisabled={generating || !quizCountValid || !grammarRequest.trim()}
                          onPress={() => void generateCustomLesson(grammarRequest, "grammar")}
                        >
                          <BookOpen aria-hidden="true" />
                          {generating
                            ? t("exercises.custom.generating")
                            : t("practice.grammarLesson.start")}
                        </Button>
                        {generating && (
                          <Button variant="secondary" onPress={generation.cancel}>
                            {t("actions.cancel")}
                          </Button>
                        )}
                      </ActionGroup>
                    </Section>
                  </div>
                  <div hidden={selectedKind !== "reading"}>
                    <ReadingPractice
                      hideTopic
                      settings={practiceSettings}
                      topic={readingTopic}
                      setTopic={setReadingTopic}
                      materialState={readingMaterialState}
                      setMaterialState={setReadingMaterialState}
                      exerciseCount={exerciseCount}
                      countValid={quizCountValid}
                      targetLevel={targetLevel}
                      onBusyChange={setReadingBusy}
                      requestAiAccess={requestAiAccess}
                      onOpenActivity={onOpenActivity}
                    />
                  </div>
                  <div hidden={selectedKind !== "listening"}>
                    <CodexActivityPreparation
                      kind="listening"
                      targetLevel={targetLevel}
                      onBusyChange={setVoiceBusy}
                      requestAiAccess={requestAiAccess}
                      request={listeningTopic}
                      onRequestChange={setListeningTopic}
                      onOpenActivity={onOpenActivity}
                    />
                  </div>
                  <div hidden={selectedKind !== "speaking"}>
                    <CodexActivityPreparation
                      kind="speaking"
                      targetLevel={targetLevel}
                      onBusyChange={setVoiceBusy}
                      requestAiAccess={requestAiAccess}
                      request={speakingTopic}
                      onRequestChange={setSpeakingTopic}
                      onOpenActivity={onOpenActivity}
                    />
                  </div>
                </Section>
              </div>
            ),
          },
          {
            id: "saved",
            label: t("practice.library.title"),
            children: (
              <section
                className={styles.generatedLibrary}
                aria-busy={libraryBusy}
                data-root-generation={library.rootGeneration}
                data-learning-language={library.learningScope?.targetLanguage}
                data-library-ready={library.loaded && !libraryBusy && !libraryError}
              >
                {preparedActivities.length > 0 && (
                  <span className={styles.countBadge}>
                    {t("practice.library.count", { count: preparedActivities.length })}
                  </span>
                )}
                {(preparedActivities.length > 0 || libraryFilter !== "all") && (
                  <div
                    aria-label={t("practice.library.filterLabel")}
                    className={styles.libraryFilters}
                    role="group"
                  >
                    {(
                      [
                        "all",
                        "flashcards",
                        "custom-lesson",
                        "grammar",
                        "reading",
                        "codex-listening",
                        "voice-speaking",
                      ] as const
                    ).map((filter) => {
                      return (
                        <Button
                          variant="secondary"
                          className={styles.libraryFilterButton}
                          density="compact"
                          aria-pressed={libraryFilter === filter}
                          data-selected={libraryFilter === filter || undefined}
                          key={filter}
                          onPress={() => {
                            setLibraryFilter(filter);
                          }}
                        >
                          {t(`practice.library.filters.${filter}`)}
                        </Button>
                      );
                    })}
                  </div>
                )}
                {libraryError && <OperationError error={libraryError} />}
                {!libraryError && libraryBusy && preparedActivities.length === 0 && (
                  <Muted as="p">{t("practice.library.loading")}</Muted>
                )}
                {!libraryError && preparedActivities.length === 0 && !libraryBusy && (
                  <Muted as="p">
                    {t(
                      libraryFilter === "all"
                        ? "practice.library.empty"
                        : "practice.library.noFilterResults",
                    )}
                  </Muted>
                )}
                {filteredActivities.length > 0 && (
                  <div className={styles.generatedActivityList}>
                    {filteredActivities.map((activity) => {
                      const deletionBlocked = activity.deletionStatus === "retained-data";
                      const deleteLabel = deletionBlocked
                        ? t(`practice.library.deleteBlocked.${activity.deletionStatus}`, {
                            title: activity.title,
                          })
                        : t("practice.library.deleteAction", { title: activity.title });
                      return (
                        <ContentRow
                          leading={<ActivityVisual kind={activity.activityType} />}
                          key={activity.activityId}
                          actions={
                            <>
                              {deletionBlocked ? (
                                <InfoHint
                                  label={t("practice.library.deleteAction", {
                                    title: activity.title,
                                  })}
                                >
                                  {deleteLabel}
                                </InfoHint>
                              ) : (
                                <ConfirmDialog
                                  body={t(
                                    activity.activityType === "flashcards"
                                      ? "flashcards.deleteBody"
                                      : activity.deletionStatus === "cascade"
                                        ? "practice.library.deleteCascadeBody"
                                        : "practice.library.deleteBody",
                                  )}
                                  cancel={t("actions.cancel")}
                                  confirm={t("practice.library.deleteConfirm")}
                                  title={t("practice.library.deleteTitle", {
                                    title: activity.title,
                                  })}
                                  trigger={deleteLabel}
                                  menuLabel={deleteLabel}
                                  onConfirm={() => deletePreparedActivity(activity)}
                                />
                              )}
                            </>
                          }
                        >
                          <Button
                            id={`activity-open-${activity.activityId}`}
                            aria-label={t("practice.library.open", { title: activity.title })}
                            className={styles.generatedActivityOpen}
                            variant="quiet"
                            onPress={() => {
                              void openSavedActivity(activity.activityId);
                            }}
                          >
                            <span className={styles.generatedActivityCopy}>
                              <strong>{activity.title}</strong>
                              <span>
                                {t(`practice.library.types.${activity.activityType}`)} ·{" "}
                                {activity.preparedAt.slice(0, 10)}
                                {activity.deletionStatus !== "available"
                                  ? ` · ${t(`practice.library.deleteStates.${activity.deletionStatus}`)}`
                                  : ""}
                              </span>
                            </span>
                            <ChevronRight aria-hidden="true" />
                          </Button>
                        </ContentRow>
                      );
                    })}
                  </div>
                )}
                {library.hasMore && (
                  <Button
                    variant="secondary"
                    isDisabled={libraryBusy}
                    onPress={() => void library.loadMore()}
                  >
                    {t("practice.library.loadMore")}
                  </Button>
                )}
              </section>
            ),
          },
        ]}
      />
    </Page>
  );
}
