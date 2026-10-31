import type {
  ActivityId,
  CallNinaError,
  PracticeSource,
  ProviderOperation,
} from "@call-nina/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup, Section } from "../../components/layout/index.js";
import { Button, FieldGroup } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { normalizeDesktopError } from "../../runtime/ipc.js";
import { OperationProgress } from "../operations/OperationProgress.js";
import { useLearningOperation } from "../operations/useLearningOperation.js";
import { startTopicPractice } from "../practice/startTopicPractice.js";
import { ProviderActionSummary } from "../providers/ProviderActionSummary.js";

export function ReadingPractice({
  settings,
  hideTopic = false,
  exerciseCount,
  countValid,
  targetLevel,
  onBusyChange,
  requestAiAccess,
  onOpenActivity,
  topic,
  setTopic,
  practiceSource,
}: {
  settings?: ReactNode;
  hideTopic?: boolean;
  exerciseCount: number;
  countValid: boolean;
  targetLevel: "a1" | "a2" | "b1" | "b2";
  onBusyChange: (busy: boolean) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onOpenActivity: (activityId: ActivityId) => void;
  topic: string;
  setTopic: (topic: string) => void;
  practiceSource?: PracticeSource | undefined;
}) {
  const { t } = useTranslation();
  const generation = useLearningOperation();
  const busy = generation.busy;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  const [error, setError] = useState<CallNinaError>();
  const generate = async () => {
    if (!countValid || !(await requestAiAccess("exercise-generation"))) return;
    setError(undefined);
    try {
      const activityId = await startTopicPractice(
        {
          kind: "reading",
          practiceSource,
          count: exerciseCount,
          targetLevel,
          topic: topic.trim() || t("practice.readingFlow.defaultRequest"),
        },
        generation.run,
      );
      onOpenActivity(activityId);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    }
  };
  return (
    <Section as="article">
      {!hideTopic && (
        <FieldGroup>
          {t("practice.promptLabel")}
          <textarea
            rows={3}
            maxLength={2_000}
            value={topic}
            disabled={busy}
            placeholder={t("practice.readingPromptPlaceholder")}
            onChange={(event) => {
              setTopic(event.target.value);
            }}
          />
        </FieldGroup>
      )}
      {settings}
      <ProviderActionSummary operation="exercise-generation" busy={generation.busy} />
      <ActionGroup>
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={() => {
            setTopic(t("practice.readingFlow.defaultRequest"));
          }}
        >
          {t("practice.useExample")}
        </Button>
        <Button variant="primary" isDisabled={busy || !countValid} onPress={() => void generate()}>
          {generation.busy ? t("exercises.custom.generating") : t("practice.readingFlow.generate")}
        </Button>
        {generation.busy && (
          <Button variant="secondary" onPress={generation.cancel}>
            {t("actions.cancel")}
          </Button>
        )}
      </ActionGroup>

      <OperationProgress progress={generation.progress} />
      {error && <OperationError error={error} />}
    </Section>
  );
}
