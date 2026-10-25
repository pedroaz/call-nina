import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./Disclosure.module.css";

export function Disclosure({
  label,
  children,
  className,
  defaultOpen,
  variant = "divided",
  density = "comfortable",
  ...props
}: Omit<ComponentPropsWithRef<"details">, "children"> & {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  variant?: "plain" | "divided";
  density?: "compact" | "comfortable";
}) {
  return (
    <details
      {...(defaultOpen === undefined ? {} : { open: defaultOpen })}
      {...props}
      data-variant={variant}
      data-density={density}
      className={`${styles.disclosure} ${className ?? ""}`}
    >
      <summary>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
        <span className={styles.label}>{label}</span>
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  );
}
