import styles from "./PracticePage.module.css";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  placementResultSchema,
  type LearningScope,
  type CallNinaError,
} from "@call-nina/contracts";
import { Button, Card, Feedback, FieldGroup, ItemList } from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";

export function PlacementDiagnostic() {
  const { t } = useTranslation();
  const [learningScope, setLearningScope] = useState<LearningScope>();
  const [started, setStarted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [answers, setAnswers] = useState({ grammar: "", vocabulary: "", reading: "" });
  const [completed, setCompleted] = useState<ReturnType<typeof placementResultSchema.parse>>();

  const complete = async () => {
    if (!learningScope) return;
    const result = placementResultSchema.parse({
      learningScope,
      schemaVersion: 1,
      completedOn: new Date().toISOString().slice(0, 10),
      estimatedLevel: null,
      uncertainty: {
        level: "some",
        explanation: t("practice.diagnosticFlow.limitedEvidence"),
      },
      sampleResults: [
        {
          kind: "grammar",
          topic: t("practice.diagnosticFlow.grammarTopic"),
          outcome: answers.grammar === "zum" ? "demonstrated" : "developing",
          evidence: t("practice.diagnosticFlow.grammarEvidence"),
          uncertainty: {
            level: "some",
            explanation: t("practice.diagnosticFlow.sampleUncertainty"),
          },
        },
        {
          kind: "vocabulary",
          topic: t("practice.diagnosticFlow.vocabularyTopic"),
          outcome: answers.vocabulary === "appointment" ? "demonstrated" : "developing",
          evidence: t("practice.diagnosticFlow.vocabularyEvidence"),
          uncertainty: {
            level: "some",
            explanation: t("practice.diagnosticFlow.sampleUncertainty"),
          },
        },
        {
          kind: "reading",
          topic: t("practice.diagnosticFlow.readingTopic"),
          outcome: answers.reading === "10" ? "demonstrated" : "developing",
          evidence: t("practice.diagnosticFlow.readingEvidence"),
          uncertainty: {
            level: "some",
            explanation: t("practice.diagnosticFlow.sampleUncertainty"),
          },
        },
        {
          kind: "writing",
          topic: t("practice.diagnosticFlow.writingTopic"),
          outcome: "not-assessed",
          evidence: t("practice.diagnosticFlow.writingNotAssessed"),
          uncertainty: {
            level: "substantial",
            explanation: t("practice.diagnosticFlow.writingNotAssessed"),
          },
        },
      ],
      voiceCalibration: {
        status: "unavailable",
        code: "OD_HANDOFF_VOICE_SESSION_UNSUPPORTED",
        explanation: t("practice.diagnosticFlow.voiceUnavailable"),
      },
    });
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("placement/complete", { result });
      setCompleted(result);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };

  if (completed) {
    return (
      <Card as="article">
        <h2>{t("practice.diagnosticFlow.completedTitle")}</h2>
        <p>{t("practice.diagnosticFlow.completedBody")}</p>
        <Feedback live="off" tone="warning">
          {completed.uncertainty.level === "none"
            ? t("practice.diagnosticFlow.noAdditionalUncertainty")
            : completed.uncertainty.explanation}
        </Feedback>
        <ItemList>
          {completed.sampleResults.map((sample) => (
            <li key={sample.kind}>
              <strong>{sample.topic}</strong>:{" "}
              {t(`practice.diagnosticFlow.outcomes.${sample.outcome}`)} — {sample.evidence}
            </li>
          ))}
        </ItemList>
        <Feedback live="off" tone="warning">
          {completed.voiceCalibration.explanation}
        </Feedback>
      </Card>
    );
  }

  return (
    <Card as="article">
      <h2>{t("practice.diagnosticFlow.title")}</h2>
      <p>{t("practice.diagnosticFlow.body")}</p>
      {skipped && <Feedback live="off">{t("practice.diagnosticFlow.skipped")}</Feedback>}
      {!started && !skipped ? (
        <ActionGroup>
          <Button
            variant="primary"
            onPress={() => {
              void invokeDesktop("learner-settings/read", {})
                .then((settings) => {
                  if (settings.settings.learningScope.targetLanguage !== "de")
                    throw new Error("OD_LANGUAGE_POLICY_UNAVAILABLE");
                  setLearningScope(settings.settings.learningScope);
                  setStarted(true);
                })
                .catch((cause: unknown) => {
                  setError(normalizeDesktopError(cause).detail);
                });
            }}
          >
            {t("practice.diagnosticFlow.start")}
          </Button>
          <Button
            onPress={() => {
              setSkipped(true);
            }}
          >
            {t("practice.diagnosticFlow.skip")}
          </Button>
        </ActionGroup>
      ) : null}
      {started && !skipped ? (
        <div className={styles.historyDetail}>
          <FieldGroup>
            {t("practice.diagnosticFlow.grammar")}
            <select
              aria-label={t("practice.diagnosticFlow.grammar")}
              value={answers.grammar}
              onChange={(event) => {
                setAnswers((current) => ({ ...current, grammar: event.target.value }));
              }}
            >
              <option value="">{t("practice.diagnosticFlow.choose")}</option>
              <option value="zum">zum</option>
              <option value="zu den">zu den</option>
            </select>
          </FieldGroup>
          <FieldGroup>
            {t("practice.diagnosticFlow.vocabulary")}
            <select
              aria-label={t("practice.diagnosticFlow.vocabulary")}
              value={answers.vocabulary}
              onChange={(event) => {
                setAnswers((current) => ({ ...current, vocabulary: event.target.value }));
              }}
            >
              <option value="">{t("practice.diagnosticFlow.choose")}</option>
              <option value="appointment">appointment</option>
              <option value="neighborhood">neighborhood</option>
            </select>
          </FieldGroup>
          <section>
            <h3>{t("practice.diagnosticFlow.reading")}</h3>
            <p>{t("practice.diagnosticFlow.readingText")}</p>
            <FieldGroup>
              {t("practice.diagnosticFlow.readingQuestion")}
              <select
                aria-label={t("practice.diagnosticFlow.readingQuestion")}
                value={answers.reading}
                onChange={(event) => {
                  setAnswers((current) => ({ ...current, reading: event.target.value }));
                }}
              >
                <option value="">{t("practice.diagnosticFlow.choose")}</option>
                <option value="10">10:00</option>
                <option value="12">12:00</option>
              </select>
            </FieldGroup>
          </section>
          <p>{t("practice.diagnosticFlow.writingNotAssessed")}</p>
          {error && (
            <Feedback live="assertive" tone="error">
              {t(error.messageKey)}
            </Feedback>
          )}
          <Button
            isDisabled={!answers.grammar || !answers.vocabulary || !answers.reading}
            isPending={busy}
            pendingLabel={t("practice.diagnosticFlow.saving")}
            variant="primary"
            onPress={() => void complete()}
          >
            {t("practice.diagnosticFlow.finish")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
