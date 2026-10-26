import { useEffect, useRef, type ReactNode } from "react";
import { Disclosure } from "../ui/index.js";
import styles from "./Activity.module.css";
export function ActivityCompletion({
  title,
  summary,
  actions,
  review,
  reviewLabel,
}: {
  title: string;
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
      <h2 ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {summary}
      {actions}
      {review && reviewLabel && <Disclosure label={reviewLabel}>{review}</Disclosure>}
    </section>
  );
}
