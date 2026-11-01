import {
  languageSchema,
  type DataRootGeneration,
  type Language,
  type PracticeSuggestion,
} from "@call-nina/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "../../components/layout/index.js";
import { Button, Muted } from "../../components/ui/index.js";
import { invokeDesktop } from "../../runtime/ipc.js";
import styles from "./CompletionActions.module.css";

/** Read-only follow-up to the shared player's committed completion. */
export function CompletionActions({
  targetLanguage,
  evidence = "answers",
  rootGeneration,
  parentLabel,
  onReturn,
  onResults,
  onNina,
  onReviewVocabulary,
}: {
  targetLanguage: Language;
  evidence?: "answers" | "self-assessment";
  rootGeneration: DataRootGeneration;
  parentLabel: string;
  onReturn: () => void;
  onResults: () => void;
  onNina: () => void;
  onReviewVocabulary?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [suggestion, setSuggestion] = useState<PracticeSuggestion>();
  const locale = languageSchema.parse(i18n.resolvedLanguage ?? "en-US");
  const reviewVocabulary = suggestion?.source === "due-vocabulary" && onReviewVocabulary;
  useEffect(() => {
    heading.current?.focus();
    let current = true;
    void invokeDesktop("dashboard/read", { locale })
      .then((result) => {
        if (current && result.rootGeneration === rootGeneration)
          setSuggestion(result.suggestions.find((item) => item.targetLanguage === targetLanguage));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [locale, rootGeneration, targetLanguage]);
  return (
    <section className={styles.summary}>
      <h3 ref={heading} tabIndex={-1}>
        {t("completion.next")}
      </h3>
      <Muted as="p">
        {t(evidence === "answers" ? "completion.evidence" : "completion.selfAssessment")}
      </Muted>
      {suggestion ? (
        <div className={styles.suggestion}>
          <p>
            <strong>{suggestion.title}</strong>
          </p>
          <p>{suggestion.rationale}</p>
        </div>
      ) : (
        <p>{t("completion.nextHint")}</p>
      )}
      <ActionGroup className={styles.actions}>
        {reviewVocabulary && (
          <Button variant="primary" onPress={reviewVocabulary}>
            {t("vocabulary.learning.review")}
          </Button>
        )}
        <Button variant={reviewVocabulary ? "secondary" : "primary"} onPress={onReturn}>
          {t("completion.return", { origin: parentLabel })}
        </Button>
        {parentLabel !== t("nav.nina") && (
          <Button variant="secondary" onPress={onNina}>
            {t("nav.nina")}
          </Button>
        )}
        <Button variant="secondary" onPress={onResults}>
          {t("nav.history")}
        </Button>
      </ActionGroup>
    </section>
  );
}
