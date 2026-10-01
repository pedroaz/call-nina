import { CompletionActions } from "./CompletionActions.js";
import { SavedTranslation } from "./SavedTranslation.js";
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
import { generatePracticeActivity, reusePracticeActivity } from "./generatePracticeActivity.js";
import { OperationError } from "./Startup.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { materializeContentExercises } from "@call-nina/domain";
import {
  BookOpen,
  ChevronRight,
  MessageSquareText,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ExerciseEngine } from "./ExerciseEngine.js";
import styles from "./PracticePage.module.css";
import {
  Button,
  Tabs,
  Card,
  ConfirmDialog,
  FieldGroup,
  IconButton,
  InfoHint,
  ItemList,
  Muted,
} from "./components/ui/index.js";
import { ActionGroup, Page } from "./components/layout/index.js";
import { createDesktopSubmissionId, invokeDesktop, normalizeDesktopError } from "./ipc.js";

type PreparedActivityId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number]["activityId"];
type PreparedActivity = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number];
type PracticeKind = "flashcards" | "custom" | "grammar" | "reading" | "listening" | "speaking";
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
  targetLanguage,
  initialPreparation,
  parentLabel,
  activityId,
  requestAiAccess,
  onOpenActivity,
  onCloseActivity,
  onVocabulary,
  onHistory,
  onNina,
}: {
  targetLanguage?: Language | undefined;
  parentLabel?: string;
  initialPreparation?: Extract<PracticeLaunch, { destination: "preparation" }>;
  activityId?: PreparedActivityId;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onOpenActivity: (activityId: PreparedActivityId) => void;
  onCloseActivity: () => void;
  onVocabulary?: () => void;
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
  const [customRequest, setCustomRequest] = useState("");
  const [grammarRequest, setGrammarRequest] = useState("");
  const [quizCount, setQuizCount] = useState("6");
  const [cardCount, setCardCount] = useState("10");
  const [flashcardTopic, setFlashcardTopic] = useState("");
  const [readingTopic, setReadingTopic] = useState("");
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
  const [libraryView, setLibraryView] = useState(false);
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
        onClose={onCloseActivity}
        onVocabulary={onVocabulary ?? onCloseActivity}
        requestAiAccess={requestAiAccess}
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
        parentLabel={parentLabel ?? t("practice.title")}
        prepared={prepared}
        onClose={onCloseActivity}
        onOpenActivity={onOpenActivity}
        requestAiAccess={requestAiAccess}
      />
    );
  }
  if (activityId) {
    const translateLesson = (field: Parameters<typeof SavedTranslation>[0]["request"]["field"]) =>
      generated && prepared ? (
        <SavedTranslation
          request={{
            activityId,
            rootGeneration: prepared.rootGeneration,
            content: {
              contentId: generated.content.contentId,
              revisionId: generated.content.revisionId,
            },
            field,
          }}
          requestAiAccess={requestAiAccess}
        />
      ) : null;
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
    return (
      <Page
        className={styles.practiceSession}
        data-activity-id={activityId}
        data-activity-material-id={generated?.content.materials[0]?.materialId}
        data-activity-material-revision={generated?.content.materials[0]?.revisionId}
        data-root-generation={prepared?.rootGeneration}
        data-learning-language={prepared?.activity.context.learningScope.targetLanguage}
        title={generated?.title ?? t("exercises.loading")}
        eyebrow={t("practice.session.eyebrow")}
        breadcrumbs={[{ label: parentLabel ?? t("practice.title"), onPress: onCloseActivity }]}
        {...(generated
          ? {
              description: [
                t("practice.session.exerciseCount", { count: exercises.length }),
                generated.content.payload.lesson ? t("practice.session.lessonIncluded") : "",
              ]
                .filter(Boolean)
                .join(" · "),
            }
          : {})}
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
              triggerVariant="secondary"
            />
          )
        }
      >
        {error && <OperationError error={error} />}
        {generated?.content.payload.readingMaterial && (
          <Card as="article">
            <h2>{generated.content.payload.readingMaterial.title}</h2>
            <p className={styles.readingPassage}>
              {generated.content.payload.readingMaterial.passage}
            </p>
          </Card>
        )}
        {generated?.content.payload.lesson && !generated.missionFacts && (
          <details className={styles.practiceLessonDisclosure}>
            <summary>
              <span>
                <BookOpen aria-hidden="true" />
                <span>
                  <strong>{generated.content.payload.lesson.title}</strong>
                  <small>{t("practice.session.lessonHint")}</small>
                </span>
              </span>
            </summary>
            <div className={styles.practiceLessonBody}>
              <p>{generated.content.payload.lesson.explanation}</p>
              {translateLesson({ kind: "lesson-explanation" })}
              {generated.content.payload.lesson.sections.map((section, index) => (
                <section key={section.heading}>
                  <h3>{section.heading}</h3>
                  <p>{section.content}</p>
                  {translateLesson({ kind: "lesson-section", index })}
                </section>
              ))}
              {generated.content.payload.lesson.vocabularyFoundations.length > 0 && (
                <section>
                  <h3>{t("exercises.custom.vocabulary")}</h3>
                  <ItemList>
                    {generated.content.payload.lesson.vocabularyFoundations.map((item, index) => (
                      <li key={`${item.term}:${item.example}`}>
                        <strong>{item.term}</strong> — {item.explanation}
                        <Muted as="span">{item.example}</Muted>
                        {translateLesson({ kind: "lesson-vocabulary", index })}
                      </li>
                    ))}
                  </ItemList>
                </section>
              )}
            </div>
          </details>
        )}
        {generated && (
          <div className={styles.practiceRunner}>
            {generated.missionFacts && (
              <Card>
                <h2>{t("missions.sharedFacts")}</h2>
                <p>{generated.missionFacts}</p>
              </Card>
            )}
            <ExerciseEngine
              completionActions={
                prepared && (
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
                )
              }
              targetLanguage={generated.learningScope.targetLanguage}
              {...(prepared
                ? {
                    translation: {
                      activityId,
                      rootGeneration: prepared.rootGeneration,
                      content: {
                        contentId: generated.content.contentId,
                        revisionId: generated.content.revisionId,
                      },
                      requestAiAccess,
                    },
                  }
                : {})}
              attemptIds={startedAttemptIds}
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
          </div>
        )}
      </Page>
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
      const createdId = await generatePracticeActivity(
        {
          source,
          naturalRequest: requestedLesson.trim(),
          exerciseCount,
          targetLevel,
        },
        generation.run,
      );
      onOpenActivity(createdId);
    } catch (cause) {
      setGenerationError(normalizeDesktopError(cause).detail);
    }
  };
  const practiceKinds: ReadonlyArray<{
    kind: PracticeKind;
    icon: typeof BookOpen;
  }> = [
    { kind: "custom", icon: Sparkles },
    { kind: "flashcards", icon: BookOpen },
    { kind: "grammar", icon: BookOpen },
    { kind: "reading", icon: MessageSquareText },
    { kind: "listening", icon: Volume2 },
    { kind: "speaking", icon: UserRound },
  ];
  const quizLengthControl = (
    <PracticeCount
      value={selectedKind === "flashcards" ? cardCount : quizCount}
      onChange={selectedKind === "flashcards" ? setCardCount : setQuizCount}
      disabled={formBusy}
      flashcards={selectedKind === "flashcards"}
    />
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
      const result = await generation.run({
        kind: "flashcard-generation",
        topic: flashcardTopic.trim(),
        cardCount: Number(cardCount),
        targetLevel,
      });
      if (result.activityId) onOpenActivity(result.activityId);
    } catch (cause) {
      setGenerationError(normalizeDesktopError(cause).detail);
    }
  };

  return (
    <Page title={t("practice.title")} refresh={{ onRefresh: library.refresh, busy: libraryBusy }}>
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
              <div>
                <section className={styles.practiceSection} aria-labelledby="practice-type-heading">
                  <div className={styles.practiceSectionHeader}>
                    <div>
                      <h2 id="practice-type-heading">{t("practice.chooser.title")}</h2>
                    </div>
                  </div>
                  <div className={styles.practiceTypeGrid}>
                    {practiceKinds.map(({ kind, icon: Icon }) => (
                      <Button
                        isDisabled={formBusy}
                        aria-pressed={selectedKind === kind}
                        className={styles.practiceTypeCard}
                        data-selected={selectedKind === kind || undefined}
                        key={kind}
                        onPress={() => {
                          setSelectedKind(kind);
                        }}
                      >
                        <span className={styles.practiceTypeIcon}>
                          <Icon aria-hidden="true" />
                        </span>
                        <span className={styles.practiceTypeCopy}>
                          <strong>{t(`practice.types.${kind}.title`)}</strong>
                        </span>
                      </Button>
                    ))}
                  </div>
                </section>

                <div className={styles.practiceControls}>
                  <FieldGroup>
                    {t("practice.targetLevel")}
                    <select
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
                    </select>
                  </FieldGroup>
                  {selectedKind !== "listening" && selectedKind !== "speaking" && quizLengthControl}
                </div>

                {generationError && <OperationError error={generationError} />}
                <div className={styles.practiceContent}>
                  <div hidden={selectedKind !== "flashcards"}>
                    <Card as="article">
                      <h2>{t("flashcards.title")}</h2>
                      <p>{t("flashcards.description")}</p>
                      <FieldGroup>
                        {t("practice.promptLabel")}
                        <textarea
                          rows={3}
                          maxLength={2_000}
                          disabled={formBusy}
                          value={flashcardTopic}
                          placeholder={t("flashcards.placeholder")}
                          onChange={(event) => {
                            setFlashcardTopic(event.target.value);
                          }}
                        />
                      </FieldGroup>
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
                          <Button onPress={generation.cancel}>{t("actions.cancel")}</Button>
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
                    </Card>
                  </div>
                  <div hidden={selectedKind !== "custom"}>
                    <Card as="article">
                      <h2>{t("exercises.custom.title")}</h2>

                      <FieldGroup>
                        {t("exercises.custom.request")}
                        <textarea
                          rows={3}
                          maxLength={2_000}
                          disabled={generating}
                          value={customRequest}
                          placeholder={t("practice.customPromptPlaceholder")}
                          onChange={(event) => {
                            setCustomRequest(event.target.value);
                          }}
                        />
                      </FieldGroup>
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
                    </Card>
                  </div>
                  <div hidden={selectedKind !== "grammar"}>
                    <Card as="article">
                      <h2>{t("practice.grammarLesson.title")}</h2>
                      <FieldGroup>
                        {t("practice.promptLabel")}
                        <textarea
                          rows={3}
                          maxLength={2_000}
                          disabled={generating}
                          value={grammarRequest}
                          placeholder={t("practice.grammarPromptPlaceholder")}
                          onChange={(event) => {
                            setGrammarRequest(event.target.value);
                          }}
                        />
                      </FieldGroup>
                      <Button
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
                    </Card>
                  </div>
                  <div hidden={selectedKind !== "reading"}>
                    <ReadingPractice
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
                      {...(initialPreparation?.kind === "listening"
                        ? { initialScenario: initialPreparation.prompt }
                        : {})}
                      onOpenActivity={onOpenActivity}
                    />
                  </div>
                  <div hidden={selectedKind !== "speaking"}>
                    <CodexActivityPreparation
                      kind="speaking"
                      targetLevel={targetLevel}
                      onBusyChange={setVoiceBusy}
                      requestAiAccess={requestAiAccess}
                      {...(initialPreparation?.kind === "speaking"
                        ? { initialScenario: initialPreparation.prompt }
                        : {})}
                      onOpenActivity={onOpenActivity}
                    />
                  </div>
                </div>
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
                <div className={styles.practiceSectionHeader}>
                  <div>
                    <h2>{t("practice.library.title")}</h2>
                  </div>
                  {preparedActivities.length > 0 && (
                    <span className={styles.countBadge}>
                      {t("practice.library.count", { count: preparedActivities.length })}
                    </span>
                  )}
                </div>
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
                        <div className={styles.generatedActivity} key={activity.activityId}>
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
                          {deletionBlocked ? (
                            <InfoHint
                              label={t("practice.library.deleteAction", { title: activity.title })}
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
                              title={t("practice.library.deleteTitle", { title: activity.title })}
                              trigger={deleteLabel}
                              triggerNode={
                                <IconButton
                                  className={styles.generatedActivityDelete}
                                  label={deleteLabel}
                                  leadingIcon={<Trash2 aria-hidden="true" />}
                                  variant="quiet"
                                />
                              }
                              onConfirm={() => deletePreparedActivity(activity)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {library.hasMore && (
                  <Button isDisabled={libraryBusy} onPress={() => void library.loadMore()}>
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
