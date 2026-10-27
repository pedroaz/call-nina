import { useEffect, useRef, type ReactNode } from "react";
import { Disclosure, Nina } from "../ui/index.js";
import styles from "./Activity.module.css";
export function ActivityCompletion({
  title,
  companion,
  summary,
  actions,
  review,
  reviewLabel,
}: {
  title: string;
  companion?: "celebration" | "listening";
  summary?: ReactNode;
  actions?: ReactNode;
  review?: ReactNode;
  reviewLabel?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className={styles.completion}>
      <header className={styles.completionHeading}>
        {companion && <Nina pose={companion} />}
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
      </header>
      {summary}
      {actions}
      {review && reviewLabel && <Disclosure label={reviewLabel}>{review}</Disclosure>}
    </section>
  );
}
