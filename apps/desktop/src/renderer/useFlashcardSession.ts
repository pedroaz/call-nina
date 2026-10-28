import {
  translationRevealSchema,
  type CorrelationId,
  type ActivityId,
  type FlashcardDeck,
  type CallNinaError,
} from "@call-nina/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { createDesktopSubmissionId, invokeDesktop, normalizeDesktopError } from "./ipc.js";

export function useFlashcardSession(activityId: ActivityId) {
  const [deck, setDeck] = useState<FlashcardDeck>();
  const [flipped, setFlipped] = useState(false);
  const [revealId, setRevealId] = useState<CorrelationId>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [notice, setNotice] = useState(false);
  const locked = useRef(false);
  const version = useRef(0);
  const shortcutKeys = useRef(new Set<string>());
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
  // Capture study keys before button press handlers. Focus can fall back to the
  // document while a pending action disables the button that was clicked.
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (
        !deck ||
        deck.progress.completed ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (!["Space", "ArrowLeft", "ArrowRight"].includes(event.code)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          'input, textarea, select, a, [contenteditable], [role="textbox"], [role="combobox"]',
        )
      )
        return;
      const page = target.closest("[data-activity-id]");
      if (
        target !== document.body &&
        target !== document.documentElement &&
        page?.getAttribute("data-activity-id") !== activityId
      )
        return;
      if (target.closest('button, [role="button"]') && !target.closest("[data-flashcard-controls]"))
        return;
      event.preventDefault();
      event.stopPropagation();
      shortcutKeys.current.add(event.code);
      if (event.repeat || busy || locked.current) return;
      if (event.code === "Space") void flip();
      else if (event.code === "ArrowLeft" && deck.progress.position > 0)
        move(deck.progress.position - 1);
      else if (
        event.code === "ArrowRight" &&
        deck.progress.position < deck.content.cards.length - 1
      )
        move(deck.progress.position + 1);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (!shortcutKeys.current.delete(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
    };
  });
  const card = deck?.content.cards[deck.progress.position];
  const saved = deck?.vocabulary.find((item) => item.position === deck.progress.position);
  return { deck, card, saved, flipped, busy, error, notice, load, move, save, flip, setError };
}
