import type { ReactNode } from "react";
import styles from "./Activity.module.css";

export function ActivityProgress({
  current,
  total,
  label,
  actions,
}: {
  current: number;
  total: number;
  label: string;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.progress}>
      <span>{label}</span>
      <progress value={current} max={Math.max(1, total)} aria-label={label} />
      {actions}
    </div>
  );
}
