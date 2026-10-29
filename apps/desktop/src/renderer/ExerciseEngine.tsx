import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Feedback } from "./components/ui/index.js";
import {
  ActivityFrame,
  ActivityProgress,
  ActivityFooter,
  ActivityCompletion,
} from "./components/activity/index.js";
import { useExerciseSession, type ExerciseSessionOptions } from "./useExerciseSession.js";
import { ExerciseContent } from "./ExerciseAnswerFields.js";
import { ExerciseHint } from "./ExerciseHint.js";
import { Evaluation } from "./ExerciseEvaluation.js";
import styles from "./ExerciseEngine.module.css";

export function ExerciseEngine(
  props: ExerciseSessionOptions & {
    reference?: ReactNode;
    evaluationProgress?: ReactNode;
    completionActions?: ReactNode;
  },
) {
  const { t } = useTranslation();
  const session = useExerciseSession(props);
  const {
    exercises,
    reference,
    evaluationProgress,
    completionActions,
    onNewAttempt,
    onAbandoned,
    onCancelAiEvaluation,
  } = props;
  const {
    resuming,
    started,
    position,
    furthestPosition,
    values,
    valuesByPosition,
    savingSupport,
    evaluations,
    currentEvaluation,
    starting,
    startFailed,
    completing,
    completionFailed,
    answerInvalid,
    evaluatingWithAi,
    aiEvaluationFailed,
    savingAnswer,
    submittedByPosition,
    answerSaveFailed,
    currentAiFeedback,
    aiFeedbackByPosition,
    abandoning,
    abandonFailed,
    abandoned,
    definition,
    setValue,
    navigateTo,
    advance,
    submit,
    start,
    abandon,
  } = session;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest("[data-activity-task]")?.scrollTo(0, 0);
  }, [position, started]);
  const taskLabel = t("activity.task");
  if (abandoned)
    return (
      <ActivityFrame taskLabel={taskLabel}>
        <ActivityCompletion
          companion="listening"
          title={t("exercises.abandoned")}
          summary={<p>{t("exercises.abandonedBody")}</p>}
        />
      </ActivityFrame>
    );
  if (!definition && evaluations.length === 0) return null;
  if (!definition)
    return (
      <ActivityFrame taskLabel={taskLabel}>
        <ActivityCompletion
          companion="celebration"
          title={t("exercises.complete")}
          actions={completionActions}
          reviewLabel={t("exercises.reviewAnswers")}
          review={
            <>
              {reference}
              <ol className={styles.answerReview}>
                {evaluations.map((evaluation, index) => (
                  <li key={index}>
                    <h3>
                      {t("exercises.progress", { current: index + 1, total: exercises.length })}
                    </h3>
                    {exercises[index] && (
                      <div className={styles.questionSection}>
                        <p>{exercises[index].instructions}</p>
                        <ExerciseContent
                          definition={exercises[index]}
                          evaluated
                          values={valuesByPosition[index] ?? []}
                          setValue={() => {}}
                        />
                      </div>
                    )}
                    <Evaluation
                      evaluation={evaluation}
                      aiFeedback={aiFeedbackByPosition[index]}
                      explanation={exercises[index]?.explanation}
                    />
                  </li>
                ))}
              </ol>
            </>
          }
        />
      </ActivityFrame>
    );
  if (!started)
    return (
      <ActivityFrame
        fillViewport={false}
        taskLabel={taskLabel}
        reference={reference}
        footer={
          <ActivityFooter>
            {resuming && onNewAttempt && (
              <Button variant="secondary" isDisabled={starting} onPress={() => void start(true)}>
                {t("exercises.startAgain")}
              </Button>
            )}
            <Button variant="primary" isDisabled={starting} onPress={() => void start()}>
              {t(
                starting ? "exercises.starting" : resuming ? "exercises.resume" : "exercises.start",
              )}
            </Button>
          </ActivityFooter>
        }
      >
        <h2>
          {t(starting ? "exercises.starting" : resuming ? "exercises.resume" : "exercises.ready")}
        </h2>
        <p>{t("exercises.readyBody", { count: exercises.length })}</p>
        {startFailed && (
          <Feedback live="assertive" tone="error">
            {t("exercises.startFailed")}
          </Feedback>
        )}
      </ActivityFrame>
    );
  return (
    <ActivityFrame
      fillViewport={Boolean(reference)}
      taskLabel={taskLabel}
      reference={reference}
      progress={
        <ActivityProgress
          current={position + 1}
          total={exercises.length}
          label={t("exercises.progress", { current: position + 1, total: exercises.length })}
        />
      }
      feedback={
        <>
          {evaluationProgress}
          {answerInvalid && (
            <Feedback live="assertive" tone="error">
              {t("exercises.answerRequired")}
            </Feedback>
          )}
          {answerSaveFailed && (
            <Feedback live="assertive" tone="error">
              {t("exercises.answerSaveFailed")}
            </Feedback>
          )}
          {completionFailed && (
            <Feedback live="assertive" tone="error">
              {t("exercises.completionFailed")}
            </Feedback>
          )}
          {abandonFailed && (
            <Feedback live="assertive" tone="error">
              {t("exercises.abandonFailed")}
            </Feedback>
          )}
          {aiEvaluationFailed && (
            <Feedback live="assertive" tone="error">
              {t(
                aiEvaluationFailed === "context-missing"
                  ? "errors.exerciseContextMissing"
                  : "exercises.aiFeedback.failed",
              )}
            </Feedback>
          )}
          {submittedByPosition[position] && !currentEvaluation && !aiEvaluationFailed && (
            <Feedback live="polite">{t("exercises.aiFeedback.pending")}</Feedback>
          )}
          {currentEvaluation && (
            <Evaluation
              evaluation={currentEvaluation}
              aiFeedback={currentAiFeedback}
              explanation={definition.explanation}
            />
          )}
        </>
      }
      footer={
        <ActivityFooter
          previous={
            <Button
              variant="secondary"
              leadingIcon={<ChevronLeft aria-hidden="true" />}
              isDisabled={
                position === 0 || evaluatingWithAi || savingAnswer || completing || savingSupport
              }
              onPress={() => {
                navigateTo(position - 1);
              }}
            >
              {t("exercises.previous")}
            </Button>
          }
          utilities={
            onAbandoned && (
              <Button
                variant="quiet"
                isDisabled={
                  abandoning || completing || evaluatingWithAi || savingAnswer || savingSupport
                }
                onPress={() => void abandon()}
              >
                {t(abandoning ? "exercises.abandoning" : "exercises.abandon")}
              </Button>
            )
          }
        >
          {position < furthestPosition && (
            <Button
              variant="primary"
              trailingIcon={<ChevronRight aria-hidden="true" />}
              isDisabled={evaluatingWithAi || savingAnswer || completing || savingSupport}
              onPress={() => {
                navigateTo(position + 1);
              }}
            >
              {t("exercises.forward")}
            </Button>
          )}
          {evaluatingWithAi && onCancelAiEvaluation && (
            <Button variant="secondary" onPress={onCancelAiEvaluation}>
              {t("actions.cancel")}
            </Button>
          )}
          {(!currentEvaluation ||
            ((currentEvaluation.status !== "requires-ai" || currentAiFeedback) &&
              position === furthestPosition)) && (
            <Button
              variant="primary"
              isDisabled={evaluatingWithAi || savingAnswer || savingSupport || completing}
              onPress={() => {
                if (currentEvaluation) void advance(evaluations);
                else void submit();
              }}
            >
              {evaluatingWithAi
                ? t("exercises.aiFeedback.evaluating")
                : savingAnswer
                  ? t("exercises.savingAnswer")
                  : completing
                    ? t("exercises.completing")
                    : !currentEvaluation
                      ? t(
                          submittedByPosition[position]
                            ? "exercises.aiFeedback.retry"
                            : "exercises.submit",
                        )
                      : position + 1 === exercises.length
                        ? t("exercises.finish")
                        : t("exercises.next")}
            </Button>
          )}
        </ActivityFooter>
      }
    >
      <section className={styles.questionSection}>
        <div className={styles.questionHeader}>
          <h2 ref={heading} tabIndex={-1}>
            {definition.instructions}
          </h2>
          <ExerciseHint {...session} />
        </div>
        <ExerciseContent
          definition={definition}
          evaluated={
            currentEvaluation !== undefined ||
            evaluatingWithAi ||
            savingAnswer ||
            Boolean(submittedByPosition[position])
          }
          values={values}
          setValue={setValue}
        />
      </section>
    </ActivityFrame>
  );
}
