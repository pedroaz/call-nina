import type { ReactElement, ReactNode, Ref } from "react";
import { LoaderCircle } from "lucide-react";
import {
  Button as AriaButton,
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";

import styles from "./Button.module.css";

export type ControlDensity = "compact" | "comfortable";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export type ButtonProps = Omit<AriaButtonProps, "className" | "children" | "isPending"> &
  Readonly<{
    children: ReactNode;
    ref?: Ref<HTMLButtonElement>;
    className?: string;
    variant?: ButtonVariant;
    density?: ControlDensity;
    isPending?: boolean;
    pendingLabel?: string;
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  }>;

export function Button({
  children,
  className,
  variant,
  density = "comfortable",
  isPending = false,
  pendingLabel,
  leadingIcon,
  trailingIcon,
  isDisabled,
  ...props
}: ButtonProps) {
  const resolvedVariant =
    variant ?? (props["aria-pressed"] !== undefined ? "secondary" : "primary");
  return (
    <AriaButton
      {...props}
      className={`${styles.button} ${styles[resolvedVariant]} ${className ?? ""}`}
      data-density={density}
      data-pending={isPending || undefined}
      aria-busy={isPending || undefined}
      isDisabled={Boolean(isDisabled) || isPending}
    >
      {isPending ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : leadingIcon}
      <span className={styles.content}>{isPending && pendingLabel ? pendingLabel : children}</span>
      {!isPending && trailingIcon}
    </AriaButton>
  );
}

export function IconButton(
  props: Omit<ButtonProps, "children" | "pendingLabel"> & { label: string },
) {
  const { label, className, leadingIcon, trailingIcon, ...buttonProps } = props;
  const icon = leadingIcon ?? trailingIcon;
  return (
    <TooltipTrigger delay={500}>
      <Button
        {...buttonProps}
        aria-label={label}
        className={`${styles.iconButton} ${className ?? ""}`}
        leadingIcon={icon}
      >
        <span className={styles.visuallyHidden}>{label}</span>
      </Button>
      <AriaTooltip className={styles.tooltip}>{label}</AriaTooltip>
    </TooltipTrigger>
  );
}

export function Tooltip(props: { label: string; children: ReactElement }) {
  return (
    <TooltipTrigger delay={500}>
      {props.children}
      <AriaTooltip className={styles.tooltip}>{props.label}</AriaTooltip>
    </TooltipTrigger>
  );
}

export type ActionLinkProps = Omit<AriaLinkProps, "className" | "children"> &
  Readonly<{
    children: ReactNode;
    className?: string;
    variant?: ButtonVariant;
    density?: ControlDensity;
  }>;

export function ActionLink({
  children,
  className,
  variant = "primary",
  density = "comfortable",
  ...props
}: ActionLinkProps) {
  return (
    <AriaLink
      {...props}
      className={`${styles.button} ${styles[variant]} ${className ?? ""}`}
      data-density={density}
    >
      {children}
    </AriaLink>
  );
}
