import {
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button, IconButton } from "../ui/Button.js";
import { Card } from "../ui/Surface.js";
import styles from "./Layout.module.css";

type PageProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  breadcrumbs?: ReadonlyArray<{ label: string; onPress: () => void }>;
  refresh?: { onRefresh: () => Promise<unknown>; busy?: boolean; disabled?: boolean };
  actions?: ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
  width?: "standard" | "form" | "reading";
};

export function Page({
  actions,
  breadcrumbs,
  refresh,
  children,
  className,
  description,
  eyebrow,
  title,
  width = "standard",
  ...props
}: PageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <section {...props} data-width={width} className={`${styles.page} ${className ?? ""}`}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} current={title} />}
      <header className={`${styles.header} ${styles.stickyHeader}`}>
        <div className={styles.heading}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h1 ref={heading} tabIndex={-1} className={styles.title}>
            {title}
          </h1>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {(actions || refresh) && (
          <ActionGroup>
            {actions}
            {refresh && <RefreshButton {...refresh} />}
          </ActionGroup>
        )}
      </header>
      {children}
    </section>
  );
}

export function Stack(props: { children: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div
      className={`${styles.stack} ${props.compact ? styles.stackCompact : ""} ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  surface = false,
  as: Component = "section",
  className,
  ...attributes
}: Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  surface?: boolean;
  as?: ElementType;
}) {
  const content = (
    <>
      {(title || description || actions) && (
        <header className={styles.sectionHeading}>
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </>
  );
  const classes = `${styles.section} ${className ?? ""}`;
  return surface ? (
    <Card as={Component} {...attributes} className={classes}>
      {content}
    </Card>
  ) : (
    <Component {...attributes} className={classes}>
      {content}
    </Component>
  );
}

export function SectionHeader(props: { children: ReactNode; className?: string }) {
  return (
    <div className={`${styles.sectionHeading} ${props.className ?? ""}`}>{props.children}</div>
  );
}

export function ActionGroup(props: {
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  return (
    <div
      data-align={props.align ?? "start"}
      className={`${styles.actions} ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

export function ContentGrid({
  children,
  columns = 2,
  className,
  fillLast,
  ...props
}: ComponentPropsWithoutRef<"div"> & { columns?: 1 | 2; fillLast?: boolean }) {
  return (
    <div
      {...props}
      className={`${styles.grid} ${columns === 1 ? "" : styles.twoColumns} ${fillLast ? styles.fillLast : ""} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
export const FormGrid = ContentGrid;
type FilterBarProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  label: string;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function FilterBar<T extends ElementType = "div">({
  as,
  children,
  className,
  columns = 3,
  label,
  ...props
}: FilterBarProps<T>) {
  const Component = as ?? "div";
  return (
    <Component
      {...props}
      aria-label={label}
      className={`${styles.filterBar} ${className ?? ""}`}
      data-columns={columns}
    >
      {children}
    </Component>
  );
}

export function Breadcrumbs({
  items,
  current,
}: {
  items: ReadonlyArray<{ label: string; onPress: () => void }>;
  current: string;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("layout.breadcrumbs")} className={styles.breadcrumbs}>
      <ol>
        {items.map((item, index) => (
          <li key={index}>
            <Button variant="quiet" onPress={item.onPress}>
              {item.label}
            </Button>
            <ChevronRight aria-hidden="true" />
          </li>
        ))}
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  );
}

export function RefreshButton({
  onRefresh,
  busy,
  disabled,
}: {
  onRefresh: () => Promise<unknown>;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  return (
    <IconButton
      variant="quiet"
      label={pending || busy ? t("layout.refreshing") : t("layout.refresh")}
      isPending={pending || Boolean(busy)}
      isDisabled={Boolean(disabled)}
      leadingIcon={<RefreshCw aria-hidden="true" />}
      onPress={() => {
        setPending(true);
        void onRefresh().finally(() => {
          setPending(false);
        });
      }}
    />
  );
}
