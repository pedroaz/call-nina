import { formatInterfaceDate } from "../../runtime/formatting.js";
import type { DataRootGeneration } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import {
  ActivityCompletion,
  ActivityFeedback,
  ActivityFooter,
  ActivityFrame,
  ActivityProgress,
  ActivityWorkspace,
  RecallCard,
} from "../../components/activity/index.js";
import { ActionGroup } from "../../components/layout/index.js";
import { Button, FieldGroup, LoadingState, SelectControl } from "../../components/ui/index.js";
import { SpeechButton } from "../../learning/speech/SpeechButton.js";
import { VocabularyInformation } from "../../learning/vocabulary/VocabularyDetails.js";
import { useVocabularyReviewSession } from "./useVocabularyReviewSession.js";

export function VocabularyReview({
  rootGeneration,
  uploadId,
  onExit,
  onChanged,
}: {
  rootGeneration: DataRootGeneration;
  uploadId?: string | undefined;
  onExit: () => void;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
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
  } = useVocabularyReviewSession(rootGeneration, onChanged, uploadId);
  return (
    <ActivityWorkspace
      title={t("vocabulary.review.title")}
      breadcrumbs={[{ label: t("vocabulary.title"), onPress: onExit }]}
    >
      {!queue && busy && <LoadingState live>{t("ui.loading")}</LoadingState>}
      {!queue && !busy && (
        <Button variant="secondary" onPress={() => void load()}>
          {t("actions.retry")}
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
                {t("vocabulary.review.saved", { date: formatInterfaceDate(dueOn, i18n.language) })}
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
                    {formatInterfaceDate(
                      entry.retrievalSchedules.find((s) => s.retrieval === mode)?.dueOn,
                      i18n.language,
                    )}
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
