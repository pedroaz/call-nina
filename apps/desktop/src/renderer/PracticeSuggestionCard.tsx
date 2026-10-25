import { ArrowRight } from "lucide-react";
import { OperationProgress } from "./OperationProgress.js";
import type { OperationProgressState } from "./useOperationProgress.js";
import type { PracticeSuggestion } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Button, Disclosure, Muted } from "./components/ui/index.js";
import { ActionGroup, ContentRow } from "./components/layout/index.js";
import { ActivityVisual } from "./activityPresentation.js";

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
  return (
    <ContentRow
      leading={<ActivityVisual kind={suggestion.kind} />}
      metadata={t("suggestions.minutes", { count: suggestion.estimatedMinutes })}
      actions={
        <ActionGroup>
          <Button
            trailingIcon={<ArrowRight aria-hidden="true" />}
            variant={recommended ? "primary" : "quiet"}
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
      }
    >
      <h3>{suggestion.title}</h3>
      <Disclosure label={t("suggestions.fullPrompt")}>
        <Muted as="p">
          {recommended
            ? t("suggestions.recommended")
            : t(`suggestions.sources.${suggestion.source}`)}
        </Muted>
        <p>{suggestion.naturalRequest}</p>
        <Muted as="p">{suggestion.rationale}</Muted>
      </Disclosure>
      <OperationProgress progress={progress} />
    </ContentRow>
  );
}
