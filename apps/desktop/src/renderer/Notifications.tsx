import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NotificationProvider } from "./components/ui/index.js";

export function DesktopNotifications({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <NotificationProvider label={t("feedback.notifications")} closeLabel={t("feedback.dismiss")}>
      {children}
    </NotificationProvider>
  );
}
