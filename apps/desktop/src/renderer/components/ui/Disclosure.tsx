import { useState, type ReactNode } from "react";

import styles from "./Disclosure.module.css";

export function Disclosure(props: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <details
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      className={`${styles.disclosure} ${props.className ?? ""}`}
    >
      <summary>{props.label}</summary>
      <div className={styles.content}>{props.children}</div>
    </details>
  );
}
