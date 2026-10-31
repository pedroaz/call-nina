import { exerciseFeedbackCandidateSchema } from "@call-nina/contracts";
import {
  ActivityReference,
  ActivityWorkspace,
  type ActivityReferenceItem,
} from "../../components/activity/index.js";
import { ConfirmDialog, ItemList, Muted } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import { ExerciseEngine } from "../activities/ExerciseEngine.js";
import { FlashcardWorkspace } from "../activities/FlashcardWorkspace.js";
import { PreparedActivityWorkspace } from "../activities/PreparedActivityWorkspace.js";
import { OperationProgress } from "../operations/OperationProgress.js";
import { ProviderActionSummary } from "../providers/ProviderActionSummary.js";
import { CompletionActions } from "../results/CompletionActions.js";
import { SpeechButton } from "../speech/SpeechButton.js";
import styles from "./PracticeActivity.module.css";
import type { useActivityController } from "./useActivityController.js";

export function PracticeActivity({
  model,
}: {
  model: Pick<
    ReturnType<typeof useActivityController>,
    | "activityId"
    | "prepared"
    | "activityBreadcrumbs"
    | "activityTitle"
    | "parentLabel"
    | "t"
    | "onResults"
    | "onNina"
    | "onReviewVocabulary"
    | "courseCompletionActions"
    | "onCloseActivity"
    | "onVocabulary"
    | "onOpenActivity"
    | "requestAiAccess"
    | "setDeleting"
    | "setError"
    | "generated"
    | "deleting"
    | "error"
    | "autoStart"
    | "feedback"
    | "exercises"
    | "launchIds"
    | "setStartedAttemptIds"
    | "startedAttemptIds"
  >;
}) {
  const {
    activityId,
    prepared,
    activityBreadcrumbs,
    activityTitle,
    parentLabel,
    t,
    onResults,
    onNina,
    onReviewVocabulary,
    courseCompletionActions,
    onCloseActivity,
    onVocabulary,
    onOpenActivity,
    requestAiAccess,
    setDeleting,
    setError,
    generated,
    deleting,
    error,
    autoStart,
    feedback,
    exercises,
    launchIds,
    setStartedAttemptIds,
    startedAttemptIds,
  } = model;
  return (() => {
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
          onResults={() => {
            onResults(
              prepared.activity.context.learningScope.targetLanguage,
              prepared.rootGeneration,
            );
          }}
          onNina={() => {
            onNina(prepared.activity.context.learningScope.targetLanguage, prepared.rootGeneration);
          }}
          onReviewVocabulary={
            onReviewVocabulary
              ? () => {
                  onReviewVocabulary(
                    prepared.activity.context.learningScope.targetLanguage,
                    prepared.rootGeneration,
                  );
                }
              : undefined
          }
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
              <p className={styles.readingPassage} lang={generated.learningScope.targetLanguage}>
                {reading.passage}
              </p>
              {
                <SpeechButton
                  text={reading.passage}
                  language={generated.learningScope.targetLanguage}
                  variant="passage"
                />
              }
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
                        <strong lang={generated.learningScope.targetLanguage}>{item.term}</strong>{" "}
                        {
                          <SpeechButton
                            text={item.term}
                            language={generated.learningScope.targetLanguage}
                          />
                        }{" "}
                        — {item.explanation}{" "}
                        <Muted as="span" lang={generated.learningScope.targetLanguage}>
                          {item.example}
                        </Muted>{" "}
                        {
                          <SpeechButton
                            text={item.example}
                            language={generated.learningScope.targetLanguage}
                          />
                        }
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
              activityId={activityId}
              reference={
                references.length > 0 ? (
                  <ActivityReference label={t("activity.reference")} items={references} />
                ) : undefined
              }
              autoStart={autoStart || !generated.activeSet}
              completionActions={
                courseCompletionActions ??
                (prepared && (
                  <CompletionActions
                    targetLanguage={generated.learningScope.targetLanguage}
                    rootGeneration={prepared.rootGeneration}
                    parentLabel={parentLabel ?? t("practice.title")}
                    onReturn={onCloseActivity}
                    onResults={() => {
                      onResults(generated.learningScope.targetLanguage, prepared.rootGeneration);
                    }}
                    onNina={() => {
                      onNina(generated.learningScope.targetLanguage, prepared.rootGeneration);
                    }}
                    onReviewVocabulary={
                      onReviewVocabulary
                        ? () => {
                            onReviewVocabulary(
                              generated.learningScope.targetLanguage,
                              prepared.rootGeneration,
                            );
                          }
                        : undefined
                    }
                  />
                ))
              }
              targetLanguage={generated.learningScope.targetLanguage}
              {...(feedback.busy ? { onCancelAiEvaluation: feedback.cancel } : {})}
              key={activityId}
              exercises={exercises}
              evaluationProgress={
                <>
                  <ProviderActionSummary operation="exercise-feedback" busy={feedback.busy} />
                  <OperationProgress progress={feedback.progress} />
                </>
              }
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
    return null;
  })();
}
