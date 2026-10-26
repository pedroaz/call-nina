import type { ComponentProps, ReactNode } from "react";
import { Feedback, Disclosure } from "../ui/index.js";
import styles from "./Activity.module.css";
export function ActivityFeedback({
  children,
  details,
  detailsLabel,
  ...props
}: ComponentProps<typeof Feedback> & {
  details?: ReactNode;
  detailsLabel?: string;
}) {
  return (
    <div className={styles.feedback}>
      <Feedback {...props}>{children}</Feedback>
      {details && detailsLabel && (
        <Disclosure density="compact" label={detailsLabel}>
          {details}
        </Disclosure>
      )}
    </div>
  );
}
