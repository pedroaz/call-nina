import type { ReactNode } from "react";
import styles from "./SettingsRow.module.css";
import { ChevronRight } from "lucide-react";
import { Button, type ButtonProps } from "./components/ui/index.js";

export function SettingsLink({
  leadingIcon,
  children,
  ...props
}: Omit<ButtonProps, "variant" | "className" | "trailingIcon">) {
  return (
    <Button
      {...props}
      variant="quiet"
      className={styles.link}
      leadingIcon={leadingIcon && <span className={styles.icon}>{leadingIcon}</span>}
      trailingIcon={<ChevronRight aria-hidden="true" />}
    >
      <span className={styles.linkLabel}>{children}</span>
    </Button>
  );
}

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
