import { useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./Disclosure.module.css";

export function Disclosure({
  label,
  children,
  className,
  defaultOpen,
  open,
  onOpenChange,
  onToggle,
  variant = "divided",
  density = "comfortable",
  ...props
}: Omit<ComponentPropsWithRef<"details">, "children"> & {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "plain" | "divided" | "inline";
  density?: "compact" | "comfortable";
}) {
  const [expanded, setExpanded] = useState(defaultOpen ?? false);
  return (
    <details
      open={open ?? expanded}
      onToggle={(event) => {
        if (open === undefined) setExpanded(event.currentTarget.open);
        onToggle?.(event);
        if (event.currentTarget.open !== open) onOpenChange?.(event.currentTarget.open);
      }}
      {...props}
      data-variant={variant}
      data-density={density}
      className={`${styles.disclosure} ${className ?? ""}`}
    >
      <summary
        onClick={(event) => {
          if (open !== undefined) {
            event.preventDefault();
            onOpenChange?.(!open);
          }
        }}
      >
        <ChevronRight className={styles.chevron} aria-hidden="true" />
        <span className={styles.label}>{label}</span>
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  );
}
