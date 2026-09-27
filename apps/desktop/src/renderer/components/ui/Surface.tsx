import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import styles from "./Surface.module.css";

type CardProps<T extends ElementType> = Readonly<{
  as?: T;
  children: ReactNode;
  className?: string;
  variant?: "default" | "muted";
}> &
  Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

type ElementContentProps<T extends ElementType> = Readonly<{
  as?: T;
  children: ReactNode;
  className?: string;
}> &
  Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function Card<T extends ElementType = "div">({
  as,
  children,
  className,
  variant = "default",
  ...props
}: CardProps<T>) {
  const Component = as ?? "div";
  return (
    <Component
      {...props}
      className={`${styles.card} ${variant === "muted" ? styles.muted : ""} ${className ?? ""}`}
    >
      {children}
    </Component>
  );
}

export function EmptyState(props: Readonly<{ title?: string; children: ReactNode }>) {
  return (
    <Card className={styles.empty}>
      {props.title && <h2>{props.title}</h2>}
      {props.children}
    </Card>
  );
}

export function Muted<T extends ElementType = "p">({
  as,
  children,
  className,
  ...props
}: ElementContentProps<T>) {
  const Component = as ?? "p";
  return (
    <Component {...props} className={`${styles.mutedText} ${className ?? ""}`}>
      {children}
    </Component>
  );
}

export function ItemList(props: ComponentPropsWithoutRef<"ul">) {
  const { className, ...listProps } = props;
  return <ul {...listProps} className={`${styles.itemList} ${className ?? ""}`} />;
}
