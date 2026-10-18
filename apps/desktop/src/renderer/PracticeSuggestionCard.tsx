import {
  BookOpen,
  Headphones,
  MessageCircle,
  PencilLine,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { OperationProgress } from "./OperationProgress.js";
import type { OperationProgressState } from "./useOperationProgress.js";
import type { PracticeSuggestion } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Button, Card, Disclosure, Muted } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import styles from "./Dashboard.module.css";

export function PracticeSuggestionCard({
  suggestion,
  recommended = false,
  starting,
  disabled,
  onStart,
  onCancel,
  progress,
}: {
  suggestion: PracticeSuggestion;
  progress?: OperationProgressState | undefined;
  recommended?: boolean;
  starting: boolean;
  disabled: boolean;
  onStart: () => void;
  onCancel?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const action =
    suggestion.source === "due-vocabulary"
      ? "review"
      : suggestion.kind === "writing"
        ? "write"
        : suggestion.kind === "codex-listening" || suggestion.kind === "voice-speaking"
          ? "prepare"
          : "start";
  const Icon =
    suggestion.kind === "writing"
      ? PencilLine
      : suggestion.kind === "reading"
        ? BookOpen
        : suggestion.kind === "codex-listening"
          ? Headphones
          : suggestion.kind === "voice-speaking"
            ? MessageCircle
            : Sparkles;
  return (
    <Card as="article" className={styles.suggestion}>
      <span className={styles.activityIcon} aria-hidden="true">
        <Icon />
      </span>
      <Muted as="p">
        {recommended ? t("suggestions.recommended") : t(`suggestions.sources.${suggestion.source}`)}{" "}
        · {t("suggestions.minutes", { count: suggestion.estimatedMinutes })}
      </Muted>
      <h3>{suggestion.title}</h3>
      <Disclosure label={t("suggestions.fullPrompt")}>
        <p>{suggestion.naturalRequest}</p>
        <Muted as="p">{suggestion.rationale}</Muted>
      </Disclosure>
      <OperationProgress progress={progress} />
      <ActionGroup>
        <Button
          trailingIcon={<ArrowRight aria-hidden="true" />}
          variant={recommended ? "primary" : "secondary"}
          isPending={starting}
          isDisabled={disabled}
          pendingLabel={t("suggestions.starting")}
          onPress={onStart}
        >
          {t(`suggestions.actions.${action}`)}
        </Button>
        {starting && onCancel && (
          <Button variant="secondary" onPress={onCancel}>
            {t("actions.cancel")}
          </Button>
        )}
      </ActionGroup>
    </Card>
  );
}
