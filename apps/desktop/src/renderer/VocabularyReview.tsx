import { SpeechButton } from "./SpeechButton.js";
import type { DataRootGeneration } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "./components/layout/index.js";
import { SelectControl, Button, FieldGroup, LoadingState } from "./components/ui/index.js";
import { VocabularyInformation } from "./VocabularyDetails.js";
import { useVocabularyReviewSession } from "./useVocabularyReviewSession.js";
import {
  ActivityWorkspace,
  ActivityFrame,
  ActivityProgress,
  ActivityFooter,
  ActivityFeedback,
  ActivityCompletion,
  RecallCard,
} from "./components/activity/index.js";

export function VocabularyReview({
  rootGeneration,
  onExit,
  onChanged,
}: {
  rootGeneration: DataRootGeneration;
  onExit: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const {
    queue,
    index,
    retrieval,
    setRetrieval,
    revealed,
    setRevealed,
    dueOn,
    reviewed,
    busy,
    error,
    nextButton,
    load,
    today,
    entry,
    grade,
    next,
  } = useVocabularyReviewSession(rootGeneration, onChanged);
  return (
    <ActivityWorkspace
      title={t("vocabulary.review.title")}
      breadcrumbs={[{ label: t("vocabulary.title"), onPress: onExit }]}
    >
      {!queue && busy && <LoadingState live>{t("ui.loading")}</LoadingState>}
      {!queue && !busy && (
        <Button variant="secondary" onPress={() => void load()}>
          {t("vocabulary.refresh")}
        </Button>
      )}
      <ActivityFrame
        taskLabel={t("activity.task")}
        progress={
          entry &&
          queue && (
            <ActivityProgress
              current={index + 1}
              total={queue.length}
              label={t("vocabulary.review.progress", { current: index + 1, total: queue.length })}
            />
          )
        }
        feedback={
          <>
            {error && (
              <ActivityFeedback tone="error" live="assertive">
                {t(error.messageKey)} {entry && t("vocabulary.review.failed")}
              </ActivityFeedback>
            )}
            {dueOn && (
              <ActivityFeedback tone="success" live="polite">
                {t("vocabulary.review.saved", { date: dueOn })}
              </ActivityFeedback>
            )}
          </>
        }
        footer={
          entry && (
            <ActivityFooter>
              {!revealed && (
                <Button
                  variant="primary"
                  onPress={() => {
                    setRevealed(true);
                  }}
                >
                  {t("vocabulary.review.reveal")}
                </Button>
              )}
              {revealed &&
                !dueOn &&
                !error &&
                (["again", "hard", "good", "easy"] as const).map((value) => (
                  <Button
                    key={value}
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void grade(value)}
                  >
                    {t(`vocabulary.grades.${value}`)}
                  </Button>
                ))}
              {(dueOn || error) && (
                <Button variant="primary" ref={nextButton} isDisabled={busy} onPress={next}>
                  {t(error ? "vocabulary.review.skip" : "vocabulary.review.next")}
                </Button>
              )}
            </ActivityFooter>
          )
        }
      >
        {entry && (
          <>
            <FieldGroup>
              <span>{t("vocabulary.review.retrieval")}</span>
              <SelectControl
                value={retrieval}
                disabled={revealed || busy}
                onChange={(event) => {
                  setRetrieval(event.target.value as typeof retrieval);
                }}
              >
                {(["recognition", "recall", "use"] as const).map((mode) => (
                  <option
                    key={mode}
                    value={mode}
                    disabled={
                      (entry.retrievalSchedules.find((s) => s.retrieval === mode)?.dueOn ?? today) >
                      today
                    }
                  >
                    {t(`vocabulary.review.modes.${mode}`)} ·{" "}
                    {entry.retrievalSchedules.find((s) => s.retrieval === mode)?.dueOn}
                  </option>
                ))}
              </SelectControl>
            </FieldGroup>
            <p>{t(`vocabulary.review.prompts.${retrieval}`)}</p>
            {retrieval !== "recall" && !revealed && (
              <SpeechButton text={entry.lemma} language={entry.targetLanguage} />
            )}
            <RecallCard
              identity={index}
              cue={retrieval === "recall" && !revealed ? entry.meaning : entry.lemma}
              language={retrieval === "recall" && !revealed ? "" : entry.targetLanguage}
              revealed={revealed}
              answerLabel={t("vocabulary.review.answer")}
              answer={<VocabularyInformation entry={entry} />}
            />
          </>
        )}
        {queue && !entry && (
          <ActivityCompletion
            companion={reviewed > 0 ? "celebration" : "listening"}
            title={t("vocabulary.review.complete")}
            summary={
              <>
                <p>{t("vocabulary.review.reviewed", { count: reviewed })}</p>
                {queue.length === 0 && <p>{t("vocabulary.review.noneDue")}</p>}
              </>
            }
            actions={
              <ActionGroup>
                <Button variant="primary" isPending={busy} onPress={() => void load()}>
                  {t("vocabulary.review.another")}
                </Button>
                <Button variant="secondary" onPress={onExit}>
                  {t("vocabulary.review.back")}
                </Button>
              </ActionGroup>
            }
          />
        )}
      </ActivityFrame>
    </ActivityWorkspace>
  );
}
