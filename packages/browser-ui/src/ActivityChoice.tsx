import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Button, type ButtonProps } from "./Button.js";
import styles from "./ActivityChoice.module.css";

export function ActivityChoice({
  icon,
  children,
  orientation = "horizontal",
  ...props
}: Omit<ButtonProps, "leadingIcon" | "variant"> & {
  icon: ReactNode;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <Button
      {...props}
      variant="secondary"
      data-orientation={orientation}
      className={`${styles.choice} ${props.className ?? ""}`}
      leadingIcon={<span className={styles.icon}>{icon}</span>}
    >
      {children}
      <span className={styles.selection} aria-hidden="true">
        <Check />
      </span>
    </Button>
  );
}
