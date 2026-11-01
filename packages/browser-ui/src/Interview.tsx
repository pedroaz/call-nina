import { useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import styles from "./Interview.module.css";

/** Presentation only: each application owns its answers, steps and side effects. */
export function InterviewLayout({
  title,
  description,
  progress,
  toolbar,
  artwork,
  context,
  children,
  actions,
  focusKey,
  headingLevel = 1,
  onContinue,
  continueDisabled = false,
}: {
  title: string;
  description?: string | undefined;
  progress: ReactNode;
  toolbar: ReactNode;
  artwork?: ReactNode;
  context?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  focusKey: string | number;
  headingLevel?: 1 | 2 | 3;
  onContinue?: (() => void) | undefined;
  continueDisabled?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const question = useRef<HTMLElement>(null);
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  useLayoutEffect(() => {
    // Reset only the interview's scroll panes. Focusing must not move the window or modal.
    if (content.current) content.current.scrollTop = 0;
    if (question.current) question.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [focusKey]);
  return (
    <div
      role="presentation"
      className={styles.interview}
      onKeyDown={(event) => {
        if (
          !onContinue ||
          event.key !== "Enter" ||
          event.nativeEvent.isComposing ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const target = event.target;
        // Portaled setup dialogs and controls with their own Enter action keep native behavior.
        if (
          !(target instanceof HTMLElement) ||
          !event.currentTarget.contains(target) ||
          target.closest("button, a, select, summary, [role='button'], [contenteditable='true']")
        )
          return;
        event.preventDefault();
        if (!continueDisabled && !event.repeat) onContinue();
      }}
    >
      <div className={styles.toolbar}>{toolbar}</div>
      <div className={styles.layout}>
        <div className={styles.content} ref={content}>
          <section className={styles.question} ref={question}>
            {progress}
            <div className={styles.heading}>
              <Heading ref={heading} tabIndex={-1} data-focus-anchor>
                {title}
              </Heading>
              {description && <p>{description}</p>}
            </div>
            <div className={styles.answers}>{children}</div>
          </section>
          <aside className={styles.context}>
            {artwork && <div className={styles.artwork}>{artwork}</div>}
            {context && <div className={styles.contextContent}>{context}</div>}
          </aside>
        </div>
        <footer className={styles.actions}>{actions}</footer>
      </div>
    </div>
  );
}

export function InterviewProgress({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) {
  return (
    <div className={styles.progress}>
      <div
        className={styles.segments}
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={label}
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-complete={i < current} />
        ))}
      </div>
      <span>{label}</span>
    </div>
  );
}

export type InterviewOption = {
  value: string;
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export function InterviewChoices({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string | undefined;
  options: readonly InterviewOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={styles.choices} disabled={disabled}>
      <legend className={styles.srOnly}>{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={styles.choice}
          data-selected={value === option.value}
          data-disabled={disabled || option.disabled || undefined}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => {
              onChange(option.value);
            }}
          />
          {option.icon && (
            <span className={styles.icon} aria-hidden="true">
              {option.icon}
            </span>
          )}
          <div className={styles.choiceText}>
            <span>{option.label}</span>
            {option.description && <div className={styles.description}>{option.description}</div>}
          </div>
          <Check className={styles.check} aria-hidden="true" />
        </label>
      ))}
    </fieldset>
  );
}
