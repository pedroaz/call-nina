import type { ExerciseDefinition } from "@call-nina/domain";
import { useTranslation } from "react-i18next";
import { FieldGroup, OptionCard } from "./components/ui/index.js";
import { AnswerTextarea } from "./components/activity/AnswerTextarea.js";
import styles from "./ExerciseEngine.module.css";
type AnswerProps = {
  definition: ExerciseDefinition;
  evaluated: boolean;
  values: readonly string[];
  setValue: (position: number, value: string) => void;
};
function WritingAnswer({ definition, evaluated, values, setValue }: AnswerProps) {
  const { t } = useTranslation();
  if (definition.kind !== "free-writing") return null;
  return (
    <FieldGroup>
      <span>{definition.content.prompt}</span>
      <span className={styles.answerLabel}>{t("exercises.answer")}</span>
      <AnswerTextarea
        aria-label={t("exercises.answer")}
        rows={8}
        maxLength={definition.answerContract.maximumCharacters}
        readOnly={evaluated}
        value={values[0] ?? ""}
        onChange={(event) => {
          setValue(0, event.target.value);
        }}
      />
    </FieldGroup>
  );
}
function ShortAnswer({ definition, evaluated, values, setValue }: AnswerProps) {
  const { t } = useTranslation();
  if (definition.kind !== "short-answer") return null;
  return (
    <FieldGroup>
      <span>{definition.content.question}</span>
      <span className={styles.answerLabel}>{t("exercises.answer")}</span>
      <AnswerTextarea
        aria-label={t("exercises.answer")}
        readOnly={evaluated}
        value={values[0] ?? ""}
        onChange={(event) => {
          setValue(0, event.target.value);
        }}
      />
    </FieldGroup>
  );
}
function BlankAnswer({ definition, evaluated, values, setValue }: AnswerProps) {
  const { t } = useTranslation();
  if (definition.kind !== "fill-in-the-blank") return null;
  return (
    <div className={styles.exerciseBlanks}>
      <span>{definition.content.leadingText}</span>
      {definition.content.blanks.map((blank, position) => (
        <span key={position}>
          <label>
            <input
              aria-label={t("exercises.blank", { number: position + 1 })}
              readOnly={evaluated}
              value={values[position] ?? ""}
              onChange={(event) => {
                setValue(position, event.target.value);
              }}
            />
          </label>
          {blank.followingText}
        </span>
      ))}
    </div>
  );
}
function CorrectionAnswer({ definition, evaluated, values, setValue }: AnswerProps) {
  const { t } = useTranslation();
  if (definition.kind !== "sentence-correction") return null;
  return (
    <>
      <blockquote className={styles.exercisePrompt}>{definition.content.sentence}</blockquote>
      <FieldGroup>
        {t("exercises.correctedSentence")}
        <AnswerTextarea
          aria-label={t("exercises.correctedSentence")}
          readOnly={evaluated}
          value={values[0] ?? ""}
          onChange={(event) => {
            setValue(0, event.target.value);
          }}
        />
      </FieldGroup>
    </>
  );
}
function ChoiceAnswer({ definition, evaluated, values, setValue }: AnswerProps) {
  if (definition.kind !== "multiple-choice") return null;
  return (
    <fieldset className={styles.choiceFieldset}>
      <legend>{definition.content.question}</legend>
      <div className={styles.optionGroup} data-evaluated={evaluated || undefined}>
        {definition.content.options.map((option, position) => (
          <OptionCard key={`${String(position)}:${option.label}`}>
            <input
              checked={values[0] === String(position)}
              disabled={evaluated}
              name={definition.exerciseId}
              type="radio"
              value={position}
              onChange={() => {
                setValue(0, String(position));
              }}
            />
            <span>{option.label}</span>
          </OptionCard>
        ))}
      </div>
    </fieldset>
  );
}
function RecallAnswer({ definition, evaluated, values, setValue }: AnswerProps) {
  const { t } = useTranslation();
  if (definition.kind !== "vocabulary-recall") return null;
  return (
    <FieldGroup>
      {definition.content.cue}
      <small>{t(`exercises.direction.${definition.content.direction}`)}</small>
      <AnswerTextarea
        aria-label={t("exercises.answer")}
        readOnly={evaluated}
        value={values[0] ?? ""}
        onChange={(event) => {
          setValue(0, event.target.value);
        }}
      />
    </FieldGroup>
  );
}

export function ExerciseContent(props: AnswerProps) {
  switch (props.definition.kind) {
    case "free-writing":
      return <WritingAnswer {...props} />;
    case "short-answer":
      return <ShortAnswer {...props} />;
    case "fill-in-the-blank":
      return <BlankAnswer {...props} />;
    case "sentence-correction":
      return <CorrectionAnswer {...props} />;
    case "multiple-choice":
      return <ChoiceAnswer {...props} />;
    case "vocabulary-recall":
      return <RecallAnswer {...props} />;
  }
}
