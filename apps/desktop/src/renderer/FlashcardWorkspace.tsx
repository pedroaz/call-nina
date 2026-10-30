import { SpeechButton } from "./SpeechButton.js";
import { type ActivityId, vocabularyLemma } from "@call-nina/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ConfirmDialog,
  UtilityPopover,
  Feedback,
  LoadingState,
} from "./components/ui/index.js";
import {
  ActivityWorkspace,
  ActivityFrame,
  ActivityProgress,
  ActivityFooter,
  ActivityCompletion,
  RecallCard,
} from "./components/activity/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { CompletionActions } from "./CompletionActions.js";
import { useFlashcardSession } from "./useFlashcardSession.js";
import { OperationError } from "./Startup.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import styles from "./FlashcardWorkspace.module.css";

export function FlashcardWorkspace({
  activityId,
  parentLabel,
  activityBreadcrumbs,
  activityTitle,
  courseCompletionActions,
  onClose,
  onVocabulary,
  onResults,
  onNina,
}: {
  activityId: ActivityId;
  parentLabel: string;
  activityBreadcrumbs?: ReadonlyArray<{ label: string; onPress: () => void }> | undefined;
  activityTitle?: string | undefined;
  courseCompletionActions?: ReactNode;
  onClose: () => void;
  onVocabulary: () => void;
  onResults: () => void;
  onNina: () => void;
}) {
  const { t } = useTranslation();
  const { deck, card, saved, flipped, busy, error, load, move, save, flip, setError } =
    useFlashcardSession(activityId);
  const allSaved =
    deck &&
    deck.vocabulary.length === deck.content.cards.length &&
    deck.vocabulary.every((item) => item.status !== "candidate");
  return (
    <ActivityWorkspace
      data-activity-id={activityId}
      data-current-vocabulary-id={saved?.vocabularyId}
      data-activity-material-id={deck?.content.materials[0]?.materialId}
      data-activity-material-revision={deck?.content.materials[0]?.revisionId}
      data-root-generation={deck?.rootGeneration}
      data-learning-language={deck?.content.language}
      title={activityTitle ?? deck?.title ?? t("flashcards.title")}
      breadcrumbs={activityBreadcrumbs ?? [{ label: parentLabel, onPress: onClose }]}
      actions={
        deck && (
          <ConfirmDialog
            menuLabel={t("ui.activityActions")}
            trigger={t("flashcards.delete")}
            title={t("flashcards.delete")}
            body={t("flashcards.deleteBody")}
            confirm={t("flashcards.delete")}
            cancel={t("actions.cancel")}
            menuItems={[
              ...(deck.source === "generated"
                ? [
                    {
                      id: "save-all",
                      label: t("flashcards.saveAll"),
                      isDisabled: busy || Boolean(allSaved),
                      onAction: () => {
                        save(deck.content.cards.map((_, index) => index));
                      },
                    },
                  ]
                : []),
              { id: "vocabulary", label: t("flashcards.openVocabulary"), onAction: onVocabulary },
            ]}
            onConfirm={async () => {
              try {
                await invokeDesktop("prepared-activity/delete", { activityId });
                onClose();
              } catch (cause) {
                setError(normalizeDesktopError(cause).detail);
                throw cause;
              }
            }}
          />
        )
      }
    >
      {!deck && busy && <LoadingState live>{t("ui.loading")}</LoadingState>}
      {deck && card ? (
        <ActivityFrame
          taskLabel={t("activity.task")}
          progress={
            !deck.progress.completed && (
              <ActivityProgress
                current={deck.progress.position + 1}
                total={deck.content.cards.length}
                label={t("flashcards.position", {
                  current: deck.progress.position + 1,
                  total: deck.content.cards.length,
                })}
              />
            )
          }
          feedback={
            <>
              {error && <OperationError error={error} />}
              {saved?.status === "suspended" && (
                <Feedback live="polite">{t("flashcards.suspended")}</Feedback>
              )}
            </>
          }
          footer={
            !deck.progress.completed && (
              <div data-flashcard-controls>
                <ActivityFooter
                  previous={
                    <Button
                      variant="secondary"
                      aria-keyshortcuts="ArrowLeft"
                      isDisabled={busy || deck.progress.position === 0}
                      onPress={() => {
                        move(deck.progress.position - 1);
                      }}
                    >
                      {t("flashcards.previous")}
                    </Button>
                  }
                  utilities={
                    deck.source === "generated" && (
                      <Button
                        variant="quiet"
                        isDisabled={busy || Boolean(saved && saved.status !== "candidate")}
                        onPress={() => {
                          save([deck.progress.position]);
                        }}
                      >
                        {t(
                          saved && saved.status !== "candidate"
                            ? "flashcards.saved"
                            : "flashcards.saveWord",
                        )}
                      </Button>
                    )
                  }
                >
                  <Button
                    variant={flipped ? "secondary" : "primary"}
                    aria-keyshortcuts="Space"
                    aria-pressed={flipped}
                    isDisabled={busy}
                    onPress={() => void flip()}
                  >
                    {t(flipped ? "flashcards.front" : "flashcards.flip")}
                  </Button>
                  <Button
                    variant={flipped ? "primary" : "secondary"}
                    aria-keyshortcuts={
                      deck.progress.position < deck.content.cards.length - 1
                        ? "ArrowRight"
                        : undefined
                    }
                    isDisabled={busy}
                    onPress={() => {
                      move(
                        Math.min(deck.content.cards.length - 1, deck.progress.position + 1),
                        deck.progress.position === deck.content.cards.length - 1,
                      );
                    }}
                  >
                    {t(
                      deck.progress.position === deck.content.cards.length - 1
                        ? "flashcards.finish"
                        : "flashcards.next",
                    )}
                  </Button>
                </ActivityFooter>
              </div>
            )
          }
        >
          {deck.progress.completed ? (
            <ActivityCompletion
              companion="celebration"
              title={t("flashcards.complete")}
              summary={<p>{t("flashcards.completeBody", { count: deck.content.cards.length })}</p>}
              actions={
                <>
                  {courseCompletionActions ?? (
                    <CompletionActions
                      targetLanguage={deck.content.language}
                      rootGeneration={deck.rootGeneration}
                      evidence="self-assessment"
                      parentLabel={parentLabel}
                      onReturn={onClose}
                      onResults={onResults}
                      onNina={onNina}
                    />
                  )}
                  <ActionGroup>
                    <Button
                      variant="quiet"
                      isDisabled={busy}
                      onPress={() => {
                        move(0);
                      }}
                    >
                      {t("flashcards.restart")}
                    </Button>
                  </ActionGroup>
                </>
              }
            />
          ) : (
            <>
              <RecallCard
                identity={deck.progress.position}
                language={deck.content.language}
                revealed={flipped}
                answerLabel={t("flashcards.meaning")}
                cue={
                  <>
                    {card.lexeme.partOfSpeech === "noun"
                      ? `${card.lexeme.nounForm.article ? `${card.lexeme.nounForm.article} ` : ""}${vocabularyLemma(card, deck.content.language)}`
                      : card.lemma}{" "}
                    <SpeechButton
                      text={
                        card.lexeme.partOfSpeech === "noun"
                          ? `${card.lexeme.nounForm.article ? `${card.lexeme.nounForm.article} ` : ""}${vocabularyLemma(card, deck.content.language)}`
                          : card.lemma
                      }
                      language={deck.content.language}
                    />
                  </>
                }
                answer={
                  <>
                    <p>{card.meaning}</p>
                    {card.lexeme.partOfSpeech === "noun" &&
                      card.lexeme.plural.status === "form" && (
                        <p lang={deck.content.language}>
                          {t("flashcards.plural")}: {card.lexeme.plural.form}
                        </p>
                      )}
                    {card.lexeme.partOfSpeech === "noun" &&
                      card.lexeme.plural.status === "unchanged" && (
                        <p>{t("flashcards.pluralUnchanged")}</p>
                      )}
                    {card.lexeme.partOfSpeech === "verb" && card.lexeme.pattern && (
                      <p lang={deck.content.language}>{card.lexeme.pattern}</p>
                    )}
                    {card.lexeme.partOfSpeech === "phrase" && card.lexeme.function && (
                      <p>{card.lexeme.function}</p>
                    )}
                    {card.examples.map((example, index) => (
                      <div key={index} className={styles.example}>
                        <p lang={deck.content.language}>
                          {example.text}
                          {flipped && (
                            <SpeechButton text={example.text} language={deck.content.language} />
                          )}
                        </p>
                        <p>{example.meaning}</p>
                      </div>
                    ))}
                  </>
                }
              />
              <UtilityPopover label={t("activity.shortcuts")}>
                <p>{t("flashcards.study.shortcuts")}</p>
              </UtilityPopover>
            </>
          )}
        </ActivityFrame>
      ) : (
        error && (
          <>
            <OperationError error={error} />
            <Button variant="secondary" isDisabled={busy} onPress={() => void load()}>
              {t("vocabulary.refresh")}
            </Button>
          </>
        )
      )}
    </ActivityWorkspace>
  );
}
