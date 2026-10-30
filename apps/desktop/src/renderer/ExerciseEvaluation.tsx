import { SpeechButton } from "./SpeechButton.js";
import type { Language } from "@call-nina/contracts";
import type { ExerciseEvaluation } from "@call-nina/domain";
import type { ExerciseAiFeedback } from "./useExerciseSession.js";
import { useTranslation } from "react-i18next";
import { ActivityFeedback } from "./components/activity/index.js";
import styles from "./ExerciseEngine.module.css";

export function Evaluation({
  evaluation,
  aiFeedback,
  explanation,
  targetLanguage,
}: {
  evaluation: ExerciseEvaluation;
  targetLanguage?: Language | undefined;
  aiFeedback?: ExerciseAiFeedback | undefined;
  explanation?: string | undefined;
}) {
  const { t } = useTranslation();
  const displayedStatus =
    evaluation.status === "requires-ai" && aiFeedback
      ? aiFeedback.outcome === "demonstrated"
        ? "correct"
        : aiFeedback.outcome === "developing"
          ? "almost-correct"
          : "incorrect"
      : evaluation.status;
  const tone =
    displayedStatus === "correct"
      ? "success"
      : displayedStatus === "almost-correct"
        ? "warning"
        : displayedStatus === "incorrect"
          ? "error"
          : "info";
  const suggestedAnswer = aiFeedback?.suggestedAnswer;
  const acceptedAnswers =
    displayedStatus === "correct"
      ? []
      : evaluation.acceptedAnswerReveal.filter((answer) => answer !== suggestedAnswer);
  return (
    <div className={styles.exerciseAiFeedback} data-correction-tone={tone}>
      <ActivityFeedback live="polite" tone={tone} showIcon>
        <strong>{t(`exercises.results.${displayedStatus}`)}</strong>
      </ActivityFeedback>
      {(suggestedAnswer || acceptedAnswers.length > 0) && (
        <section className={styles.correctionAnswer}>
          <h3>
            {t(
              suggestedAnswer
                ? "exercises.aiFeedback.suggestedAnswer"
                : "exercises.acceptedAnswers",
            )}
          </h3>
          {suggestedAnswer && (
            <p className={styles.correctedText} lang={targetLanguage}>
              {suggestedAnswer}{" "}
              {targetLanguage && <SpeechButton text={suggestedAnswer} language={targetLanguage} />}
            </p>
          )}
          {!suggestedAnswer &&
            acceptedAnswers.map((answer, index) => (
              <p key={index} className={styles.correctedText} lang={targetLanguage}>
                {answer}{" "}
                {targetLanguage && <SpeechButton text={answer} language={targetLanguage} />}
              </p>
            ))}
          {suggestedAnswer && acceptedAnswers.length > 0 && (
            <p className={styles.acceptedAnswers}>
              {t("exercises.acceptedAnswers")}:{" "}
              {acceptedAnswers.map((answer, index) => (
                <span key={index} lang={targetLanguage}>
                  {index > 0 ? " / " : ""}
                  {answer}{" "}
                  {targetLanguage && <SpeechButton text={answer} language={targetLanguage} />}
                </span>
              ))}
            </p>
          )}
        </section>
      )}
      {(explanation || aiFeedback?.summary) && (
        <section className={styles.correctionSection}>
          <h3>{t("exercises.explanationTitle")}</h3>
          {aiFeedback?.summary && <p>{aiFeedback.summary}</p>}
          {explanation && explanation !== aiFeedback?.summary && <p>{explanation}</p>}
        </section>
      )}
      {aiFeedback && (aiFeedback.improvements.length > 0 || aiFeedback.strengths.length > 0) && (
        <div className={styles.correctionNotes}>
          {[
            {
              kind: "improvements",
              label: "exercises.aiFeedback.improvements",
              items: aiFeedback.improvements,
            },
            {
              kind: "strengths",
              label: "exercises.aiFeedback.strengths",
              items: aiFeedback.strengths,
            },
          ].map(({ kind, label, items }) =>
            items.length > 0 ? (
              <section className={styles.correctionSection} data-feedback-kind={kind} key={label}>
                <h3>{t(label)}</h3>
                <ul>
                  {items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
