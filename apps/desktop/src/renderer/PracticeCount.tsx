import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button, FieldGroup } from "./components/ui/index.js";
import styles from "./PracticePage.module.css";

export function validPracticeCount(value: string) {
  return /^\d+$/u.test(value) && Number(value) >= 3 && Number(value) <= 30;
}
export function PracticeCount({
  value,
  onChange,
  disabled,
  flashcards = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  flashcards?: boolean;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  const valid = validPracticeCount(value);
  return (
    <fieldset className={styles.quizLength}>
      <legend>{t(flashcards ? "flashcards.count" : "exercises.custom.countLabel")}</legend>
      <div className={styles.quizLengthOptions}>
        {[3, 6, 10].map((count) => (
          <Button
            key={count}
            isDisabled={disabled}
            aria-pressed={valid && Number(value) === count}
            className={styles.quizLengthButton}
            density="compact"
            data-selected={(valid && Number(value) === count) || undefined}
            onPress={() => {
              onChange(String(count));
            }}
          >
            {count}
          </Button>
        ))}
        <FieldGroup>
          {t("practice.customCount")}
          <input
            type="number"
            min={3}
            max={30}
            step={1}
            value={value}
            disabled={disabled}
            aria-invalid={!valid}
            aria-describedby={!valid ? errorId : undefined}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </FieldGroup>
      </div>
      {!valid && (
        <p id={errorId} role="status">
          {t("practice.invalidCount")}
        </p>
      )}
    </fieldset>
  );
}
