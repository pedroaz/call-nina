import { Lightbulb } from "lucide-react";
import { Heading, Popover } from "react-aria-components";
import { useTranslation } from "react-i18next";
import {
  Button,
  PopoverDialog as Dialog,
  PopoverDialogTrigger as DialogTrigger,
  Feedback,
} from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import type { useExerciseSession } from "./useExerciseSession.js";
import styles from "./ExerciseEngine.module.css";
type HintState = Pick<
  ReturnType<typeof useExerciseSession>,
  | "displayedHints"
  | "hintOpen"
  | "setHintOpen"
  | "hintCount"
  | "revealHint"
  | "evaluatingWithAi"
  | "savingAnswer"
  | "currentEvaluation"
  | "supportFailed"
  | "savingSupport"
>;
export function ExerciseHint({
  displayedHints,
  hintOpen,
  setHintOpen,
  hintCount,
  revealHint,
  evaluatingWithAi,
  savingAnswer,
  currentEvaluation,
  supportFailed,
  savingSupport,
}: HintState) {
  const { t } = useTranslation();
  return displayedHints.length > 0 ? (
    <DialogTrigger
      isOpen={hintOpen}
      onOpenChange={(open) => {
        setHintOpen(open);
        if (open && hintCount === 0) void revealHint();
      }}
    >
      <Button
        variant="quiet"
        leadingIcon={<Lightbulb aria-hidden="true" />}
        isDisabled={
          evaluatingWithAi || savingAnswer || (Boolean(currentEvaluation) && hintCount === 0)
        }
      >
        {t("exercises.hint")}
      </Button>
      <Popover className={styles.hintPopover} placement="bottom end">
        <Dialog className={styles.hintDialog}>
          <Heading slot="title">{t("exercises.hint")}</Heading>
          <div aria-live="polite" className={styles.hintContent}>
            {displayedHints.slice(0, hintCount).map((hint, index) => (
              <div key={index}>
                <p>{hint.text}</p>
              </div>
            ))}
          </div>
          {supportFailed && (
            <Feedback tone="error" live="assertive">
              {t("exercises.supportFailed")}
            </Feedback>
          )}
          <ActionGroup>
            {hintCount < displayedHints.length && !currentEvaluation && (
              <Button
                variant="secondary"
                isDisabled={savingSupport}
                onPress={() => void revealHint()}
              >
                {t(hintCount === 0 ? "exercises.showHint" : "exercises.nextHint")}
              </Button>
            )}
            <Button variant="quiet" slot="close">
              {t("actions.close")}
            </Button>
          </ActionGroup>
        </Dialog>
      </Popover>
    </DialogTrigger>
  ) : null;
}
