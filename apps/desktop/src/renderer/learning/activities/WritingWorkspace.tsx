import type { PracticeSource, ProviderOperation } from "@call-nina/contracts";
import { Eye, EyeOff, MousePointer2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "../../components/layout/index.js";
import {
  Button,
  Disclosure,
  Feedback,
  FieldGroup,
  InfoHint,
  LoadingState,
  Muted,
  SelectControl,
  Tabs,
  UtilityPopover,
} from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { OperationProgress } from "../operations/OperationProgress.js";
import { ProviderActionSummary } from "../providers/ProviderActionSummary.js";
import { UploadSourceEvidence } from "../uploads/UploadSourceEvidence.js";
import { VocabularyUpdateSummary } from "../vocabulary/VocabularyUpdateSummary.js";

import {
  ActivityFooter,
  ActivityFrame,
  ActivityReference,
  ActivityWorkspace,
  type ActivityReferenceItem,
} from "../../components/activity/index.js";
import { type ContextualHelperSelection } from "../helper/ContextualHelper.js";
import { CorrectionComparison } from "../results/CorrectionComparison.js";
import {
  useWritingSession,
  type CorrelationId,
  type FeedbackChoice,
  type TeachingProfileChoice,
} from "./useWritingSession.js";
import styles from "./WritingWorkspace.module.css";

export function WritingWorkspace({
  breadcrumbs,
  onDirtyChange,
  requestAiAccess,
  practiceSource,
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
  practiceSource?: PracticeSource | undefined;
  initialContext?: string;
  initialDraft?: string;
  onHelperSelection: (selection: Omit<ContextualHelperSelection, "sessionId"> | undefined) => void;
}) {
  const { t } = useTranslation();
  const [writingView, setWritingView] = useState("answer");
  const [contextOpen, setContextOpen] = useState(Boolean(initialContext));
  const [referenceVisible, setReferenceVisible] = useState(true);
  const reviewContent = useRef<HTMLDivElement>(null);
  const {
    dirty,
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
    promptStage,
    promptError,
    previousCorrectionOperationId,
    correctionStage,
    correctionError,
    correctionOutcome,
    correction,
    correctionActivityId,
    correctionOriginal,
    correctionLanguage,
    generatePrompt,
    cancelPrompt,
    useFreeWriting,
    startCorrection,
    cancelCorrection,
    retryCorrection,
    updateSelection,
  } = useWritingSession({
    initialContext,
    initialDraft,
    onDirtyChange,
    requestAiAccess,
    practiceSource,
  });
  const [previousPrompt, setPreviousPrompt] = useState(prompt);
  if (prompt !== previousPrompt) {
    setPreviousPrompt(prompt);
    if (prompt) {
      setContextOpen(false);
      setReferenceVisible(true);
    }
  }
  const [previousCorrection, setPreviousCorrection] = useState(correction);
  if (correction !== previousCorrection) {
    setPreviousCorrection(correction);
    setWritingView(correction ? "review" : "answer");
  }
  useEffect(() => {
    if (!correction) return;
    reviewContent.current?.focus();
  }, [correction]);
  const references: ActivityReferenceItem[] = [];
  if (prompt)
    references.push({
      id: "prompt",
      label: t("activity.brief"),
      content: (
        <article className={styles.generatedPrompt} aria-label={t("writing.generatedPrompt")}>
          <h2>{prompt.title}</h2>
          <div className={styles.promptMetadata}>
            <Muted>{t(`writing.promptFormats.${prompt.format}`)}</Muted>
            <Muted>{t("writing.suggestedWords", { count: prompt.suggestedWordCount })}</Muted>
          </div>
          <p>{prompt.situation}</p>
          <p>{prompt.task}</p>
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
    <ActivityWorkspace
      title={t("writing.title")}
      className={styles.workspace}
      actions={
        practiceSource?.kind === "upload" ? (
          <UploadSourceEvidence
            reference={practiceSource.reference}
            rootGeneration={practiceSource.rootGeneration}
            title={t("uploads.preview")}
          />
        ) : undefined
      }
      {...(breadcrumbs ? { breadcrumbs } : {})}
    >
      <ActivityFrame
        taskLabel={t("activity.task")}
        fillViewport={writingView === "answer" && referenceVisible && references.length > 0}
        reference={
          writingView === "answer" && referenceVisible && references.length ? (
            <ActivityReference label={t("activity.reference")} items={references} />
          ) : undefined
        }
        footer={
          writingView === "answer" ? (
            <ActivityFooter
              utilities={
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
                        <option value="conversation-partner">
                          {t("writing.profileConversation")}
                        </option>
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
              }
            >
              <ProviderActionSummary
                operation="writing-correction"
                busy={correctionStage !== "idle"}
                previousOperationId={
                  correctionError || correctionOutcome === "rate-limited"
                    ? previousCorrectionOperationId
                    : undefined
                }
              />
              {correctionStage !== "idle" ? (
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
          ) : undefined
        }
        feedback={
          <>
            {correctionStage !== "idle" ? (
              <LoadingState live>{t(`writing.correctionStages.${correctionStage}`)}</LoadingState>
            ) : null}
            <OperationProgress
              progress={correctionStage === "idle" ? undefined : correctionProgress.progress}
            />
            {correctionError ? <OperationError error={correctionError} /> : null}
            {correctionOutcome ? (
              <Feedback live="polite" tone="warning">
                {t(`writing.correctionOutcomes.${correctionOutcome}`)}
              </Feedback>
            ) : null}
          </>
        }
      >
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
                    <section className={styles.promptActions} aria-label={t("writing.promptTitle")}>
                      <ProviderActionSummary
                        operation="writing-prompt"
                        busy={promptStage !== "idle"}
                      />
                      <ActionGroup className={styles.promptActionButtons}>
                        <Button
                          variant="secondary"
                          isDisabled={promptStage !== "idle" || correctionStage !== "idle"}
                          onPress={() => void generatePrompt()}
                        >
                          <Sparkles aria-hidden="true" />
                          {promptStage === "idle"
                            ? t("writing.generatePrompt")
                            : t(`writing.promptStages.${promptStage}`)}
                        </Button>
                        {promptStage !== "idle" ? (
                          <Button variant="secondary" onPress={() => void cancelPrompt()}>
                            <X aria-hidden="true" /> {t("actions.cancel")}
                          </Button>
                        ) : null}
                        {references.length > 0 && (
                          <Button
                            variant="secondary"
                            leadingIcon={
                              referenceVisible ? (
                                <EyeOff aria-hidden="true" />
                              ) : (
                                <Eye aria-hidden="true" />
                              )
                            }
                            aria-expanded={referenceVisible}
                            onPress={() => {
                              setReferenceVisible((visible) => !visible);
                            }}
                          >
                            {t(referenceVisible ? "writing.hidePrompt" : "writing.showPrompt")}
                          </Button>
                        )}
                        <InfoHint label={t("writing.generatePrompt")}>
                          {t("writing.promptBody")}
                        </InfoHint>
                      </ActionGroup>
                      <OperationProgress
                        progress={promptStage === "idle" ? undefined : promptProgress.progress}
                      />
                      {promptError ? <OperationError error={promptError} /> : null}
                    </section>
                    <Disclosure
                      variant="inline"
                      label={t("writing.setupTitle")}
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
                      {context && (
                        <Button variant="quiet" onPress={useFreeWriting}>
                          {t("writing.freeWriting")}
                        </Button>
                      )}
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

                    {dirty && (
                      <Muted as="p" className={styles.draftNotice}>
                        {t("writing.localDraftNotice")}
                      </Muted>
                    )}
                  </div>
                </div>
              ),
            },
            {
              id: "review",
              label: t("activity.review"),
              isDisabled: !correction,
              children: (
                <div
                  ref={reviewContent}
                  tabIndex={-1}
                  data-focus-anchor
                  aria-label={t("activity.review")}
                >
                  {correction && correctionActivityId && (
                    <VocabularyUpdateSummary activityId={correctionActivityId} />
                  )}
                  {correction ? (
                    <CorrectionComparison
                      targetLanguage={correctionLanguage}
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
                </div>
              ),
            },
          ]}
        />
      </ActivityFrame>
    </ActivityWorkspace>
  );
}
