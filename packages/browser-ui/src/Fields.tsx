import {
  useId,
  type ComponentPropsWithRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import styles from "./Fields.module.css";
import {
  SwitchField as AriaSwitchField,
  SwitchButton,
  type SwitchFieldProps,
} from "react-aria-components";

export function SwitchField({
  children,
  className,
  ...props
}: Omit<SwitchFieldProps, "children" | "className"> & { children: ReactNode; className?: string }) {
  return (
    <AriaSwitchField {...props} className={`${styles.switchField} ${className ?? ""}`}>
      <SwitchButton className={styles.switch}>
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchThumb} />
        </span>
        <span>{children}</span>
      </SwitchButton>
    </AriaSwitchField>
  );
}

type FieldFrameProps = Readonly<{
  id: string;
  label: string;
  description?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  density?: "compact" | "comfortable" | undefined;
}>;

function FieldFrame(props: FieldFrameProps) {
  const descriptionId = props.description ? `${props.id}-description` : undefined;
  const errorId = props.error ? `${props.id}-error` : undefined;
  return (
    <label
      className={`${styles.field} ${props.className ?? ""}`}
      data-density={props.density ?? "comfortable"}
      htmlFor={props.id}
    >
      <span id={`${props.id}-label`}>{props.label}</span>
      {props.children}
      {props.description && (
        <span className={styles.description} id={descriptionId}>
          {props.description}
        </span>
      )}
      {props.error && (
        <span className={styles.error} id={errorId} role="alert">
          {props.error}
        </span>
      )}
    </label>
  );
}

function describedBy(id: string, description?: string, error?: string) {
  return (
    [description ? `${id}-description` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  density?: "compact" | "comfortable" | undefined;
};

export function TextField({
  label,
  description,
  error,
  className,
  density,
  ...inputProps
}: TextFieldProps) {
  const id = useId();
  return (
    <FieldFrame
      className={className}
      density={density}
      description={description}
      error={error}
      id={id}
      label={label}
    >
      <input
        {...inputProps}
        aria-labelledby={inputProps["aria-labelledby"] ?? `${id}-label`}
        aria-describedby={describedBy(id, description, error)}
        aria-invalid={Boolean(error) || undefined}
        className={`${styles.control} ${error ? styles.invalid : ""}`}
        id={id}
      />
    </FieldFrame>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  density?: "compact" | "comfortable" | undefined;
};

export function TextAreaField({
  label,
  description,
  error,
  className,
  density,
  ...textareaProps
}: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldFrame
      className={className}
      density={density}
      description={description}
      error={error}
      id={id}
      label={label}
    >
      <textarea
        {...textareaProps}
        aria-labelledby={textareaProps["aria-labelledby"] ?? `${id}-label`}
        aria-describedby={describedBy(id, description, error)}
        aria-invalid={Boolean(error) || undefined}
        className={`${styles.control} ${error ? styles.invalid : ""}`}
        id={id}
      />
    </FieldFrame>
  );
}

export function SelectControl({ className, ...props }: ComponentPropsWithRef<"select">) {
  return <select {...props} className={`${styles.control} ${styles.select} ${className ?? ""}`} />;
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
  density?: "compact" | "comfortable" | undefined;
};

export function SelectField({
  label,
  description,
  error,
  className,
  density,
  children,
  ...selectProps
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldFrame
      className={className}
      density={density}
      description={description}
      error={error}
      id={id}
      label={label}
    >
      <SelectControl
        {...selectProps}
        aria-labelledby={selectProps["aria-labelledby"] ?? `${id}-label`}
        aria-describedby={describedBy(id, description, error)}
        aria-invalid={Boolean(error) || undefined}
        className={error ? styles.invalid : undefined}
        id={id}
      >
        {children}
      </SelectControl>
    </FieldFrame>
  );
}

export function CheckboxField(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { children: ReactNode },
) {
  const { children, className, ...inputProps } = props;
  return (
    <label className={`${styles.checkbox} ${className ?? ""}`}>
      <input {...inputProps} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}

export function FieldGroup(props: {
  children: ReactNode;
  className?: string;
  density?: "compact" | "comfortable";
}) {
  return (
    <label
      data-density={props.density ?? "comfortable"}
      className={`${styles.field} ${props.className ?? ""}`}
    >
      {props.children}
    </label>
  );
}

export function CheckboxContainer(props: { children: ReactNode; className?: string }) {
  return <label className={`${styles.checkbox} ${props.className ?? ""}`}>{props.children}</label>;
}

export function OptionCard(props: { children: ReactNode; className?: string }) {
  return (
    <label className={`${styles.optionCard} ${props.className ?? ""}`}>{props.children}</label>
  );
}

export function RadioCardGroup(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`${styles.radioGroup} ${props.className ?? ""}`}>
      <legend>{props.label}</legend>
      <div className={styles.optionGrid}>{props.children}</div>
    </fieldset>
  );
}

export function ToggleButtonGroup(props: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-label={props.label}
      className={`${styles.toggleGroup} ${props.className ?? ""}`}
      role="group"
    >
      {props.children}
    </div>
  );
}

export function RadioCard(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { children: ReactNode },
) {
  const { children, className, ...inputProps } = props;
  return (
    <label className={`${styles.optionCard} ${className ?? ""}`}>
      <input {...inputProps} type="radio" />
      <span>{children}</span>
    </label>
  );
}
