import type { CourseActivity, CourseLocale, Language } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Disclosure } from "./components/ui/index.js";
import { SpeechButton } from "./SpeechButton.js";
import styles from "./LearningPathPage.module.css";

export function LessonListening({
  activity,
  language,
  locale,
}: {
  activity: CourseActivity;
  language: Language;
  locale: CourseLocale;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.listening}>
      <p className={styles.activityInstruction}>{activity.instructions[locale]}</p>
      <SpeechButton text={activity.input ?? ""} language={language} variant="passage" />
      <ol className={styles.listeningQuestions}>
        {activity.questions.map((question, index) => (
          <li key={index}>
            <p>{question[locale]}</p>
            <Disclosure variant="inline" density="compact" label={t("speech.showAnswer")}>
              <p>{activity.answers[index]?.[locale]}</p>
            </Disclosure>
          </li>
        ))}
      </ol>
      <Disclosure variant="inline" label={t("lessonStudio.transcript")}>
        <p className={styles.listeningTranscript} lang={language}>
          {activity.input}
        </p>
      </Disclosure>
    </div>
  );
}
