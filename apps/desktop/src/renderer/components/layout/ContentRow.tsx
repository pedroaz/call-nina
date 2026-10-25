import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./ContentRow.module.css";
export function ContentRow({
  leading,
  metadata,
  actions,
  children,
  variant = "divided",
  className,
  ...props
}: ComponentPropsWithoutRef<"article"> & {
  leading?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  variant?: "divided" | "bordered";
}) {
  return (
    <article
      {...props}
      data-variant={variant}
      data-leading={Boolean(leading) || undefined}
      className={`${styles.row} ${className ?? ""}`}
    >
      {leading && <div className={styles.leading}>{leading}</div>}
      <div className={styles.content}>
        {children}
        {metadata && <div className={styles.metadata}>{metadata}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </article>
  );
}
