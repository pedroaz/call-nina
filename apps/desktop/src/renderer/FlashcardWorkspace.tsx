import { CompletionActions } from "./CompletionActions.js";
import { SavedTranslation, type TranslationAccess } from "./SavedTranslation.js";
import {
  translationRevealSchema,
  type CorrelationId,
  vocabularyLemma,
  type ActivityId,
  type FlashcardDeck,
  type CallNinaError,
} from "@call-nina/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, ConfirmDialog, Feedback, LoadingState } from "./components/ui/index.js";
import { Page, ActionGroup } from "./components/layout/index.js";
import { createDesktopSubmissionId, invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { OperationError } from "./Startup.js";
import styles from "./FlashcardWorkspace.module.css";

export function FlashcardWorkspace({
  activityId,
  parentLabel,
  onClose,
  onVocabulary,
  onHistory,
  onNina,
  requestAiAccess,
}: {
  activityId: ActivityId;
  parentLabel: string;
  onClose: () => void;
  onVocabulary: () => void;
  onHistory: () => void;
  onNina: () => void;
  requestAiAccess: TranslationAccess;
}) {
  const { t } = useTranslation();
  const [deck, setDeck] = useState<FlashcardDeck>();
  const [flipped, setFlipped] = useState(false);
  const [revealId, setRevealId] = useState<CorrelationId>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [notice, setNotice] = useState(false);
  const locked = useRef(false);
  const version = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    const current = ++version.current;
    setBusy(true);
    setError(undefined);
    try {
      const root = await invokeDesktop("data-root/read", {});
      if (root.status !== "ready") throw new Error("OD_DATA_ROOT_STALE");
      const result = await invokeDesktop("flashcards/read", {
        activityId,
        rootGeneration: root.generation,
      });
      if (current === version.current) {
        setDeck(result);
        setFlipped(false);
        setRevealId(undefined);
      }
    } catch (cause) {
      if (current === version.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === version.current) setBusy(false);
    }
  }, [activityId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      version.current += 1;
    };
  }, [load]);
  useEffect(() => {
    heading.current?.focus();
  }, [deck?.progress.position, deck?.progress.completed]);
  const mutate = async (action: () => Promise<FlashcardDeck>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const current = version.current;
    try {
      const next = await action();
      if (current === version.current) setDeck(next);
    } catch (cause) {
      if (current === version.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      locked.current = false;
      if (current === version.current) setBusy(false);
    }
  };
  const move = (position: number, completed = false) => {
    if (!deck) return;
    void mutate(async () => {
      const result = await invokeDesktop("flashcards/progress", {
        activityId,
        rootGeneration: deck.rootGeneration,
        expectedRevision: deck.progress.revision,
        position,
        completed,
      });
      setFlipped(false);
      setRevealId(undefined);
      setNotice(false);
      return result;
    });
  };
  const save = (positions: number[]) => {
    if (!deck) return;
    void mutate(async () => {
      const result = await invokeDesktop("flashcards/save-vocabulary", {
        activityId,
        rootGeneration: deck.rootGeneration,
        positions,
      });
      setNotice(true);
      return result;
    });
  };
  const revealKey =
    deck && revealId
      ? JSON.stringify({
          activityId,
          rootGeneration: deck.rootGeneration,
          content: { contentId: deck.content.contentId, revisionId: deck.content.revisionId },
          position: deck.progress.position,
          progressRevision: deck.progress.revision,
          revealId,
          visible: false,
        })
      : null;
  useEffect(() => {
    if (!revealKey) return;
    const payload = translationRevealSchema.parse(JSON.parse(revealKey));
    return () => {
      void invokeDesktop("translation/flashcard-visibility", payload).catch(() => undefined);
    };
  }, [revealKey]);
  const flip = async () => {
    if (!deck || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const nextId = revealId && flipped ? revealId : createDesktopSubmissionId();
      await invokeDesktop("translation/flashcard-visibility", {
        activityId,
        rootGeneration: deck.rootGeneration,
        content: { contentId: deck.content.contentId, revisionId: deck.content.revisionId },
        position: deck.progress.position,
        progressRevision: deck.progress.revision,
        revealId: nextId,
        visible: !flipped,
      });
      setRevealId(flipped ? undefined : nextId);
      setFlipped(!flipped);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const translateCard = (index?: number) =>
    deck && revealId ? (
      <SavedTranslation
        request={{
          activityId,
          rootGeneration: deck.rootGeneration,
          content: { contentId: deck.content.contentId, revisionId: deck.content.revisionId },
          field:
            index === undefined
              ? { kind: "flashcard-meaning", position: deck.progress.position, revealId }
              : { kind: "flashcard-example", position: deck.progress.position, index, revealId },
        }}
        requestAiAccess={requestAiAccess}
      />
    ) : null;
  const card = deck?.content.cards[deck.progress.position];
  const saved = deck?.vocabulary.find((item) => item.position === deck.progress.position);
  return (
    <Page
      data-activity-id={activityId}
      data-activity-material-id={deck?.content.materials[0]?.materialId}
      data-activity-material-revision={deck?.content.materials[0]?.revisionId}
      data-root-generation={deck?.rootGeneration}
      data-learning-language={deck?.content.language}
      title={deck?.title ?? t("flashcards.title")}
      breadcrumbs={[{ label: parentLabel, onPress: onClose }]}
    >
      {error && (
        <>
          <OperationError error={error} />
          <Button isDisabled={busy} onPress={() => void load()}>
            {t("vocabulary.refresh")}
          </Button>
        </>
      )}
      {!deck && busy && <LoadingState live>{t("ui.loading")}</LoadingState>}
      {deck && card && (
        <Card as="article" className={styles.card}>
          {deck.progress.completed ? (
            <>
              <h2 ref={heading} tabIndex={-1}>
                {t("flashcards.complete")}
              </h2>
              <p>{t("flashcards.completeBody", { count: deck.content.cards.length })}</p>
              <CompletionActions
                targetLanguage={deck.content.language}
                rootGeneration={deck.rootGeneration}
                evidence="self-assessment"
                parentLabel={parentLabel}
                onReturn={onClose}
                onHistory={onHistory}
                onNina={onNina}
              />
              <ActionGroup>
                <Button
                  isDisabled={busy}
                  onPress={() => {
                    move(0);
                  }}
                >
                  {t("flashcards.restart")}
                </Button>
              </ActionGroup>
            </>
          ) : (
            <>
              <p aria-live="polite">
                {t("flashcards.position", {
                  current: deck.progress.position + 1,
                  total: deck.content.cards.length,
                })}
              </p>
              <h2 ref={heading} tabIndex={-1} lang={deck.content.language}>
                {card.lexeme.partOfSpeech === "noun"
                  ? `${card.lexeme.nounForm.article ? `${card.lexeme.nounForm.article} ` : ""}${vocabularyLemma(card, deck.content.language)}`
                  : card.lemma}
              </h2>
              {flipped && (
                <div
                  className={styles.answer}
                  role="region"
                  aria-label={t("flashcards.meaning")}
                  aria-live="polite"
                >
                  <p>{card.meaning}</p>
                  {translateCard()}
                  {card.lexeme.partOfSpeech === "noun" && card.lexeme.plural.status === "form" && (
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
                    <div key={index}>
                      <p lang={deck.content.language}>{example.text}</p>
                      <p>{example.meaning}</p>
                      {translateCard(index)}
                    </div>
                  ))}
                </div>
              )}
              <ActionGroup>
                <Button
                  isDisabled={busy || deck.progress.position === 0}
                  onPress={() => {
                    move(deck.progress.position - 1);
                  }}
                >
                  {t("flashcards.previous")}
                </Button>
                <Button
                  isDisabled={busy}
                  aria-pressed={flipped}
                  onPress={() => {
                    void flip();
                  }}
                >
                  {t(flipped ? "flashcards.front" : "flashcards.flip")}
                </Button>
                <Button
                  variant="primary"
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
              </ActionGroup>
            </>
          )}
          {deck.source === "generated" && (
            <ActionGroup>
              {!deck.progress.completed && (
                <Button
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
              )}
              <Button
                isDisabled={
                  busy ||
                  (deck.vocabulary.length === deck.content.cards.length &&
                    deck.vocabulary.every((item) => item.status !== "candidate"))
                }
                onPress={() => {
                  save(deck.content.cards.map((_, index) => index));
                }}
              >
                {t("flashcards.saveAll")}
              </Button>
              <Button variant="quiet" onPress={onVocabulary}>
                {t("flashcards.openVocabulary")}
              </Button>
            </ActionGroup>
          )}
          {saved?.status === "suspended" && (
            <Feedback live="polite">{t("flashcards.suspended")}</Feedback>
          )}
          {notice && <Feedback live="polite">{t("flashcards.saveNotice")}</Feedback>}
        </Card>
      )}
      {deck && (
        <ConfirmDialog
          title={t("flashcards.delete")}
          body={t("flashcards.deleteBody")}
          confirm={t("flashcards.delete")}
          trigger={t("flashcards.delete")}
          cancel={t("actions.cancel")}
          onConfirm={async () => {
            try {
              await invokeDesktop("prepared-activity/delete", { activityId });
              onClose();
            } catch (cause) {
              setError(normalizeDesktopError(cause).detail);
            }
          }}
        />
      )}
    </Page>
  );
}
