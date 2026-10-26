import {
  createContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Page } from "../layout/index.js";
import styles from "./Activity.module.css";

export const ActivityLayoutContext = createContext(false);

/** Route-independent page chrome; feature controllers retain all learning state. */
export function ActivityWorkspace(props: ComponentProps<typeof Page>) {
  return <Page {...props} presentation="activity" />;
}

export function ActivityFrame({
  progress,
  reference,
  feedback,
  footer,
  children,
  taskLabel,
}: {
  progress?: ReactNode;
  reference?: ReactNode;
  feedback?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  taskLabel: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const page = element.closest('[data-presentation="activity"]');
    if (!page) return;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const top = element.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - 2 * rem;
      const chrome = (header.current?.offsetHeight ?? 0) + (actions.current?.offsetHeight ?? 0);
      const next =
        page.clientWidth >= 64 * rem && available - chrome >= 28 * rem
          ? Math.floor(available)
          : undefined;
      setHeight((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    if (header.current) observer.observe(header.current);
    if (actions.current) observer.observe(actions.current);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <ActivityLayoutContext.Provider value={height !== undefined}>
      <div
        ref={frame}
        className={styles.frame}
        data-bounded={height !== undefined || undefined}
        data-reference={Boolean(reference) || undefined}
        style={height === undefined ? undefined : { height }}
      >
        <div ref={header} className={styles.progressSlot}>
          {progress}
        </div>
        <div className={styles.body}>
          {reference && <aside className={styles.reference}>{reference}</aside>}
          <section
            className={styles.task}
            data-activity-task
            aria-label={taskLabel}
            tabIndex={height === undefined ? undefined : 0}
          >
            {children}
            {feedback && <div className={styles.feedback}>{feedback}</div>}
          </section>
        </div>
        <div ref={actions} className={styles.footerSlot}>
          {footer}
        </div>
      </div>
    </ActivityLayoutContext.Provider>
  );
}
