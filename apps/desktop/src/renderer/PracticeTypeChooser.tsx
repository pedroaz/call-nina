import { useTranslation } from "react-i18next";
import { ActivityChoice } from "./components/ui/index.js";
import { activityIcons, practiceKinds, type PracticeKind } from "./activityPresentation.js";
import styles from "./PracticeComposer.module.css";

export type { PracticeKind } from "./activityPresentation.js";
export function PracticeTypeChooser({
  value,
  onChange,
  onWriting,
  disabled = false,
}: {
  value: PracticeKind;
  onChange: (kind: PracticeKind) => void;
  onWriting?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const WritingIcon = activityIcons.writing;
  return (
    <div
      className={`${styles.choices} ${onWriting ? styles.choicesWithWriting : ""}`}
      role="group"
      aria-label={t("practice.chooser.title")}
    >
      {practiceKinds.map((kind) => {
        const Icon = activityIcons[kind];
        return (
          <ActivityChoice
            key={kind}
            orientation="vertical"
            icon={<Icon aria-hidden="true" />}
            isDisabled={disabled}
            aria-pressed={value === kind}
            onPress={() => {
              onChange(kind);
            }}
          >
            {t(`practice.types.${kind}.title`)}
          </ActivityChoice>
        );
      })}
      {onWriting && (
        <ActivityChoice
          orientation="vertical"
          icon={<WritingIcon aria-hidden="true" />}
          isDisabled={disabled}
          onPress={onWriting}
        >
          {t("practice.freeWriting")}
        </ActivityChoice>
      )}
    </div>
  );
}
