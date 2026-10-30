import { SpeechButton } from "./SpeechButton.js";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Repeat2, Sparkles } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  ModalDialog,
  Muted,
  ItemList,
  Feedback,
} from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import type { Entry, HistoryPracticeSeed, PracticeState } from "./savedResultsTypes.js";
import styles from "./HistoryPage.module.css";

function practiceSeed(entry: Entry): HistoryPracticeSeed {
  if (entry.detail.kind !== "writing-correction") throw new Error("OD_HISTORY_DETAIL_INVALID");
  return {
    kind: "writing",
    historyEntryId: entry.historyEntryId,
    draft: entry.detail.learnerText,
    context: entry.title,
  };
}

function exerciseAnswerText(detail: Extract<Entry["detail"], { kind: "exercise-attempt" }>) {
  const answer = detail.answer;
  if (answer.kind === "multiple-choice") {
    return `#${String(answer.selectedOptionPosition + 1)}`;
  }
  if (answer.kind === "fill-in-the-blank") return answer.valuesByBlankPosition.join(" · ");
  return answer.text;
}

export function SavedResultDetail({
  entry,
  isOpen,
  onClose,
  operationStatus,
  dateFormatter,
  deleteEntry,
  onPracticeAgain,
  createVoiceFollowUp,
  feedbackTranslation,
  practiceState,
}: {
  entry: Entry;
  isOpen: boolean;
  onClose: () => void;
  operationStatus: ReactNode;
  dateFormatter: Intl.DateTimeFormat;
  deleteEntry: (entry: Entry) => Promise<void>;
  onPracticeAgain: (seed: HistoryPracticeSeed) => void;
  createVoiceFollowUp: (entry: Entry) => Promise<void>;
  feedbackTranslation: (
    entry: Entry,
    field: "feedback-summary" | "feedback-strength" | "feedback-improvement",
    index?: number,
  ) => ReactNode;
  practiceState: PracticeState | undefined;
}) {
  const { t } = useTranslation();
  return (
    <ModalDialog
      keepMounted
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="large"
      title={entry.title}
      closeLabel={t("actions.close")}
    >
      {operationStatus}
      <Muted as="p">
        {t(`history.activityTypes.${entry.activityType}`)} ·{" "}
        {dateFormatter.format(new Date(entry.occurredAt))}
      </Muted>
      {entry.evidence && <Muted as="p">{t(`history.evidenceBasis.${entry.evidence.basis}`)}</Muted>}
      {entry.curriculumTopicIds.length > 0 && (
        <Muted as="p">
          {t("history.topics")}: {entry.curriculumTopicIds.join(", ")}
        </Muted>
      )}
      {entry.mistakeCategories.length > 0 && (
        <Muted as="p">
          {t("history.mistakes")}: {entry.mistakeCategories.join(", ")}
        </Muted>
      )}
      {entry.detail.kind === "attempt-feedback" ? (
        <div className={styles.historyDetail}>
          <h3>{t(entry.detail.later ? "history.laterFeedback" : "history.feedback")}</h3>
          <p>{entry.detail.feedback.summary}</p>
          <ItemList>
            {entry.detail.feedback.evidence.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ItemList>
          <ConfirmDialog
            body={t("history.deleteBody")}
            cancel={t("actions.cancel")}
            confirm={t("actions.delete")}
            onConfirm={() => deleteEntry(entry)}
            title={t("history.deleteTitle")}
            triggerVariant="quiet"
            trigger={t("history.delete")}
          />
        </div>
      ) : entry.detail.kind === "writing-correction" ? (
        <div className={styles.historyDetail}>
          <div className={styles.correctionGrid}>
            <section className={styles.correctionPane}>
              <h3>{t("history.learnerOriginal")}</h3>
              <p className={styles.correctionText}>{entry.detail.learnerText}</p>
            </section>
            <section className={styles.correctionPane}>
              <h3>{t("history.modelCorrection")}</h3>
              <p className={styles.correctionText} lang={entry.targetLanguage}>
                {entry.detail.correctedText}
              </p>
              <SpeechButton
                text={entry.detail.correctedText}
                language={entry.targetLanguage}
                variant="passage"
                enabled={isOpen}
              />
            </section>
          </div>
          <section>
            <h3>{t("history.feedback")}</h3>
            <p>{entry.detail.feedback.summary}</p>
            <h4>{t("history.strengths")}</h4>
            <ItemList>
              {entry.detail.feedback.strengths.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ItemList>
            <h4>{t("history.improvements")}</h4>
            <ItemList>
              {entry.detail.feedback.improvements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ItemList>
          </section>
          {entry.detail.vocabularyCandidates.length > 0 && (
            <section>
              <h3>{t("history.vocabularyCandidates")}</h3>
              <ItemList>
                {entry.detail.vocabularyCandidates.map((candidate) => (
                  <li key={`${candidate.lemma}:${candidate.meaning}`}>
                    <strong lang={entry.targetLanguage}>{candidate.lemma}</strong>{" "}
                    <SpeechButton
                      text={candidate.lemma}
                      language={entry.targetLanguage}
                      enabled={isOpen}
                    />{" "}
                    — {candidate.meaning}. {candidate.rationale}
                  </li>
                ))}
              </ItemList>
            </section>
          )}
          <Muted as="p">
            {entry.detail.provenance.availability === "reported"
              ? t("history.modelProvenance", {
                  model: entry.detail.provenance.modelId,
                  effort: entry.detail.provenance.effortId,
                })
              : t("history.modelNotReported")}
          </Muted>
          <ActionGroup>
            <Button
              variant="primary"
              onPress={() => {
                onClose();
                onPracticeAgain(practiceSeed(entry));
              }}
            >
              <Repeat2 aria-hidden="true" /> {t("history.practiceAgain")}
            </Button>
            <ConfirmDialog
              body={t("history.deleteBody")}
              cancel={t("actions.cancel")}
              confirm={t("actions.delete")}
              onConfirm={() => deleteEntry(entry)}
              title={t("history.deleteTitle")}
              triggerVariant="quiet"
              trigger={t("history.delete")}
            />
          </ActionGroup>
        </div>
      ) : entry.detail.kind === "listening" ? (
        <div className={styles.historyDetail} data-testid="listening-detail">
          <section>
            <h3>{t("history.listeningSummary")}</h3>
            <ItemList>
              {entry.detail.exerciseResults.map((exercise) => (
                <li key={exercise.kind}>
                  <strong>{exercise.kind}</strong>: {exercise.outcome} — {exercise.evidence}
                </li>
              ))}
            </ItemList>
            {entry.detail.difficultVocabulary.length > 0 && (
              <p>
                {t("history.listeningWords", {
                  words: entry.detail.difficultVocabulary.join(", "),
                })}
              </p>
            )}
          </section>
          <section>
            <h3>{t("history.listeningNextSteps")}</h3>
            <ItemList>
              {entry.detail.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ItemList>
          </section>
          <Feedback live="off">{t("history.listeningNoAudio")}</Feedback>
          <ConfirmDialog
            body={t("history.deleteBody")}
            cancel={t("actions.cancel")}
            confirm={t("actions.delete")}
            onConfirm={() => deleteEntry(entry)}
            title={t("history.deleteTitle")}
            trigger={t("history.delete")}
          />
        </div>
      ) : entry.detail.kind === "placement" ? (
        <div className={styles.historyDetail} data-testid="placement-detail">
          <section>
            <h3>{t("history.placementSummary")}</h3>
            <p>{t("practice.diagnosticFlow.limitedEvidence")}</p>
            <Feedback live="off" tone="warning">
              {entry.detail.uncertainty.level === "none"
                ? t("history.placementUncertaintyNone")
                : entry.detail.uncertainty.explanation}
            </Feedback>
          </section>
          <section>
            <h3>{t("history.placementEvidence")}</h3>
            <ItemList>
              {entry.detail.sampleResults.map((sample) => (
                <li key={sample.kind}>
                  <strong>{sample.topic}</strong>:{" "}
                  {t(`history.placementOutcomes.${sample.outcome}`)} — {sample.evidence}
                </li>
              ))}
            </ItemList>
          </section>
          <Feedback live="off" tone="warning">
            {entry.detail.voiceCalibration.explanation}
          </Feedback>
          <ConfirmDialog
            body={t("history.deleteBody")}
            cancel={t("actions.cancel")}
            confirm={t("actions.delete")}
            onConfirm={() => deleteEntry(entry)}
            title={t("history.deleteTitle")}
            trigger={t("history.delete")}
          />
        </div>
      ) : entry.detail.kind === "voice-summary" ? (
        <div className={styles.historyDetail} data-testid="voice-summary-detail">
          <section>
            <h3>{t("history.voiceSummary.scenario")}</h3>
            <p>
              <strong>{entry.detail.scenario.title}</strong> — {entry.detail.scenario.topic}
            </p>
            <Muted as="p">
              {t("history.voiceSummary.level", {
                level: entry.detail.scenario.targetLevel.toUpperCase(),
              })}
              {" · "}
              {entry.detail.duration.status === "known"
                ? t("history.voiceSummary.duration", {
                    minutes: Math.max(1, Math.round(entry.detail.duration.milliseconds / 60_000)),
                  })
                : t("history.voiceSummary.durationUnknown")}
            </Muted>
          </section>
          <section>
            <h3>{t("history.feedback")}</h3>
            <p>{entry.detail.feedback.summary}</p>
            {entry.detail.feedback.strengths.length > 0 && (
              <ItemList>
                {entry.detail.feedback.strengths.map((item) => (
                  <li key={`strength:${item}`}>{item}</li>
                ))}
              </ItemList>
            )}
            {entry.detail.feedback.priorities.length > 0 && (
              <ItemList>
                {entry.detail.feedback.priorities.map((item) => (
                  <li key={`priority:${item}`}>{item}</li>
                ))}
              </ItemList>
            )}
          </section>
          {entry.detail.observedIssues.length > 0 && (
            <section>
              <h3>{t("history.voiceSummary.issues")}</h3>
              <ItemList>
                {entry.detail.observedIssues.map((issue) => (
                  <li key={`${issue.category}:${issue.observation}`}>
                    <strong>{issue.category}</strong>: {issue.observation} — {issue.feedback}
                  </li>
                ))}
              </ItemList>
            </section>
          )}
          {entry.detail.vocabulary.length > 0 && (
            <section>
              <h3>{t("history.voiceSummary.vocabulary")}</h3>
              <ItemList>
                {entry.detail.vocabulary.map((item) => (
                  <li key={`${item.lemma}:${item.meaning}`}>
                    <strong>{item.lemma}</strong> — {item.meaning}. {item.contextSummary}
                  </li>
                ))}
              </ItemList>
            </section>
          )}
          <section>
            <h3>{t("history.voiceSummary.nextSteps")}</h3>
            <ItemList>
              {entry.detail.nextSteps.map((step) => (
                <li key={`${step.title}:${step.naturalRequest}`}>
                  <strong>{step.title}</strong> — {step.rationale}
                </li>
              ))}
            </ItemList>
            <ActionGroup>
              {practiceState?.patternKey === `voice:${entry.historyEntryId}` &&
              practiceState.status === "created" ? (
                <Feedback live="off" tone="success">
                  {t("history.voiceSummary.practiceCreated")}
                </Feedback>
              ) : practiceState?.patternKey === `voice:${entry.historyEntryId}` &&
                (practiceState.status === "queued" || practiceState.status === "running") ? (
                <Feedback live="off">
                  {practiceState.status === "queued"
                    ? t("history.voiceSummary.practiceQueued")
                    : t("history.voiceSummary.practiceRunning")}
                </Feedback>
              ) : (
                <Button variant="primary" onPress={() => void createVoiceFollowUp(entry)}>
                  <Sparkles aria-hidden="true" /> {t("history.voiceSummary.practice")}
                </Button>
              )}
            </ActionGroup>
          </section>
          <Muted as="p">{t("history.voiceSummary.noAudio")}</Muted>
          <ConfirmDialog
            body={t("history.deleteBody")}
            cancel={t("actions.cancel")}
            confirm={t("actions.delete")}
            onConfirm={() => deleteEntry(entry)}
            title={t("history.deleteTitle")}
            trigger={t("history.delete")}
          />
        </div>
      ) : entry.detail.kind === "exercise-attempt" ? (
        <div className={styles.historyDetail}>
          {entry.detail.readingMaterial && (
            <section>
              <h3>{entry.detail.readingMaterial.title}</h3>
              <p className={styles.correctionText} lang={entry.targetLanguage}>
                {entry.detail.readingMaterial.passage}
              </p>
              <SpeechButton
                text={entry.detail.readingMaterial.passage}
                language={entry.targetLanguage}
                variant="passage"
                enabled={isOpen}
              />
            </section>
          )}

          <section>
            <h3>{t("history.exercisePrompt")}</h3>
            <p>{entry.detail.instructions}</p>
            <blockquote>{entry.detail.prompt}</blockquote>
          </section>
          <section>
            <h3>{t("history.exerciseAnswer")}</h3>
            <p className={styles.correctionText}>{exerciseAnswerText(entry.detail)}</p>
          </section>
          <section>
            <h3>{t("history.feedback")}</h3>
            <p>{entry.detail.feedback.summary}</p>
            {feedbackTranslation(entry, "feedback-summary")}
            {entry.detail.feedback.strengths.length > 0 && (
              <>
                <h4>{t("history.strengths")}</h4>
                <ItemList>
                  {entry.detail.feedback.strengths.map((strength, index) => (
                    <li key={index}>
                      {strength}
                      {feedbackTranslation(entry, "feedback-strength", index)}
                    </li>
                  ))}
                </ItemList>
              </>
            )}
            {entry.detail.feedback.improvements.length > 0 && (
              <>
                <h4>{t("history.improvements")}</h4>
                <ItemList>
                  {entry.detail.feedback.improvements.map((improvement, index) => (
                    <li key={index}>
                      {improvement}
                      {feedbackTranslation(entry, "feedback-improvement", index)}
                    </li>
                  ))}
                </ItemList>
              </>
            )}
            <ItemList>
              {entry.detail.objectiveEvaluations.map((evaluation, position) => (
                <li key={`${evaluation.outcome}:${String(position)}`}>
                  <strong>{t(`history.objectiveOutcomes.${evaluation.outcome}`)}</strong>{" "}
                  {evaluation.evidence}
                </li>
              ))}
            </ItemList>
          </section>
          {(entry.detail.suggestedAnswer || entry.detail.acceptedAnswerReveal.length > 0) && (
            <section>
              <h3>{t("history.acceptedEvidence")}</h3>
              {[
                ...new Set(
                  [entry.detail.suggestedAnswer, ...entry.detail.acceptedAnswerReveal].filter(
                    (answer): answer is string => Boolean(answer),
                  ),
                ),
              ].map((answer, index) => (
                <p
                  key={index}
                  lang={
                    entry.detail.kind === "exercise-attempt"
                      ? (entry.detail.answerLanguage ?? undefined)
                      : undefined
                  }
                >
                  {answer}{" "}
                  {entry.detail.kind === "exercise-attempt" && entry.detail.answerLanguage && (
                    <SpeechButton
                      text={answer}
                      language={entry.detail.answerLanguage}
                      enabled={isOpen}
                    />
                  )}
                </p>
              ))}
            </section>
          )}
          <ActionGroup>
            <Button
              variant="primary"
              isDisabled={!entry.activityAvailable}
              onPress={() => {
                if (entry.detail.kind === "exercise-attempt") {
                  onClose();
                  onPracticeAgain({
                    kind: "exercise",
                    activityId: entry.detail.activityId,
                  });
                }
              }}
            >
              <Repeat2 aria-hidden="true" /> {t("history.practiceAgain")}
            </Button>
            <ConfirmDialog
              body={t("history.deleteBody")}
              cancel={t("actions.cancel")}
              confirm={t("actions.delete")}
              onConfirm={() => deleteEntry(entry)}
              title={t("history.deleteTitle")}
              triggerVariant="quiet"
              trigger={t("history.delete")}
            />
          </ActionGroup>
        </div>
      ) : entry.entityKind === "vocabulary-review" ? (
        <ConfirmDialog
          body={t("history.deleteReviewBody")}
          cancel={t("actions.cancel")}
          confirm={t("actions.delete")}
          onConfirm={() => deleteEntry(entry)}
          title={t("history.deleteTitle")}
          triggerVariant="quiet"
          trigger={t("history.delete")}
        />
      ) : null}
    </ModalDialog>
  );
}
