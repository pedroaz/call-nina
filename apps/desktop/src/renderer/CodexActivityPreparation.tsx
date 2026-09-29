import {
  type ProviderOperation,
  type LearningScope,
  voiceActivityContextSchema,
  voiceActivityDraftCandidateSchema,
  type ActivityId,
  type VoiceActivityContext,
  type CallNinaError,
} from "@call-nina/contracts";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Disclosure, Feedback, FieldGroup, InfoHint } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { OperationProgress } from "./OperationProgress.js";
import { useLearningOperation } from "./useLearningOperation.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import styles from "./PracticePage.module.css";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function CodexActivityPreparation({
  kind,
  initialScenario,
  targetLevel,
  onBusyChange,
  requestAiAccess,
  onOpenActivity,
}: {
  kind: "listening" | "speaking";
  initialScenario?: string;
  targetLevel: VoiceActivityContext["targetLevel"];
  onBusyChange: (busy: boolean) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onOpenActivity: (id: ActivityId) => void;
}) {
  const { t } = useTranslation();
  const base = kind === "listening" ? "practice.listeningFlow" : "practice.speakingFlow";
  const [request, setRequest] = useState(initialScenario ?? "");
  const [scenario, setScenario] = useState("");
  const [difficulty, setDifficulty] = useState<VoiceActivityContext["difficulty"]>("intermediate");
  const [correctionTiming, setCorrectionTiming] =
    useState<VoiceActivityContext["correctionTiming"]>("after-each");
  const [speakingPace, setSpeakingPace] = useState<"slow" | "normal" | "fast">("normal");
  const [objectives, setObjectives] = useState("");
  const [questions, setQuestions] = useState("");
  const [script, setScript] = useState("");
  const [guidance, setGuidance] = useState("");
  const [learningScope, setLearningScope] = useState<LearningScope>();
  const [hasDraft, setHasDraft] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const draft = useLearningOperation();
  const context = useMemo(
    () => ({
      schemaVersion: 1 as const,
      kind,
      targetLevel,
      scenario: scenario.trim(),
      difficulty,
      correctionTiming,
      ...(kind === "speaking" ? { speakingPace } : {}),
      objectives: lines(objectives),
      ...(kind === "listening" && script.trim() ? { script: script.trim() } : {}),
      questions: lines(questions),
      answerGuidance: lines(guidance),
    }),
    [
      kind,
      targetLevel,
      scenario,
      difficulty,
      correctionTiming,
      speakingPace,
      objectives,
      script,
      questions,
      guidance,
    ],
  );
  const valid = voiceActivityContextSchema.safeParse(context).success;

  const generateDraft = async () => {
    if (!request.trim() || !(await requestAiAccess("voice-activity-draft"))) return;
    onBusyChange(true);
    setError(undefined);
    try {
      const result = await draft.run({
        kind: "voice-activity-draft",
        voiceKind: kind,
        naturalRequest: request.trim(),
        targetLevel,
        difficulty,
        correctionTiming,
        ...(kind === "speaking" ? { speakingPace } : {}),
      });
      if (result.status !== "validated" || !result.learningScope)
        throw new Error("OD_LEARNING_CONTEXT_REQUIRED");
      const output = voiceActivityDraftCandidateSchema.parse(result.output);
      setLearningScope(result.learningScope);
      setScenario(output.scenario);
      setObjectives(output.objectives.join("\n"));
      setQuestions(output.questions.join("\n"));
      setGuidance(output.answerGuidance.join("\n"));
      setScript(output.script ?? "");
      setHasDraft(true);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      onBusyChange(false);
    }
  };
  const prepare = async () => {
    if (!valid || !learningScope) return;
    onBusyChange(true);
    setPreparing(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("codex-activity/prepare", {
        learningScope,
        title: scenario.trim().slice(0, 160),
        context: voiceActivityContextSchema.parse(context),
      });
      onOpenActivity(result.activityId);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setPreparing(false);
      onBusyChange(false);
    }
  };

  return (
    <Card
      as="article"
      className={styles.voicePreparation}
      data-testid={`codex-${kind}-preparation`}
    >
      <div className={styles.voiceHeader}>
        <h2>{t(`${base}.title`)}</h2>
        <InfoHint label={t(`${base}.title`)}>{t(`${base}.body`)}</InfoHint>
      </div>
      <FieldGroup>
        {t("practice.promptLabel")}
        <textarea
          rows={3}
          maxLength={2_000}
          value={request}
          disabled={draft.busy || preparing}
          placeholder={t(`${base}.promptPlaceholder`)}
          onChange={(event) => {
            setRequest(event.target.value);
          }}
        />
      </FieldGroup>
      <div className={styles.voiceSettingsGrid}>
        <FieldGroup>
          {t(`${base}.difficultyLabel`)}
          <select
            value={difficulty}
            disabled={draft.busy || preparing}
            onChange={(event) => {
              setDifficulty(event.target.value as VoiceActivityContext["difficulty"]);
            }}
          >
            {(["beginner", "intermediate", "advanced"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`${base}.difficultyOptions.${value}`)}
              </option>
            ))}
          </select>
        </FieldGroup>
        <FieldGroup>
          {t(`${base}.correctionTimingLabel`)}
          <select
            value={correctionTiming}
            disabled={draft.busy || preparing}
            onChange={(event) => {
              setCorrectionTiming(event.target.value as VoiceActivityContext["correctionTiming"]);
            }}
          >
            {(["during", "after-each", "end"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`${base}.correctionOptions.${value}`)}
              </option>
            ))}
          </select>
        </FieldGroup>
        {kind === "speaking" && (
          <FieldGroup>
            {t("practice.speakingPace")}
            <select
              value={speakingPace}
              disabled={draft.busy || preparing}
              onChange={(event) => {
                setSpeakingPace(event.target.value as typeof speakingPace);
              }}
            >
              {(["slow", "normal", "fast"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`practice.paceOptions.${value}`)}
                </option>
              ))}
            </select>
          </FieldGroup>
        )}
      </div>
      <ActionGroup>
        <Button
          variant="secondary"
          isDisabled={draft.busy || preparing}
          onPress={() => {
            setRequest(t(`${base}.scenario`));
          }}
        >
          {t("practice.useExample")}
        </Button>
        <Button
          variant="primary"
          isDisabled={!request.trim() || preparing}
          isPending={draft.busy}
          pendingLabel={t("practice.drafting")}
          onPress={() => void generateDraft()}
        >
          {t(hasDraft ? "practice.regenerateDetails" : "practice.generateDetails")}
        </Button>
        {draft.busy && <Button onPress={draft.cancel}>{t("actions.cancel")}</Button>}
      </ActionGroup>
      <OperationProgress progress={draft.progress} />
      <Disclosure
        key={hasDraft ? "draft" : "empty"}
        defaultOpen={hasDraft}
        label={t("practice.editDetails")}
      >
        <div className={styles.voiceSetupGrid}>
          <FieldGroup className={styles.voiceScenarioField}>
            {t(`${base}.scenarioLabel`)}
            <input
              maxLength={240}
              value={scenario}
              onChange={(event) => {
                setScenario(event.target.value);
              }}
            />
          </FieldGroup>
          <FieldGroup>
            {t(`${base}.objectives`)}
            <textarea
              maxLength={4_000}
              value={objectives}
              onChange={(event) => {
                setObjectives(event.target.value);
              }}
            />
            <small>{t(`${base}.onePerLine`)}</small>
          </FieldGroup>
          <FieldGroup>
            {t(`${base}.questions`)}
            <textarea
              maxLength={4_000}
              value={questions}
              onChange={(event) => {
                setQuestions(event.target.value);
              }}
            />
            <small>{t(`${base}.onePerLine`)}</small>
          </FieldGroup>
          {kind === "listening" && (
            <FieldGroup>
              {t(`${base}.scriptLabel`)}
              <textarea
                rows={4}
                maxLength={2_400}
                value={script}
                onChange={(event) => {
                  setScript(event.target.value);
                }}
              />
            </FieldGroup>
          )}
          <FieldGroup>
            {t(`${base}.guidance`)}
            <textarea
              rows={3}
              maxLength={4_000}
              value={guidance}
              onChange={(event) => {
                setGuidance(event.target.value);
              }}
            />
            <small>{t(`${base}.onePerLine`)}</small>
          </FieldGroup>
        </div>
      </Disclosure>
      {error && (
        <Feedback live="assertive" tone="error">
          {t(error.messageKey)}
        </Feedback>
      )}
      <div className={styles.voiceFooter}>
        <span>{t("practice.voiceContentNotice")}</span>
        <Button
          variant="primary"
          isDisabled={!valid || draft.busy}
          isPending={preparing}
          pendingLabel={t(`${base}.preparing`)}
          onPress={() => void prepare()}
        >
          {t(`${base}.prepare`)}
        </Button>
      </div>
    </Card>
  );
}
