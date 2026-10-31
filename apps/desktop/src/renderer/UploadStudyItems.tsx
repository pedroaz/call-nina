import { useTranslation } from "react-i18next";
import type { UploadLearningItem, Language } from "@call-nina/contracts";
import styles from "./UploadsLibrary.module.css";

export function UploadStudyItems({
  items,
  language,
  positions,
  onSelectionChange,
  disabled = false,
  sourceFormat = "website",
}: {
  items: readonly UploadLearningItem[];
  language: Language;
  positions?: number[];
  onSelectionChange?: (positions: number[]) => void;
  disabled?: boolean;
  sourceFormat?: "text" | "website" | "image";
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <section className={styles.proposals}>
      <h3>{t("uploads.studyItems")}</h3>
      {items.map((item, index) => {
        const content = (
          <span className={styles.itemContent}>
            <span>
              <strong lang={language}>{item.lemma}</strong> · {item.meaning}
            </span>
            <span className={styles.meta}>
              {t(
                item.origin === "page"
                  ? sourceFormat === "website"
                    ? "uploads.fromPage"
                    : "uploads.fromContent"
                  : "uploads.aiSuggestion",
              )}
            </span>
            {item.excerpt && <blockquote lang={language}>{item.excerpt}</blockquote>}
            {item.examples.map((example, n) => (
              <div key={n}>
                <p lang={language}>{example.text}</p>
                <p>{example.meaning}</p>
                <span className={styles.meta}>
                  {t(
                    example.origin === "quotation"
                      ? "uploads.quotation"
                      : "uploads.generatedExample",
                  )}
                </span>
              </div>
            ))}
          </span>
        );
        return onSelectionChange && positions ? (
          <label key={index} className={styles.proposal}>
            <input
              type="checkbox"
              checked={positions.includes(index)}
              disabled={disabled}
              onChange={(event) =>
                onSelectionChange(
                  event.target.checked
                    ? [...positions, index]
                    : positions.filter((p) => p !== index),
                )
              }
            />
            {content}
          </label>
        ) : (
          <div key={index} className={styles.proposal}>
            {content}
          </div>
        );
      })}
    </section>
  );
}
