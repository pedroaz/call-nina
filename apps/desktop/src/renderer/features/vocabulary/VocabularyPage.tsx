import type {
  ActivityId,
  CallNinaError,
  Language,
  PracticeSource,
  ProviderOperation,
} from "@call-nina/contracts";
import { ArrowRight, BookOpen } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "../../components/layout/index.js";
import tableStyles from "../../components/layout/Table.module.css";
import { Button, EmptyState, LoadingState } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { type SavedResultsScope } from "../../learning/results/savedResultsTypes.js";
import { SpeechButton } from "../../learning/speech/SpeechButton.js";
import { useUploads } from "../../learning/uploads/useUploads.js";
import { useVocabularyLearning } from "../../learning/vocabulary/useVocabularyLearning.js";
import {
  useVocabularyLibrary,
  vocabularyVersion,
  type VocabularySummary,
} from "../../learning/vocabulary/useVocabularyLibrary.js";
import { VocabularyNavigation } from "../../learning/vocabulary/VocabularyUpdateSummary.js";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import { VocabularyLearning } from "./VocabularyLearning.js";
import styles from "./VocabularyPage.module.css";
import { VocabularyReview } from "./VocabularyReview.js";

type Props = Readonly<{
  onLanguageSwitchBlockedChange?: (blocked: boolean) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  targetLanguage?: Language | undefined;
  initialDueOnly?: boolean;
  viewRequest?: number;
  onOpenActivity: (activityId: ActivityId) => void;
  onNavigate: (page: "results" | "practice", scope?: SavedResultsScope) => void;
  onUploadPractice?: (source: PracticeSource) => void;
}>;

export function VocabularyPage({
  onLanguageSwitchBlockedChange,
  targetLanguage,
  initialDueOnly = false,
  viewRequest = 0,
  onNavigate,
  onOpenActivity,
  requestAiAccess,
  onUploadPractice,
}: Props) {
  const library = useVocabularyLibrary(initialDueOnly);
  return (
    <VocabularyWorkspace
      key={library.rootGeneration ?? "unconfigured"}
      library={library}
      onUploadPractice={onUploadPractice}
      viewRequest={viewRequest}
      onLanguageSwitchBlockedChange={onLanguageSwitchBlockedChange}
      targetLanguage={targetLanguage}
      onNavigate={onNavigate}
      onOpenActivity={onOpenActivity}
      requestAiAccess={requestAiAccess}
    />
  );
}

