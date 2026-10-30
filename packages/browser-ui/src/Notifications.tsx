import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X } from "lucide-react";
import {
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from "react-aria-components";
import { IconButton } from "./Button.js";
import styles from "./Notifications.module.css";

export type Notification = Readonly<{
  message: string;
  tone: "success" | "neutral";
  dedupeKey?: string;
}>;

type Notifications = { notify: (notification: Notification) => void };
const NotificationsContext = createContext<Notifications | null>(null);

export function useNotifications(): Notifications {
  const notifications = useContext(NotificationsContext);
  if (!notifications) throw new Error("OD_NOTIFICATIONS_PROVIDER_MISSING");
  return notifications;
}

export function NotificationProvider({
  children,
  label,
  closeLabel,
}: {
  children: ReactNode;
  label: string;
  closeLabel: string;
}) {
  const [queue] = useState(() => new ToastQueue<Notification>({ maxVisibleToasts: 3 }));
  const keys = useRef(new Set<string>());
  const region = useRef<HTMLDivElement>(null);
  const notify = useCallback(
    (notification: Notification) => {
      const key = notification.dedupeKey ?? `${notification.tone}:${notification.message}`;
      if (keys.current.has(key)) return;
      keys.current.add(key);
      queue.add(notification, { timeout: 5000, onClose: () => keys.current.delete(key) });
    },
    [queue],
  );

  useEffect(() => {
    // React Aria handles hover/focus. Include window inactivity, and recheck when
    // a new toast starts its timer while the region is already paused.
    let timer: number | undefined;
    const update = () => {
      const node = region.current;
      // Timer.resume does not clear an already running timer. Pause first so
      // rechecking an active window cannot leave an untracked timeout behind.
      queue.pauseAll();
      if (
        document.hidden ||
        !document.hasFocus() ||
        node?.matches(":hover") ||
        (node && node.contains(document.activeElement))
      )
        return;
      queue.resumeAll();
    };
    const schedule = () => {
      window.clearTimeout(timer);
      // Animation frames may stop in a background window. Recheck after React
      // starts the new toast timer even when the window is inactive.
      timer = window.setTimeout(update, 0);
    };
    const unsubscribe = queue.subscribe(schedule);
    window.addEventListener("blur", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      queue.pauseAll();
      window.removeEventListener("blur", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [queue]);

  return (
    <NotificationsContext.Provider value={{ notify }}>
      {children}
      <ToastRegion ref={region} queue={queue} aria-label={label} className={styles.region}>
        {({ toast }) => (
          <AriaToast toast={toast} className={styles.toast} data-tone={toast.content.tone}>
            <ToastContent role="status" aria-live="polite" className={styles.content}>
              {toast.content.tone === "success" ? (
                <CheckCircle2 aria-hidden="true" />
              ) : (
                <Info aria-hidden="true" />
              )}
              <Text slot="title">{toast.content.message}</Text>
            </ToastContent>
            <IconButton
              slot="close"
              variant="quiet"
              density="compact"
              label={closeLabel}
              leadingIcon={<X aria-hidden="true" />}
            />
          </AriaToast>
        )}
      </ToastRegion>
    </NotificationsContext.Provider>
  );
}
