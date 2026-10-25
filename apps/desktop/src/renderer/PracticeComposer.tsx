import { useTranslation } from "react-i18next";
import { TextField } from "./components/ui/index.js";
import { PracticeTypeChooser, type PracticeKind } from "./PracticeTypeChooser.js";
import styles from "./PracticeComposer.module.css";
export function PracticeComposer({
  topic,
  kind,
  onTopicChange,
  onKindChange,
  disabled = false,
}: {
  topic: string;
  kind: PracticeKind;
  onTopicChange: (topic: string) => void;
  onKindChange: (kind: PracticeKind) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.composer}>
      <TextField
        label={t("ui.topic")}
        placeholder={t("ninaHome.placeholder")}
        value={topic}
        maxLength={2000}
        disabled={disabled}
        onChange={(event) => onTopicChange(event.target.value)}
      />
      <PracticeTypeChooser value={kind} onChange={onKindChange} disabled={disabled} />
    </div>
  );
}