function VocabularyWorkspace({
  onLanguageSwitchBlockedChange,
  library,
  viewRequest,
  targetLanguage,
  onNavigate,
  onOpenActivity,
  requestAiAccess,
  onUploadPractice,
}: {
  library: ReturnType<typeof useVocabularyLibrary>;
  onUploadPractice: Props["onUploadPractice"];
  viewRequest: number;
  onLanguageSwitchBlockedChange: Props["onLanguageSwitchBlockedChange"];
  requestAiAccess: Props["requestAiAccess"];
  targetLanguage?: Language | undefined;
  onNavigate: Props["onNavigate"];
  onOpenActivity: Props["onOpenActivity"];
}) {
  const { t, i18n } = useTranslation();
  const { result, query } = library;
  const uploads = useUploads();
  const navigation = useContext(VocabularyNavigation);
  const [learningBusy, setLearningBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const locked = useRef(false);
  const mounted = useRef(true);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const tableCaption = useRef<HTMLTableCaptionElement>(null);
  const restoreReview = useRef(false);
  const libraryScroll = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onLanguageSwitchBlockedChange?.(learningBusy || reviewing || busy);
    return () => onLanguageSwitchBlockedChange?.(false);
  }, [learningBusy, reviewing, busy, onLanguageSwitchBlockedChange]);
  useEffect(() => {
    if (!restoreReview.current || reviewing || library.busy) return;
    (reviewButton.current ?? tableCaption.current)?.focus({ preventScroll: true });
    window.scrollTo({ top: libraryScroll.current });
    restoreReview.current = false;
  }, [reviewing, library.busy, result]);
  const changeStatus = async (entry: VocabularySummary) => {
    if (!result || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("vocabulary/bulk", {
        rootGeneration: result.rootGeneration,
        action:
          entry.status === "active"
            ? "suspend"
            : entry.status === "candidate"
              ? "confirm"
              : "resume",
        entries: [vocabularyVersion(entry)],
      });
      if (mounted.current) await library.refresh();
    } catch (cause) {
      if (mounted.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const waiting = busy || library.busy;
  const rows = result?.entries ?? [];
  return (
    <>
      {reviewing && result && (
        <VocabularyReview
          rootGeneration={result.rootGeneration}
          onChanged={() => void library.refresh()}
          uploadId={query.uploadId}
          onExit={() => {
            restoreReview.current = true;
            setReviewing(false);
            void library.refresh();
          }}
        />
      )}
      <div
        hidden={reviewing}
        data-vocabulary-ready={Boolean(result && !waiting && !error && !library.error)}
        data-vocabulary-total={result?.counts.all}
        data-root-generation={result?.rootGeneration}
        data-learning-language={targetLanguage}
      >
        <VocabularyLearning
          onWordNavigate={onNavigate}
          onPractise={(source) => {
            onUploadPractice?.(source);
            onNavigate("practice");
          }}
          onOpenActivity={onOpenActivity}
          requestAiAccess={requestAiAccess}
          onBusyChange={setLearningBusy}
          dueCount={result?.counts.due}
          uploadCount={uploads.snapshot?.uploads.length}
          viewRequest={viewRequest}
          libraryBusy={waiting}
          reviewButtonRef={reviewButton}
          onReview={() => {
            setError(undefined);
            libraryScroll.current = window.scrollY;
            setReviewing(true);
          }}
        >
          <div className={styles.library}>
            {error && <OperationError error={error} />}
            {library.error && (
              <OperationError error={library.error}>
                <Button
                  variant="secondary"
                  isPending={library.busy}
                  onPress={() => void library.refresh()}
                >
                  {t("actions.retry")}
                </Button>
              </OperationError>
            )}
            {(navigation.activityId || query.filter !== "all") && (
              <Button
                variant="quiet"
                onPress={() => {
                  navigation.view(undefined);
                  library.changeQuery({ filter: "all", page: 0 });
                }}
              >
                {t("vocabulary.simple.showAll")}
              </Button>
            )}
            <VocabularyTableUpdates rows={rows} ready={!waiting && !reviewing} />
            {library.busy && <LoadingState live>{t("ui.loading")}</LoadingState>}
            {result?.counts.all === 0 && !library.error && (
              <EmptyState
                variant="plain"
                icon={<BookOpen />}
                title={t("uploads.noWords")}
                action={
                  <Button
                    variant="primary"
                    trailingIcon={<ArrowRight aria-hidden="true" />}
                    onPress={() => {
                      onNavigate("practice");
                    }}
                  >
                    {t("uploads.startPractice")}
                  </Button>
                }
              />
            )}
            {result && result.counts.all > 0 && (
              <>
                <div className={styles.tableRegion} aria-busy={waiting}>
                  <table className={`${tableStyles.table} ${styles.table}`}>
                    <caption ref={tableCaption} tabIndex={-1} className={styles.caption}>
                      {t("vocabulary.title")}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className={styles.expressionColumn}>
                          {t("vocabulary.simple.expression")}
                        </th>
                        <th scope="col" className={styles.meaningColumn}>
                          {t("vocabulary.meaning")}
                        </th>
                        <th scope="col" className={styles.statusColumn}>
                          {t("vocabulary.library.status")}
                        </th>
                        <th scope="col" className={styles.actionColumn}>
                          <span className={styles.srOnly}>{t("vocabulary.simple.actions")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((entry) => (
                        <tr key={entry.vocabularyId} data-vocabulary-entry={entry.vocabularyId}>
                          <td>
                            <div className={styles.expression}>
                              <span className={styles.word} lang={targetLanguage}>
                                {entry.lemma}
                              </span>
                              {targetLanguage && (
                                <SpeechButton text={entry.lemma} language={targetLanguage} />
                              )}
                            </div>
                            {entry.examples[0] && (
                              <div className={styles.example} lang={targetLanguage}>
                                {entry.examples[0].text}
                              </div>
                            )}
                            <span className={styles.compactMeaning} lang="">
                              {entry.meaning}
                            </span>
                          </td>
                          <td className={styles.meaningColumn}>
                            <span className={styles.summary} lang="">
                              {entry.meaning}
                            </span>
                          </td>
                          <td>
                            <span>{t(`vocabulary.simple.${entry.status}`)}</span>
                            {entry.status === "active" && entry.dueOn && (
                              <span className={styles.reviewDate}>
                                {t("vocabulary.simple.reviewOn", {
                                  date: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                                    month: "short",
                                    day: "numeric",
                                  }).format(new Date(`${entry.dueOn}T12:00:00`)),
                                })}
                              </span>
                            )}
                          </td>
                          <td className={styles.actionColumn}>
                            <Button
                              variant="quiet"
                              density="compact"
                              isDisabled={waiting}
                              aria-label={`${t(entry.status === "active" ? "vocabulary.simple.dismiss" : entry.status === "candidate" ? "vocabulary.simple.learn" : "vocabulary.resume")}: ${entry.lemma}`}
                              onPress={() => void changeStatus(entry)}
                            >
                              {t(
                                entry.status === "active"
                                  ? "vocabulary.simple.dismiss"
                                  : entry.status === "candidate"
                                    ? "vocabulary.simple.learn"
                                    : "vocabulary.resume",
                              )}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && (
                    <p className={styles.empty}>{t("vocabulary.library.noMatches")}</p>
                  )}
                </div>
                {result.total > 30 && (
                  <ActionGroup>
                    <Button
                      variant="secondary"
                      isDisabled={waiting || result.page === 0}
                      onPress={() => {
                        library.changeQuery({ page: result.page - 1 });
                      }}
                    >
                      {t("vocabulary.library.previous")}
                    </Button>
                    <span aria-live="polite">
                      {t("vocabulary.library.page", {
                        page: result.page + 1,
                        total: Math.ceil(result.total / 30),
                      })}
                    </span>
                    <Button
                      variant="secondary"
                      isDisabled={waiting || (result.page + 1) * 30 >= result.total}
                      onPress={() => {
                        library.changeQuery({ page: result.page + 1 });
                      }}
                    >
                      {t("vocabulary.library.next")}
                    </Button>
                  </ActionGroup>
                )}
              </>
            )}
          </div>
        </VocabularyLearning>
      </div>
    </>
  );
}

// Acknowledge only updates whose affected entries have actually appeared on screen.
function VocabularyTableUpdates({ rows, ready }: { rows: VocabularySummary[]; ready: boolean }) {
  const learning = useVocabularyLearning();
  const { t } = useTranslation();
  const anchor = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => new Set<string>());
  useEffect(() => {
    if (!ready) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset["vocabularyEntry"];
        if (entry.isIntersecting && id)
          setSeen((current) => (current.has(id) ? current : new Set([...current, id])));
      }
    });
    anchor.current?.parentElement?.querySelectorAll("[data-vocabulary-entry]").forEach((row) => {
      observer.observe(row);
    });
    return () => {
      observer.disconnect();
    };
  }, [rows, ready]);
  const batchIds = useMemo(
    () =>
      learning.snapshot?.batches
        .filter((batch) => {
          const words = batch.words.filter((word) => word.added || word.outcome === "difficulty");
          return (
            !batch.read &&
            !batch.undone &&
            words.length > 0 &&
            words.every((word) => seen.has(word.vocabularyId))
          );
        })
        .map((batch) => batch.id)
        .slice(0, 50) ?? [],
    [learning.snapshot, seen],
  );
  const { saving: learningSaving, error: learningError, update: updateLearning } = learning;
  useEffect(() => {
    if (ready && batchIds.length > 0 && !learningSaving && !learningError)
      void updateLearning({ kind: "read", batchIds });
  }, [batchIds, ready, learningSaving, learningError, updateLearning]);
  const failed = learning.snapshot?.jobs.find(
    (job) => job.state === "failed" || job.state === "blocked",
  );
  const pending = learning.snapshot?.jobs.some(
    (job) => job.state === "pending" || job.state === "running",
  );
  return (
    <div ref={anchor} hidden={!failed && !pending && !learning.error} role="status">
      {pending && <span>{t("vocabulary.updates.pending")}</span>}
      {failed && (
        <ActionGroup>
          <span>{t("vocabulary.updates.failed")}</span>
          <Button
            variant="quiet"
            isDisabled={learning.saving}
            onPress={() =>
              void learning.update({ kind: "retry", activityId: failed.activityId as ActivityId })
            }
          >
            {t("actions.retry")}
          </Button>
        </ActionGroup>
      )}
      {learning.error && <span>{t(learning.error)}</span>}
    </div>
  );
}
