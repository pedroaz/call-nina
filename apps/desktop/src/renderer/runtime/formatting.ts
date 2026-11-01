// Date-only schedules must retain their calendar day in every device timezone.
export function formatInterfaceDate(value: string | undefined, locale: string): string {
  if (!value) return "";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T12:00:00` : value);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
