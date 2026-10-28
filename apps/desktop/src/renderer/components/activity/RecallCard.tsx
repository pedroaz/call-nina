import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Activity.module.css";

export function RecallCard({
  cue,
  answer,
  revealed,
  answerLabel,
  language,
  identity,
}: {
  cue: ReactNode;
  answer: ReactNode;
  revealed: boolean;
  answerLabel: string;
  language?: string;
  identity: string | number;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [identity]);
  useEffect(() => {
    if (revealed) region.current?.focus({ preventScroll: true });
  }, [revealed]);
  return (
    <div className={styles.recall} data-revealed={revealed || undefined}>
      <h2 ref={heading} tabIndex={-1} lang={language}>
        {cue}
      </h2>
      <div
        ref={region}
        hidden={!revealed}
        role="region"
        aria-label={answerLabel}
        tabIndex={-1}
        data-focus-anchor
        className={styles.recallAnswer}
      >
        {revealed ? answer : null}
      </div>
    </div>
  );
}
