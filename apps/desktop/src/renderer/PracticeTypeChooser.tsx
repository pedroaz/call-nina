import { useTranslation } from "react-i18next";
import { ActivityChoice } from "./components/ui/index.js";
import { activityIcons, practiceKinds, type PracticeKind } from "./activityPresentation.js";
import styles from "./PracticeComposer.module.css";

export type { PracticeKind } from "./activityPresentation.js";
export function PracticeTypeChooser({
  value,
  onChange,
  disabled = false,
}: {
  value: PracticeKind;
  onChange: (kind: PracticeKind) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.choices} role="group" aria-label={t("practice.chooser.title")}>
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
    </div>
  );
}
