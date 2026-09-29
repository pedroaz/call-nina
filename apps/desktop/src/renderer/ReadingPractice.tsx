import { MaterialPractice, type MaterialPracticeState } from "./MaterialPractice.js";
import type { ProviderOperation, ActivityId, CallNinaError } from "@call-nina/contracts";
import { OperationProgress } from "./OperationProgress.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, FieldGroup } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { OperationError } from "./Startup.js";
import { normalizeDesktopError } from "./ipc.js";
import { generatePracticeActivity } from "./generatePracticeActivity.js";

export function ReadingPractice({
  exerciseCount,
  countValid,
  targetLevel,
  onBusyChange,
  requestAiAccess,
  onOpenActivity,
  topic,
  setTopic,
  materialState,
  setMaterialState,
}: {
  exerciseCount: number;
  countValid: boolean;
  targetLevel: "a1" | "a2" | "b1" | "b2";
  onBusyChange: (busy: boolean) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onOpenActivity: (activityId: ActivityId) => void;
  topic: string;
  setTopic: (topic: string) => void;
  materialState: MaterialPracticeState;
  setMaterialState: Dispatch<SetStateAction<MaterialPracticeState>>;
}) {
  const { t } = useTranslation();
  const [materialBusy, setMaterialBusy] = useState(false);
  const generation = useLearningOperation();
  const busy = generation.busy || materialBusy;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  const [error, setError] = useState<CallNinaError>();
  const generate = async () => {
    if (!countValid || !(await requestAiAccess("exercise-generation"))) return;
    setError(undefined);
    try {
      const activityId = await generatePracticeActivity(
        {
          source: "reading",
          exerciseCount,
          targetLevel,
          naturalRequest: topic.trim() || t("practice.readingFlow.defaultRequest"),
        },
        generation.run,
      );
      onOpenActivity(activityId);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    }
  };
  return (
    <Card as="article">
      <h2>{t("practice.readingFlow.title")}</h2>

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
      <ActionGroup>
        <Button
          isDisabled={busy}
          onPress={() => {
            setTopic(t("practice.readingFlow.defaultRequest"));
          }}
        >
          {t("practice.useExample")}
        </Button>
        <Button
          variant="primary"
          isDisabled={busy || !countValid || !topic.trim()}
          onPress={() => void generate()}
        >
          {generation.busy ? t("exercises.custom.generating") : t("practice.readingFlow.generate")}
        </Button>
        {generation.busy && (
          <Button variant="secondary" onPress={generation.cancel}>
            {t("actions.cancel")}
          </Button>
        )}
      </ActionGroup>
      <MaterialPractice
        state={materialState}
        setState={setMaterialState}
        practiceType="reading"
        targetLevel={targetLevel}
        exerciseCount={exerciseCount}
        countValid={countValid}
        disabled={generation.busy}
        onBusyChange={setMaterialBusy}
        requestAiAccess={requestAiAccess}
        onOpenActivity={onOpenActivity}
      />
      <OperationProgress progress={generation.progress} />
      {error && <OperationError error={error} />}
    </Card>
  );
}
