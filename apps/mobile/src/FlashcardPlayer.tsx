import { useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { useTranslation } from "react-i18next";
import { vocabularyLemma, type MobileDeck } from "@call-nina/contracts";
import {
  NativeButton,
  NativeCard,
  NativeRow,
  NativeScreen,
  NativeStack,
  NativeText,
} from "./ui/primitives";
import { readProgress, saveProgress, type Progress } from "./storage";
export function FlashcardPlayer({
  user,
  deck,
  onClose,
  assertCurrent,
}: {
  user: string;
  deck: MobileDeck;
  onClose: () => void;
  assertCurrent: () => void;
}) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<Progress>();
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void readProgress(user, deck)
      .then((p) => {
        if (mounted.current) setProgress(p);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      });
    return () => {
      mounted.current = false;
    };
  }, [user, deck]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!locked.current) onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  const move = async (position: number, completed = false) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(false);
    try {
      const next = { position, completed };
      await saveProgress(user, deck, next, assertCurrent);
      if (mounted.current) {
        setProgress(next);
        setRevealed(false);
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const card = progress ? deck.content.cards[progress.position] : undefined;
  return (
    <NativeScreen>
      <NativeButton label={t("mobile.back")} onPress={onClose} disabled={busy} variant="quiet" />
      <NativeText variant="title">{deck.title}</NativeText>
      {error && <NativeText accessibilityRole="alert">{t("mobile.saveError")}</NativeText>}
      {!progress && <NativeText>{t("mobile.loading")}</NativeText>}
      {progress?.completed ? (
        <NativeStack>
          <NativeText variant="heading">{t("flashcards.complete")}</NativeText>
          <NativeText>
            {t("flashcards.completeBody", { count: deck.content.cards.length })}
          </NativeText>
          <NativeRow>
            <NativeButton
              label={t("flashcards.restart")}
              disabled={busy}
              onPress={() => void move(0)}
              variant="primary"
            />
            <NativeButton label={t("mobile.back")} onPress={onClose} disabled={busy} />
          </NativeRow>
        </NativeStack>
      ) : (
        progress &&
        card && (
          <>
            <NativeText tone="muted" accessibilityLiveRegion="polite">
              {t("flashcards.position", {
                current: progress.position + 1,
                total: deck.content.cards.length,
              })}
            </NativeText>
            <NativeCard>
              <NativeText variant="heading" accessibilityLanguage={deck.content.language}>
                {card.lexeme.partOfSpeech === "noun"
                  ? `${card.lexeme.nounForm.article ? card.lexeme.nounForm.article + " " : ""}${vocabularyLemma(card, deck.content.language)}`
                  : card.lemma}
              </NativeText>
              {!revealed && <NativeText tone="muted">{t("flashcards.study.recall")}</NativeText>}
              {revealed && (
                <NativeStack>
                  <NativeText accessibilityLiveRegion="polite">{card.meaning}</NativeText>
                  {card.lexeme.partOfSpeech === "noun" && card.lexeme.plural.status === "form" && (
                    <NativeText>
                      {t("flashcards.plural")}: {card.lexeme.plural.form}
                    </NativeText>
                  )}
                  {card.lexeme.partOfSpeech === "noun" &&
                    card.lexeme.plural.status === "unchanged" && (
                      <NativeText>{t("flashcards.pluralUnchanged")}</NativeText>
                    )}
                  {card.lexeme.partOfSpeech === "verb" && card.lexeme.pattern && (
                    <NativeText>{card.lexeme.pattern}</NativeText>
                  )}
                  {card.lexeme.partOfSpeech === "phrase" && card.lexeme.function && (
                    <NativeText>{card.lexeme.function}</NativeText>
                  )}
                  {card.examples.map((example, index) => (
                    <NativeStack key={index}>
                      <NativeText variant="lead" accessibilityLanguage={deck.content.language}>
                        {example.text}
                      </NativeText>
                      <NativeText tone="muted">{example.meaning}</NativeText>
                    </NativeStack>
                  ))}
                </NativeStack>
              )}
            </NativeCard>
            <NativeRow>
              <NativeButton
                label={t("flashcards.previous")}
                disabled={busy || progress.position === 0}
                onPress={() => void move(progress.position - 1)}
              />
              <NativeButton
                label={t(revealed ? "flashcards.front" : "flashcards.flip")}
                disabled={busy}
                onPress={() => setRevealed((v) => !v)}
                variant="primary"
              />
              <NativeButton
                label={t(
                  progress.position === deck.content.cards.length - 1
                    ? "flashcards.finish"
                    : "flashcards.next",
                )}
                disabled={busy}
                onPress={() =>
                  void move(
                    Math.min(progress.position + 1, deck.content.cards.length - 1),
                    progress.position === deck.content.cards.length - 1,
                  )
                }
              />
            </NativeRow>
          </>
        )
      )}
    </NativeScreen>
  );
}
