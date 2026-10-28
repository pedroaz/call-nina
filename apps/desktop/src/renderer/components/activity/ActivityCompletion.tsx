import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, ModalDialog, Nina } from "../ui/index.js";
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className={styles.completion}>
      <div className={styles.completion}>
        <header className={styles.completionHeading}>
          {companion && <Nina pose={companion} />}
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
        </header>
        {summary}
        {actions}
        {review && reviewLabel && (
          <Button variant="secondary" onPress={() => setReviewOpen(true)}>
            {reviewLabel}
          </Button>
        )}
      </div>
      {reviewLabel && (
        <ModalDialog
          isOpen={reviewOpen}
          onOpenChange={setReviewOpen}
          size="large"
          title={reviewLabel}
          closeLabel={t("actions.close")}
        >
          <div className={styles.completion}>{review}</div>
        </ModalDialog>
      )}
    </section>
  );
}
