import { Image, Plug, Type } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/index.js";
import { useProviderView } from "./useProviderView.js";
import styles from "./SidebarModelControl.module.css";
export function SidebarModelControl({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();
  const view = useProviderView();
  return (
    <section className={styles.navModelPanel} aria-label={t("settings.aiTitle")}>
      <Button
        variant="quiet"
        className={styles.summaryTrigger}
        leadingIcon={<Plug aria-hidden="true" />}
        onPress={onOpenSettings}
      >
        {t("settings.aiTitle")}
      </Button>
      <dl className={styles.assignments}>
        {(["text", "image"] as const).map((capability) => {
          const route = view?.settings.routing[capability];
          const Icon = capability === "text" ? Type : Image;
          return (
            <div className={styles.assignment} key={capability}>
              <Icon className={styles.capabilityIcon} aria-hidden="true" />
              <div className={styles.assignmentText}>
                <dt>{t(`providers.${capability}`)}</dt>
                <dd data-unassigned={!route || undefined}>
                  {!view
                    ? t("settings.loading")
                    : route
                      ? t(`connectionSettings.routes.${route}`)
                      : t("providers.unassigned")}
                </dd>
              </div>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
