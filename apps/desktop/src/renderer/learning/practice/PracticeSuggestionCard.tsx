import type { PracticeSuggestion } from "@call-nina/contracts";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionGroup, ContentRow } from "../../components/layout/index.js";
import { Button, Disclosure, Muted } from "../../components/ui/index.js";
import { ActivityVisual } from "../activities/activityPresentation.js";
import { OperationProgress } from "../operations/OperationProgress.js";
import { type OperationProgressState } from "../operations/useOperationProgress.js";

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
      <Muted as="p">
        {recommended ? t("suggestions.recommended") : t(`suggestions.sources.${suggestion.source}`)}
      </Muted>
      <Disclosure variant="inline" label={t("suggestions.fullPrompt")}>
        <p>{suggestion.naturalRequest}</p>
        <Muted as="p">{suggestion.rationale}</Muted>
      </Disclosure>
      <OperationProgress progress={progress} />
    </ContentRow>
  );
}
