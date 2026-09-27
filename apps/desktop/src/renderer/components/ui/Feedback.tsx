import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleAlert, Info } from "lucide-react";

import styles from "./Feedback.module.css";

export type FeedbackTone = "info" | "success" | "warning" | "error";

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: CircleAlert,
  error: AlertCircle,
} as const;

export function Feedback(props: {
  children: ReactNode;
  className?: string;
  tone?: FeedbackTone;
  live: "off" | "polite" | "assertive";
  showIcon?: boolean;
}) {
  const tone = props.tone ?? "info";
  const Icon = icons[tone];
  const live = props.live;
  return (
    <div
      aria-live={live === "off" ? undefined : live}
      className={`${styles.feedback} ${styles[tone]} ${props.className ?? ""}`}
      role={tone === "error" && live === "assertive" ? "alert" : undefined}
    >
      {(props.showIcon ?? tone !== "info") && <Icon aria-hidden="true" />}
      <div>{props.children}</div>
    </div>
  );
}

export function LoadingState(props: { children: ReactNode; live?: boolean }) {
  return (
    <div
      aria-live={props.live ? "polite" : undefined}
      className={`${styles.feedback} ${styles.info}`}
    >
      <span className={styles.loadingDot} aria-hidden="true" />
      <div>{props.children}</div>
    </div>
  );
}

export function DiagnosticCode(props: ComponentPropsWithoutRef<"code">) {
  const { className, ...codeProps } = props;
  return <code {...codeProps} className={`${styles.diagnostic} ${className ?? ""}`} />;
}
