import type { ReactNode } from "react";
import styles from "./SettingsRow.module.css";

export function SettingsRow({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.row}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <div className={styles.copy}>
        <strong>{title}</strong>
        {children}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
