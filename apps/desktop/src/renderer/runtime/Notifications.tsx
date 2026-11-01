import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { I18nProvider, NotificationProvider } from "../components/ui/index.js";

export function DesktopNotifications({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <I18nProvider locale={i18n.language}>
      <NotificationProvider
        label={t("feedback.notifications")}
        closeLabel={t("feedback.dismiss")}
        renderMessage={(key, values) => t(key, values ?? {})}
      >
        {children}
      </NotificationProvider>
    </I18nProvider>
  );
}
