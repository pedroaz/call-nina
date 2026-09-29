import {
  type ProviderOperation,
  contextualHelpCandidateSchema,
  type GenerationCandidateOutputMap,
  type CallNinaError,
} from "@call-nina/contracts";
import { useOperationProgress } from "./useOperationProgress.js";
import { OperationProgress } from "./OperationProgress.js";
import { Languages, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DiagnosticCode, Button, Feedback, ItemList } from "./components/ui/index.js";

import styles from "./ContextualHelper.module.css";
import {
  createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
  subscribeDesktop,
} from "./ipc.js";

type CorrelationId = ReturnType<typeof createDesktopSubmissionId>;
type HelpOutput = GenerationCandidateOutputMap["contextual-help"];
type HelperIntent = "chat" | "translate";
type HelperTurn = Readonly<{
  prompt: string;
  intent: HelperIntent;
  output: HelpOutput;
}>;
type SubmittedRequest = Readonly<{
  prompt: string;
  intent: HelperIntent;
  clearComposer: boolean;
}>;

export type ContextualHelperSelection = Readonly<{
  sessionId: CorrelationId;
  selectedText: string;
  containingSentence: string;
  activeResultSummary?: string;
  truncated?: boolean;
}>;

export function ContextualHelper({
  selection,
  requestAiAccess,
}: {
  selection: ContextualHelperSelection | undefined;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const progress = useOperationProgress();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<readonly HelperTurn[]>([]);
  const [stage, setStage] = useState<"idle" | "queued" | "running" | "validating">("idle");
  const [error, setError] = useState<CallNinaError>();
  const submissionId = useRef<CorrelationId | undefined>(undefined);
  const [operationId, setOperationId] = useState<CorrelationId>();
  const submittedRequests = useRef(new Map<CorrelationId, SubmittedRequest>());
  const activeSessionId = useRef<CorrelationId | undefined>(undefined);

  useEffect(() => {
    if (!selection) return;
    if (activeSessionId.current && activeSessionId.current !== selection.sessionId) {
      setTurns([]);
      setQuestion("");
    }
    activeSessionId.current = selection.sessionId;
  }, [selection]);

  useEffect(
    () =>
      subscribeDesktop((event) => {
        if (
          event.event === "learning-operation-progress" &&
          event.kind === "contextual-help" &&
          event.submissionId === submissionId.current
        ) {
          setOperationId(event.operationId);
          setStage(
            event.stage === "queued" || event.stage === "starting"
              ? "queued"
              : event.stage === "validating"
                ? "validating"
                : "running",
          );
        }
        if (
          event.event === "learning-operation-finished" &&
          event.kind === "contextual-help" &&
          event.submissionId === submissionId.current
        ) {
          submissionId.current = undefined;
          setOperationId(undefined);
          setStage("idle");
          if (event.outcome.status === "validated") {
            const output = contextualHelpCandidateSchema.parse(event.outcome.output);
            const submittedRequest = submittedRequests.current.get(event.submissionId);
            if (submittedRequest) {
              setTurns((current) =>
                [
                  ...current,
                  {
                    prompt: submittedRequest.prompt,
                    intent: submittedRequest.intent,
                    output,
                  },
                ].slice(-6),
              );
              if (submittedRequest.clearComposer) setQuestion("");
            }
            setError(undefined);
          } else if (event.outcome.status === "failed") {
            setError(event.outcome.error);
          }
          submittedRequests.current.delete(event.submissionId);
        }
      }),
    [],
  );

  const submit = async (request: SubmittedRequest, modelQuestion: string) => {
    if (!selection || stage !== "idle" || !(await requestAiAccess("contextual-help"))) return;
    const nextSubmissionId = createDesktopSubmissionId();
    submissionId.current = nextSubmissionId;
    progress.begin(nextSubmissionId, "contextual-help");
    submittedRequests.current.set(nextSubmissionId, request);
    setStage("queued");
    setError(undefined);
    try {
      const result = await invokeDesktop("learning-operation/start", {
        routeId: "codex",
        submissionId: nextSubmissionId,
        input: {
          kind: "contextual-help",
          sessionId: selection.sessionId,
          intent: request.intent,
          selectedText: selection.selectedText,
          containingSentence: selection.containingSentence,
          question: modelQuestion,
          ...(selection.activeResultSummary
            ? { activeResultSummary: selection.activeResultSummary }
            : {}),
        },
      });
      if (submissionId.current === nextSubmissionId) setOperationId(result.operationId);
    } catch (cause) {
      setStage("idle");
      submittedRequests.current.delete(nextSubmissionId);
      setError(normalizeDesktopError(cause).detail);
    }
  };

  const ask = () => {
    const prompt = question.trim();
    if (!prompt) return;
    void submit({ prompt, intent: "chat", clearComposer: true }, prompt);
  };

  const translate = () => {
    void submit(
      {
        prompt: t("helper.translateRequest"),
        intent: "translate",
        clearComposer: false,
      },
      "Translate the selected text into my explanation language.",
    );
  };

  return (
    <div className={styles.helperConversation}>
      <p>{t("helper.courseSupport")}</p>
      {!selection ? (
        <Feedback live="off">{t("helper.selectText")}</Feedback>
      ) : (
        <figure className={styles.helperSelection}>
          <figcaption>{t("helper.selectedContext")}</figcaption>
          <blockquote>{selection.selectedText}</blockquote>
          {selection.truncated ? <p>{t("helper.selectionTruncated")}</p> : null}
        </figure>
      )}
      <div className={styles.helperTurns} aria-live="polite">
        {turns.map((turn, index) => (
          <article key={`${turn.prompt}:${String(index)}`}>
            <p className={styles.eyebrow}>{t("helper.youAsked")}</p>
            <p>{turn.prompt}</p>
            <p className={styles.eyebrow}>{t("helper.answer")}</p>
            <p className={styles.helperAnswer}>{turn.output.answer}</p>
            {turn.output.examples.length > 0 ? (
              <ItemList>
                {turn.output.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ItemList>
            ) : null}
            {turn.output.alternatives.length > 0 ? (
              <section>
                <h3>{t("helper.alternatives")}</h3>
                <ItemList>
                  {turn.output.alternatives.map((alternative) => (
                    <li key={alternative}>{alternative}</li>
                  ))}
                </ItemList>
              </section>
            ) : null}
            {turn.intent !== "translate" && turn.output.translations.length > 0 ? (
              <section>
                <h3>{t("helper.translations")}</h3>
                <ItemList>
                  {turn.output.translations.map((translation) => (
                    <li key={`${translation.sourceText}:${translation.translatedText}`}>
                      <span lang="de">{translation.sourceText}</span> — {translation.translatedText}
                    </li>
                  ))}
                </ItemList>
              </section>
            ) : null}
            {turn.output.miniExercises.length > 0 ? (
              <section>
                <h3>{t("helper.miniExercises")}</h3>
                {turn.output.miniExercises.map((exercise) => (
                  <details key={exercise.prompt}>
                    <summary>{exercise.prompt}</summary>
                    <p>{exercise.suggestedAnswer}</p>
                  </details>
                ))}
              </section>
            ) : null}
            {turn.output.followUpSuggestions.length > 0 ? (
              <section>
                <h3>{t("helper.followUps")}</h3>
                <ItemList>
                  {turn.output.followUpSuggestions.map((suggestion) => (
                    <li key={suggestion}>{suggestion}</li>
                  ))}
                </ItemList>
              </section>
            ) : null}
            {turn.output.uncertainty.level !== "none" ? (
              <Feedback live="off" tone="warning">
                {turn.output.uncertainty.explanation}
              </Feedback>
            ) : null}
          </article>
        ))}
      </div>
      <div className={styles.helperComposer}>
        <OperationProgress progress={stage === "idle" ? undefined : progress.progress} />
        <textarea
          data-helper-selection="ignore"
          aria-label={t("helper.messageLabel")}
          disabled={!selection || stage !== "idle"}
          maxLength={1_000}
          placeholder={t("helper.messagePlaceholder")}
          rows={2}
          value={question}
          onChange={(event) => {
            setQuestion(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              ask();
            }
          }}
        />
        <div className={styles.helperComposerActions}>
          <Button
            isDisabled={!selection || stage !== "idle"}
            leadingIcon={<Languages aria-hidden="true" />}
            onPress={translate}
          >
            {t("helper.translate")}
          </Button>
          <Button
            isDisabled={!selection || !question.trim() || stage !== "idle"}
            leadingIcon={<Send aria-hidden="true" />}
            onPress={ask}
            variant="primary"
          >
            {stage === "idle" ? t("helper.send") : t(`helper.stages.${stage}`)}
          </Button>
          {operationId ? (
            <Button
              variant="secondary"
              leadingIcon={<Square aria-hidden="true" />}
              onPress={() => {
                if (operationId) {
                  void invokeDesktop("learning-operation/cancel", { operationId });
                }
              }}
            >
              {t("actions.cancel")}
            </Button>
          ) : null}
        </div>
        <p className={styles.helperComposerHint}>{t("helper.sendHint")}</p>
      </div>
      {error ? (
        <Feedback live="assertive" tone="error">
          {t(error.messageKey)}
          <DiagnosticCode>
            {error.reference.code} · {error.reference.correlationId}
          </DiagnosticCode>
        </Feedback>
      ) : null}
    </div>
  );
}
