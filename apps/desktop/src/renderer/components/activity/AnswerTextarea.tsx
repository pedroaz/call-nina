import { useLayoutEffect, useRef, type ComponentProps } from "react";
/** Small answers start compact; content remains scrollable after eight lines. */
export function AnswerTextarea({ rows = 2, value, ...props }: ComponentProps<"textarea">) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [value]);
  return <textarea {...props} ref={field} rows={rows} value={value} />;
}
