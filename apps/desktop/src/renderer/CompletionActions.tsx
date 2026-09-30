import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  languageSchema,
  type DataRootGeneration,
  type Language,
  type PracticeSuggestion,
} from "@call-nina/contracts";
import { invokeDesktop } from "./ipc.js";
import { Button, Muted } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";

/** Read-only follow-up to the shared player's committed completion. */
export function CompletionActions({
  targetLanguage,
  evidence = "answers",
  rootGeneration,
  parentLabel,
  onReturn,
  onHistory,
  onNina,
}: {
  targetLanguage: Language;
  evidence?: "answers" | "self-assessment";
  rootGeneration: DataRootGeneration;
  parentLabel: string;
  onReturn: () => void;
  onHistory: () => void;
  onNina: () => void;
}) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const [suggestion, setSuggestion] = useState<PracticeSuggestion>();
  const locale = languageSchema.parse(i18n.resolvedLanguage ?? "en-US");
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
    <div>
      <h3 ref={heading} tabIndex={-1}>
        {t("completion.next")}
      </h3>
      <Muted as="p">
        {t(evidence === "answers" ? "completion.evidence" : "completion.selfAssessment")}
      </Muted>
      {suggestion ? (
        <>
          <p>
            <strong>{suggestion.title}</strong>
          </p>
          <p>{suggestion.rationale}</p>
        </>
      ) : (
        <p>{t("completion.nextHint")}</p>
      )}
      <ActionGroup>
        <Button onPress={onNina}>{t("completion.nina")}</Button>
        <Button variant="secondary" onPress={onHistory}>
          {t("nav.history")}
        </Button>
        <Button variant="secondary" onPress={onReturn}>
          {t("completion.return", { origin: parentLabel })}
        </Button>
      </ActionGroup>
    </div>
  );
}
