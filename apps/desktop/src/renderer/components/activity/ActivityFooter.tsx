import type { ReactNode } from "react";
import styles from "./Activity.module.css";
export function ActivityFooter({
  previous,
  utilities,
  children,
}: {
  previous?: ReactNode;
  utilities?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerLeading}>
        {previous}
        {utilities}
      </div>
      <div className={styles.footerTrailing}>{children}</div>
    </footer>
  );
}
