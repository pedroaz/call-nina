import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { Button, Feedback, ModalDialog, Muted } from "./components/ui/index.js";
import { ActionGroup, Section, ContentRow } from "./components/layout/index.js";
import type { Snapshot, PracticeState, HistoryPracticeSeed } from "./savedResultsTypes.js";
import styles from "./HistoryPage.module.css";

export function MistakesToPractise({
  patterns,
  isOpen,
  onOpenChange,
  operationStatus,
  practiceState,
  onPracticeAgain,
  createTargetedPractice,
}: {
  patterns: Snapshot["mistakePatterns"];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  operationStatus: ReactNode;
  practiceState: PracticeState | undefined;
  onPracticeAgain: (seed: HistoryPracticeSeed) => void;
  createTargetedPractice: (pattern: Snapshot["mistakePatterns"][number]) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {patterns.length > 0 ? (
        <>
          <Section title={t("savedResults.mistakes")}>
            {patterns.slice(0, 3).map((pattern) => (
              <ContentRow
                key={`${pattern.category.kind}:${pattern.category.categoryKey}`}
                metadata={t("savedResults.occurrences", { count: pattern.occurrenceCount })}
                actions={
                  pattern.targetedPractice.status === "created" ? (
                    <Button
                      variant="secondary"
                      onPress={() => {
                        onPracticeAgain({
                          kind: "exercise",
                          activityId:
                            pattern.targetedPractice.status === "created"
                              ? pattern.targetedPractice.activityId
                              : "",
                        });
                      }}
                    >
                      {t("savedResults.openPractice")}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      isDisabled={
                        practiceState?.status === "queued" || practiceState?.status === "running"
                      }
                      onPress={() => void createTargetedPractice(pattern)}
                    >
                      {t("history.patterns.practice.create")}
                    </Button>
                  )
                }
              >
                <h3 className={styles.patternTitle}>
                  <Button
                    variant="quiet"
                    onPress={() => {
                      onOpenChange(true);
                    }}
                  >
                    {pattern.category.kind === "vocabulary"
                      ? `${pattern.category.lemma} · ${pattern.category.categoryKey}`
                      : pattern.category.categoryKey}
                  </Button>
                </h3>
              </ContentRow>
            ))}
            {patterns.length > 3 && (
              <Button
                variant="quiet"
                onPress={() => {
                  onOpenChange(true);
                }}
              >
                {t("savedResults.viewAll")}
              </Button>
            )}
          </Section>
          <ModalDialog
            keepMounted
            isOpen={isOpen}
            onOpenChange={(open) => {
              if (!open) onOpenChange(false);
            }}
            size="large"
            title={t("history.patterns.title")}
            closeLabel={t("actions.close")}
          >
            {operationStatus}
            <div className={styles.historyMistakeGrid}>
              {patterns.map((pattern) => {
                const categoryLabel =
                  pattern.category.kind === "vocabulary"
                    ? `${pattern.category.lemma} · ${pattern.category.categoryKey}`
                    : pattern.category.categoryKey;
                return (
                  <Section key={`${pattern.category.kind}:${pattern.category.categoryKey}`}>
                    <p className={styles.eyebrow}>
                      {t(`history.patterns.category.${pattern.category.kind}`)}
                    </p>
                    <h3>{categoryLabel}</h3>
                    <Feedback live="off" tone={pattern.status === "recurring" ? "warning" : "info"}>
                      {pattern.status === "recurring"
                        ? t("history.patterns.recurring", { count: pattern.occurrenceCount })
                        : t("history.patterns.single")}
                    </Feedback>
                    <Muted as="p">
                      {t(`history.patterns.source.${pattern.classificationSource}`)}
                    </Muted>
                    {pattern.targetedPractice.status === "created" ||
                    (practiceState?.patternKey ===
                      `${pattern.category.kind}:${pattern.category.categoryKey}` &&
                      practiceState.status === "created") ? (
                      <Button
                        variant="secondary"
                        isDisabled={pattern.targetedPractice.status !== "created"}
                        onPress={() => {
                          if (pattern.targetedPractice.status === "created") {
                            onOpenChange(false);
                            onPracticeAgain({
                              kind: "exercise",
                              activityId: pattern.targetedPractice.activityId,
                            });
                          }
                        }}
                      >
                        {t("savedResults.openPractice")}
                      </Button>
                    ) : practiceState?.patternKey ===
                        `${pattern.category.kind}:${pattern.category.categoryKey}` &&
                      (practiceState.status === "queued" || practiceState.status === "running") ? (
                      <ActionGroup>
                        <Feedback live="off">
                          {t(`history.patterns.practice.${practiceState.status}`)}
                        </Feedback>
                      </ActionGroup>
                    ) : (
                      <ActionGroup>
                        <Button
                          variant="primary"
                          onPress={() => void createTargetedPractice(pattern)}
                        >
                          <Sparkles aria-hidden="true" /> {t("history.patterns.practice.create")}
                        </Button>
                        {practiceState?.patternKey ===
                          `${pattern.category.kind}:${pattern.category.categoryKey}` &&
                        (practiceState.status === "cancelled" ||
                          practiceState.status === "failed") ? (
                          <Muted as="span">
                            {t(`history.patterns.practice.${practiceState.status}`)}
                          </Muted>
                        ) : null}
                      </ActionGroup>
                    )}
                    <ol className={styles.historyEvidenceList}>
                      {pattern.occurrences.map((occurrence, position) => (
                        <li
                          key={`${occurrence.mistakeId}:${occurrence.observedOn}:${String(position)}`}
                        >
                          <time dateTime={occurrence.observedOn}>{occurrence.observedOn}</time>
                          <blockquote>
                            {occurrence.evidence.beforeContext}
                            <mark>{occurrence.evidence.evidenceText}</mark>
                            {occurrence.evidence.afterContext}
                          </blockquote>
                          <p>{occurrence.explanation}</p>
                          {occurrence.classificationSource === "learner-amended" ? (
                            <Muted as="span">{t("history.patterns.amendedEvidence")}</Muted>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </Section>
                );
              })}
            </div>
          </ModalDialog>
        </>
      ) : null}
    </>
  );
}
