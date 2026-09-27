import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextualHelperSelection } from "./ContextualHelper.js";
import { createDesktopSubmissionId } from "./ipc.js";

const excluded = 'input[type="password"], [data-helper-selection="ignore"]';
const contextBlock = "p, li, td, th, blockquote, pre, h1, h2, h3, h4, label, article, section";
const limit = 4_000;

function elementFor(node: Node | null): Element | null {
  return node instanceof Element ? node : (node?.parentElement ?? null);
}

function contextAround(text: string, offset: number): string {
  const start = Math.max(0, offset - 500);
  return text.slice(start, start + limit).trim();
}

/** Keep the last meaningful selection when focus moves to the helper. */
export function useHelperSelection(scope: number) {
  const [stored, setStored] = useState<{
    scope: number;
    value: ContextualHelperSelection | undefined;
  }>({ scope, value: undefined });
  const selection = stored.scope === scope ? stored.value : undefined;

  const session = useRef(createDesktopSubmissionId());
  const publishSelection = useCallback(
    (context: Omit<ContextualHelperSelection, "sessionId"> | undefined) => {
      setStored({ scope, value: context ? { ...context, sessionId: session.current } : undefined });
    },
    [scope],
  );

  useEffect(() => {
    const sessionId = createDesktopSubmissionId();
    session.current = sessionId;

    const capture = () => {
      const active = document.activeElement;
      if (active?.closest(excluded)) return;
      let text: string;
      let context: string;
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
        const start = active.selectionStart;
        const end = active.selectionEnd;
        if (start === null || end === null || start === end) return;
        text = active.value.slice(start, end).trim();
        context = contextAround(active.value, start);
      } else {
        const selected = window.getSelection();
        if (!selected || selected.isCollapsed || selected.rangeCount === 0) return;
        const range = selected.getRangeAt(0);
        const origin = elementFor(range.startContainer);
        const end = elementFor(range.endContainer);
        if (!origin?.isConnected || !end?.isConnected) return;
        if (origin.closest(excluded) || end.closest(excluded)) return;
        // Also reject selections spanning an excluded field.
        if ([...document.querySelectorAll(excluded)].some((node) => range.intersectsNode(node))) {
          return;
        }
        text = selected.toString().trim();
        const block = origin.closest(contextBlock);
        const surrounding = block?.contains(end) ? block.textContent : text;
        context = contextAround(surrounding, Math.max(0, surrounding.indexOf(text)));
      }
      if (!text) return;
      const selectedText = text.slice(0, limit);
      setStored((current) =>
        current.scope === scope &&
        current.value?.selectedText === selectedText &&
        current.value.containingSentence === context
          ? current
          : {
              scope,
              value: {
                sessionId,
                selectedText,
                containingSentence: context || selectedText,
                truncated: text.length > limit,
              },
            },
      );
    };

    document.addEventListener("selectionchange", capture);
    document.addEventListener("select", capture, true);
    document.addEventListener("pointerup", capture);
    document.addEventListener("keyup", capture);
    return () => {
      document.removeEventListener("selectionchange", capture);
      document.removeEventListener("select", capture, true);
      document.removeEventListener("pointerup", capture);
      document.removeEventListener("keyup", capture);
    };
  }, [scope]);

  return [selection, publishSelection] as const;
}
