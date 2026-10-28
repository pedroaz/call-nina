import type { ExerciseEvaluation } from "@call-nina/domain";
import type { ExerciseAiFeedback } from "./useExerciseSession.js";
import { useTranslation } from "react-i18next";
import { Disclosure } from "./components/ui/index.js";
import { ActivityFeedback } from "./components/activity/index.js";
import styles from "./ExerciseEngine.module.css";

export function Evaluation({
  evaluation,
  aiFeedback,
}: {
  evaluation: ExerciseEvaluation;
  aiFeedback?: ExerciseAiFeedback | undefined;
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
        ? "info"
        : displayedStatus === "incorrect"
          ? "warning"
          : "info";
  return (
    <ActivityFeedback live="polite" tone={tone}>
      <strong>{t(`exercises.results.${displayedStatus}`)}</strong>
      {displayedStatus !== "correct" && evaluation.acceptedAnswerReveal.length > 0 && (
        <span className={styles.acceptedAnswers}>
          {t("exercises.acceptedAnswers")}: {evaluation.acceptedAnswerReveal.join(" / ")}
        </span>
      )}
    </ActivityFeedback>
  );
}

export function AiFeedback({ feedback }: { feedback: ExerciseAiFeedback }) {
  const { t } = useTranslation();
  return (
    <div className={styles.exerciseAiFeedback}>
      <p>{feedback.summary}</p>
      {feedback.strengths.length > 0 && (
        <Disclosure variant="inline" density="compact" label={t("exercises.aiFeedback.strengths")}>
          <ul>
            {feedback.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Disclosure>
      )}
      {feedback.improvements[0] && <p>{feedback.improvements[0]}</p>}
      {feedback.improvements.length > 1 && (
        <Disclosure
          variant="inline"
          density="compact"
          label={t("exercises.aiFeedback.improvements")}
        >
          <ul>
            {feedback.improvements.slice(1).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Disclosure>
      )}
      {feedback.suggestedAnswer && (
        <Disclosure
          variant="inline"
          density="compact"
          label={t("exercises.aiFeedback.suggestedAnswer")}
        >
          <p>{feedback.suggestedAnswer}</p>
        </Disclosure>
      )}
    </div>
  );
}
