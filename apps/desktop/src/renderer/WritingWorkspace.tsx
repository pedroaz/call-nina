import { ProviderActionSummary } from "./ProviderActionSummary.js";
import type { ProviderOperation } from "@call-nina/contracts";
import { OperationProgress } from "./OperationProgress.js";
import { useState } from "react";
import { MousePointer2, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SelectControl,
  DiagnosticCode,
  Disclosure,
  UtilityPopover,
  InfoHint,
  Button,
  Feedback,
  FieldGroup,
  LoadingState,
  Muted,
  Tabs,
} from "./components/ui/index.js";
import { ActionGroup } from "./components/layout/index.js";

import styles from "./WritingWorkspace.module.css";
import {
  ActivityWorkspace,
  ActivityFrame,
  ActivityReference,
  ActivityFooter,
  ActivityFeedback,
  type ActivityReferenceItem,
} from "./components/activity/index.js";
import { CorrectionComparison } from "./CorrectionComparison.js";
import type { ContextualHelperSelection } from "./ContextualHelper.js";
import {
  useWritingSession,
  type TeachingProfileChoice,
  type FeedbackChoice,
  type CorrelationId,
} from "./useWritingSession.js";

export function WritingWorkspace({
  breadcrumbs,
  onDirtyChange,
  requestAiAccess,
  initialContext = "",
  initialDraft = "",
  onHelperSelection,
}: {
  breadcrumbs?: ReadonlyArray<{ label: string; onPress: () => void }>;
  onDirtyChange: (dirty: boolean) => void;
  requestAiAccess: (
    operation: ProviderOperation,
    previousOperationId?: CorrelationId,
  ) => Promise<boolean>;
  initialContext?: string;
  initialDraft?: string;
  onHelperSelection: (selection: Omit<ContextualHelperSelection, "sessionId"> | undefined) => void;
}) {
  const { t } = useTranslation();
  const [writingView, setWritingView] = useState("answer");
  const [contextOpen, setContextOpen] = useState(Boolean(initialContext));
  const {
    promptProgress,
    correctionProgress,
    context,
    setContext,
    draft,
    setDraft,
    teachingProfile,
    setTeachingProfile,
    feedback,
    setFeedback,
    selection,
    prompt,
    operationId,
    promptStage,
    promptError,
    correctionOperationId,
    previousCorrectionOperationId,
    correctionStage,
    correctionError,
    correctionOutcome,
    correction,
    correctionOriginal,
    generatePrompt,
    cancelPrompt,
    useFreeWriting,
    startCorrection,
    cancelCorrection,
    retryCorrection,
    updateSelection,
  } = useWritingSession({ initialContext, initialDraft, onDirtyChange, requestAiAccess });
  const [previousContext, setPreviousContext] = useState(context);
  if (context !== previousContext) {
    setPreviousContext(context);
    if (context) setContextOpen(true);
  }
  const references: ActivityReferenceItem[] = [];
  if (prompt)
    references.push({
      id: "prompt",
      label: t("activity.brief"),
      content: (
        <article className={styles.generatedPrompt} aria-label={t("writing.generatedPrompt")}>
          <p className={styles.eyebrow}>{t(`writing.promptFormats.${prompt.format}`)}</p>
          <h3>{prompt.title}</h3>
          <p>{prompt.situation}</p>
          <p>{prompt.task}</p>
          <Muted as="p">{t("writing.suggestedWords", { count: prompt.suggestedWordCount })}</Muted>
          {prompt.helpfulVocabulary.length > 0 ? (
            <Disclosure variant="inline" label={t("nav.vocabulary")}>
              <ul>
                {prompt.helpfulVocabulary.map((item) => (
                  <li key={item.term}>
                    <strong>{item.term}</strong> — {item.explanation}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
        </article>
      ),
    });
  else if (context)
    references.push({
      id: "context",
      label: t("writing.contextLabel"),
      content: (
        <article>
          <h2>{t("writing.contextLabel")}</h2>
          <p>{context}</p>
        </article>
      ),
    });
  return (
    <ActivityWorkspace title={t("writing.title")} {...(breadcrumbs ? { breadcrumbs } : {})}>
      <ActivityFrame
        taskLabel={t("activity.task")}
        reference={
          references.length ? (
            <ActivityReference label={t("activity.reference")} items={references} />
          ) : undefined
        }
        footer={
          <ActivityFooter>
            <UtilityPopover
              label={t("writing.optionsTitle")}
              summary={`${t(teachingProfile === "profile-default" ? "writing.profileDefault" : teachingProfile === "conversation-partner" ? "writing.profileConversation" : "writing.profileStrict")} · ${t(feedback === "all-meaningful" ? "writing.feedbackAll" : "writing.feedbackPriority")}`}
            >
              <div className={styles.writingOptions}>
                <FieldGroup>
                  <span>{t("writing.profileLabel")}</span>
                  <SelectControl
                    value={teachingProfile}
                    onChange={(event) => {
                      setTeachingProfile(event.currentTarget.value as TeachingProfileChoice);
                    }}
                  >
                    <option value="profile-default">{t("writing.profileDefault")}</option>
                    <option value="conversation-partner">{t("writing.profileConversation")}</option>
                    <option value="strict-corrector">{t("writing.profileStrict")}</option>
                  </SelectControl>
                </FieldGroup>
                <FieldGroup>
                  <span>{t("writing.feedbackLabel")}</span>
                  <SelectControl
                    value={feedback}
                    onChange={(event) => {
                      setFeedback(event.currentTarget.value as FeedbackChoice);
                    }}
                  >
                    <option value="all-meaningful">{t("writing.feedbackAll")}</option>
                    <option value="priority-only">{t("writing.feedbackPriority")}</option>
                  </SelectControl>
                </FieldGroup>
              </div>
            </UtilityPopover>
            <ProviderActionSummary
              operation="writing-correction"
              busy={correctionStage !== "idle"}
              previousOperationId={
                correctionError || correctionOutcome === "rate-limited"
                  ? previousCorrectionOperationId
                  : undefined
              }
            />
            {correctionOperationId ? (
              <Button variant="secondary" onPress={() => void cancelCorrection()}>
                <X aria-hidden="true" /> {t("writing.cancelCorrection")}
              </Button>
            ) : null}
            <Button
              variant="primary"
              isDisabled={!draft.trim() || correctionStage !== "idle" || promptStage !== "idle"}
              onPress={() => void startCorrection()}
            >
              <Sparkles aria-hidden="true" /> {t("writing.correctNow")}
            </Button>
            {(correctionError || correctionOutcome === "rate-limited") &&
            previousCorrectionOperationId ? (
              <Button variant="primary" onPress={() => void retryCorrection()}>
                {t("writing.retryCorrection")}
              </Button>
            ) : null}
          </ActivityFooter>
        }
        feedback={
          <>
            {correctionStage !== "idle" ? (
              <LoadingState live>{t(`writing.correctionStages.${correctionStage}`)}</LoadingState>
            ) : null}
            <OperationProgress
              progress={correctionStage === "idle" ? undefined : correctionProgress.progress}
            />
            {correctionError ? (
              <Feedback live="assertive" tone="error">
                <p>{t(correctionError.messageKey)}</p>
                <DiagnosticCode>
                  {correctionError.reference.code} · {correctionError.reference.correlationId}
                </DiagnosticCode>
              </Feedback>
            ) : null}
            {correctionOutcome ? (
              <Feedback live="polite" tone="warning">
                {t(`writing.correctionOutcomes.${correctionOutcome}`)}
              </Feedback>
            ) : null}
            {correction && writingView === "answer" && (
              <ActivityFeedback tone="info" live="polite">
                {t("writing.correctionReady")}
              </ActivityFeedback>
            )}
          </>
        }
      >
        <section className={styles.promptActions} aria-label={t("writing.promptTitle")}>
          <ProviderActionSummary operation="writing-prompt" busy={promptStage !== "idle"} />
          <ActionGroup className={styles.promptActionButtons}>
            <Button
              variant="secondary"
              isDisabled={promptStage !== "idle"}
              onPress={() => void generatePrompt()}
            >
              <Sparkles aria-hidden="true" />
              {promptStage === "idle"
                ? t("writing.generatePrompt")
                : t(`writing.promptStages.${promptStage}`)}
            </Button>
            {operationId ? (
              <Button variant="secondary" onPress={() => void cancelPrompt()}>
                <X aria-hidden="true" /> {t("actions.cancel")}
              </Button>
            ) : null}
            {context && (
              <Button variant="quiet" onPress={useFreeWriting}>
                {t("writing.freeWriting")}
              </Button>
            )}
            <InfoHint label={t("writing.generatePrompt")}>{t("writing.promptBody")}</InfoHint>
          </ActionGroup>
          <OperationProgress
            progress={promptStage === "idle" ? undefined : promptProgress.progress}
          />
          {promptError ? (
            <Feedback live="assertive" tone="error">
              <p>{t(promptError.messageKey)}</p>
              <DiagnosticCode>
                {promptError.reference.code} · {promptError.reference.correlationId}
              </DiagnosticCode>
            </Feedback>
          ) : null}
        </section>

        <Tabs
          label={t("activity.writingViews")}
          selectedKey={writingView}
          onSelectionChange={setWritingView}
          items={[
            {
              id: "answer",
              label: t("activity.answer"),
              children: (
                <div className={styles.writingLayout}>
                  <div className={styles.writingEditor}>
                    <Disclosure
                      variant="inline"
                      label={t("writing.contextLabel")}
                      open={contextOpen}
                      onOpenChange={setContextOpen}
                    >
                      <FieldGroup>
                        <span>{t("writing.contextLabel")}</span>
                        <textarea
                          aria-label={t("writing.contextLabel")}
                          maxLength={1_000}
                          placeholder={t("writing.contextPlaceholder")}
                          rows={3}
                          value={context}
                          onChange={(event) => {
                            setContext(event.currentTarget.value);
                          }}
                        />
                      </FieldGroup>
                    </Disclosure>
                    <FieldGroup>
                      <span>{t("writing.editorLabel")}</span>
                      <textarea
                        className={styles.writingTextarea}
                        maxLength={10_000}
                        placeholder={t("writing.editorPlaceholder")}
                        rows={10}
                        value={draft}
                        onChange={(event) => {
                          setDraft(event.currentTarget.value);
                          updateSelection(event.currentTarget);
                        }}
                        onClick={(event) => {
                          updateSelection(event.currentTarget);
                        }}
                        onKeyUp={(event) => {
                          updateSelection(event.currentTarget);
                        }}
                        onSelect={(event) => {
                          updateSelection(event.currentTarget);
                        }}
                      />
                    </FieldGroup>
                    {selection.end > selection.start && (
                      <p className={styles.selectionStatus} role="status">
                        <MousePointer2 aria-hidden="true" />
                        {selection.end > selection.start
                          ? t("writing.selection", { count: selection.end - selection.start })
                          : t("writing.noSelection")}
                      </p>
                    )}

                    <Muted as="p" className={styles.draftNotice}>
                      {t("writing.localDraftNotice")}
                    </Muted>
                  </div>
                </div>
              ),
            },
            {
              id: "review",
              label: t("activity.review"),
              isDisabled: !correction,
              children: (
                <>
                  {correction ? (
                    <CorrectionComparison
                      correction={correction}
                      originalText={correctionOriginal}
                      onHelperSelection={(selectedText) => {
                        onHelperSelection({
                          selectedText,
                          containingSentence: correction.correctedText,
                          activeResultSummary: correction.summary,
                        });
                      }}
                    />
                  ) : null}
                </>
              ),
            },
          ]}
        />
      </ActivityFrame>
    </ActivityWorkspace>
  );
}
