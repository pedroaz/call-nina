import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "../../components/ui/index.js";
import styles from "./PracticeComposer.module.css";
import { PracticeTypeChooser, type PracticeKind } from "./PracticeTypeChooser.js";

export function PracticeComposer({
  topic,
  kind,
  onTopicChange,
  onKindChange,
  onWriting,
  disabled = false,
  sourceControl,
}: {
  sourceControl?: ReactNode;
  topic: string;
  kind: PracticeKind;
  onTopicChange: (topic: string) => void;
  onKindChange: (kind: PracticeKind) => void;
  onWriting?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.composer}>
      {onWriting && (
        <PracticeTypeChooser
          value={kind}
          onChange={onKindChange}
          onWriting={onWriting}
          disabled={disabled}
        />
      )}
      <TextField
        label={t("ui.topic")}
        placeholder={t("ninaHome.placeholder")}
        value={topic}
        maxLength={2000}
        disabled={disabled}
        onChange={(event) => {
          onTopicChange(event.target.value);
        }}
      />
      {sourceControl}
      {!onWriting && (
        <PracticeTypeChooser value={kind} onChange={onKindChange} disabled={disabled} />
      )}
    </div>
  );
}
