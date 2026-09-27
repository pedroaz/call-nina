import { OperationProgress } from "./OperationProgress.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityId, CallNinaError } from "@call-nina/contracts";
import { Button, Card, Disclosure, FieldGroup } from "./components/ui/index.js";
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
}: {
  exerciseCount: number;
  countValid: boolean;
  targetLevel: "a1" | "a2" | "b1" | "b2";
  onBusyChange: (busy: boolean) => void;
  requestAiAccess: () => Promise<boolean>;
  onOpenActivity: (activityId: ActivityId) => void;
}) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState("");
  const [passage, setPassage] = useState("");
  const generation = useLearningOperation();
  const busy = generation.busy;
  const [source, setSource] = useState<"topic" | "passage">("topic");
  const [error, setError] = useState<CallNinaError>();
  const generate = async (usePassage: boolean) => {
    if (!countValid || !(await requestAiAccess())) return;
    onBusyChange(true);
    setSource(usePassage ? "passage" : "topic");
    setError(undefined);
    try {
      const activityId = await generatePracticeActivity(
        {
          source: "reading",
          exerciseCount,
          targetLevel,
          naturalRequest: topic.trim() || t("practice.readingFlow.defaultRequest"),
          ...(usePassage ? { passage: passage.trim() } : {}),
        },
        generation.run,
      );
      onOpenActivity(activityId);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      onBusyChange(false);
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
          onPress={() => void generate(false)}
        >
          {busy && source === "topic"
            ? t("exercises.custom.generating")
            : t("practice.readingFlow.generate")}
        </Button>
        {busy && source === "topic" && (
          <Button variant="secondary" onPress={generation.cancel}>
            {t("actions.cancel")}
          </Button>
        )}
      </ActionGroup>
      <Disclosure label={t("practice.readingFlow.importLabel")}>
        <FieldGroup>
          {t("practice.readingFlow.importLabel")}
          <textarea
            rows={6}
            maxLength={12_000}
            value={passage}
            disabled={busy}
            onChange={(event) => {
              setPassage(event.target.value);
            }}
          />
        </FieldGroup>
        <ActionGroup>
          <Button
            isDisabled={busy}
            onPress={() => {
              setPassage(t("practice.readingFlow.bundledPassage"));
            }}
          >
            {t("practice.readingFlow.useStarter")}
          </Button>
          <Button
            isDisabled={busy || !countValid || !passage.trim()}
            onPress={() => void generate(true)}
          >
            {busy && source === "passage"
              ? t("exercises.custom.generating")
              : t("practice.readingFlow.useImport")}
          </Button>
          {busy && source === "passage" && (
            <Button variant="secondary" onPress={generation.cancel}>
              {t("actions.cancel")}
            </Button>
          )}
        </ActionGroup>
      </Disclosure>
      <OperationProgress progress={generation.progress} />
      {error && <OperationError error={error} />}
    </Card>
  );
}
