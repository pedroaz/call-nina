import type { ReactNode } from "react";

import { Card } from "./Surface.js";
import styles from "./DiffView.module.css";

export function DiffView(props: {
  mode: "inline" | "side-by-side";
  original: ReactNode;
  corrected: ReactNode;
  originalLabel?: string;
  correctedLabel?: string;
}) {
  if (props.mode === "inline") {
    return (
      <p className={styles.inline}>
        <del>{props.original}</del> <span aria-hidden="true">→</span> <ins>{props.corrected}</ins>
      </p>
    );
  }
  return (
    <div className={styles.grid}>
      <Card as="article">
        <strong>{props.originalLabel}</strong>
        <div>{props.original}</div>
      </Card>
      <Card as="article">
        <strong>{props.correctedLabel}</strong>
        <div>{props.corrected}</div>
      </Card>
    </div>
  );
}
