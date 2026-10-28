import { ProviderActionSummary } from "./ProviderActionSummary.js";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowRight, BookOpen, BookPlus, Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type ActivityId,
  type DesktopIpcResponse,
  type ProviderOperation,
  vocabularyAnalysisOutputSchema,
} from "@call-nina/contracts";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import { useLearningOperation } from "./useLearningOperation.js";
import {
  Button,
  Feedback,
  ModalDialog,
  TextField,
  Tabs,
  LoadingState,
} from "./components/ui/index.js";
import { ActionGroup, Page, ContentRow } from "./components/layout/index.js";
import { OperationProgress } from "./OperationProgress.js";
import styles from "./VocabularyLearning.module.css";
type Snapshot = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "vocabulary/learning-read" }
>["result"];
function useVocabularyLearning() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const next = await invokeDesktop("vocabulary/learning-read", {});
      if (version !== requestVersion.current) return;
      setSnapshot(next);
      setError("");
    } catch (cause) {
      if (version === requestVersion.current)
        setError(normalizeDesktopError(cause).detail.messageKey);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        setSnapshot(undefined);
        void refresh();
      }
      if (
        event.event === "state-invalidated" &&
        ["vocabulary", "settings", "dashboard"].includes(event.scope)
      )
        void refresh();
    });
  }, [refresh]);
  const update = async (
    action: Parameters<typeof invokeDesktop<"vocabulary/learning-update">>[1]["action"],
  ) => {
    if (!snapshot || saving) return false;
    setSaving(true);
    try {
      setSnapshot(
        await invokeDesktop("vocabulary/learning-update", {
          rootGeneration: snapshot.rootGeneration,
          action,
        }),
      );
      setError("");
      return true;
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail.messageKey);
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { snapshot, refresh, update, error, saving };
}
export function VocabularyLearningNotice({
  compact,
  onView,
}: {
  compact: boolean;
  onView: () => void;
}) {
  const { t } = useTranslation();
  const { snapshot } = useVocabularyLearning();
  const count =
    snapshot?.batches.filter((b) => !b.read && !b.undone).reduce((sum, b) => sum + b.added, 0) ?? 0;
  if (!count) return null;
  return (
    <Button
      variant="quiet"
      density="compact"
      className={styles.notice}
      onPress={onView}
      aria-label={t("vocabulary.learning.added", { count })}
    >
      <span role="status">{compact ? `+${count}` : t("vocabulary.learning.badge", { count })}</span>
    </Button>
  );
}
export function VocabularyLearning({
  requestAiAccess,
  onBusyChange,
  dueCount,
  onReview,
  reviewButtonRef,
  refreshLibrary,
  libraryBusy,
  children,
  initialTab,
  viewRequest,
}: {
  requestAiAccess: (
    operation: ProviderOperation,
    previousOperationId?: undefined,
    hasImage?: boolean,
  ) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  dueCount: number | undefined;
  onReview: () => void;
  reviewButtonRef: Ref<HTMLButtonElement>;
  refreshLibrary: () => Promise<unknown>;
  libraryBusy: boolean;
  children: ReactNode;
  initialTab: string;
  viewRequest: number;
}) {
  const { t } = useTranslation();
  const { snapshot, refresh, update, error: readError, saving } = useVocabularyLearning();
  const operation = useLearningOperation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(initialTab);
  const previousViewRequest = useRef(viewRequest);
  useEffect(() => {
    if (viewRequest !== previousViewRequest.current) {
      previousViewRequest.current = viewRequest;
      setTab("learning");
    }
  }, [viewRequest]);
  const [focusId, setFocusId] = useState<string>();
  const [focusTitle, setFocusTitle] = useState("");
  const [focusText, setFocusText] = useState("");
  const focus = snapshot?.focuses.find((f) => f.id === focusId);
  const [wordId, setWordId] = useState<string>();
  const [showAllRecent, setShowAllRecent] = useState(false);
  const batches = snapshot?.batches.filter((b) => !b.undone) ?? [];
  const seen = new Set<string>();
  const recent = batches.flatMap((batch) =>
    batch.words
      .filter((word) => {
        if (!word.added || seen.has(word.vocabularyId)) return false;
        seen.add(word.vocabularyId);
        return true;
      })
      .map((word) => ({ ...word, batch })),
  );
  const selectedWord = recent.find((w) => w.vocabularyId === wordId);

  const [addedBatchId, setAddedBatchId] = useState<string>();
  const addedBatch = snapshot?.batches.find((b) => b.id === addedBatchId && !b.undone);
  const [guidance, setGuidance] = useState("");
  const [text, setText] = useState("");
  const [image, setImage] = useState<{
    mediaType: "image/png" | "image/jpeg" | "image/webp";
    data: string;
  }>();
  const [imageName, setImageName] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const busy = checking || operation.busy;
  useEffect(() => {
    onBusyChange(busy || saving || open || Boolean(focusId) || Boolean(wordId));
    return () => onBusyChange(false);
  }, [busy, saving, open, focusId, wordId, onBusyChange]);
  useEffect(() => {
    if (!addedBatchId) return;
    const timer = window.setTimeout(() => setAddedBatchId(undefined), 8000);
    return () => window.clearTimeout(timer);
  }, [addedBatchId]);
  useEffect(() => {
    if (tab !== "learning") return;
    const added = snapshot?.batches.find((b) => !b.read && !b.undone && b.added > 0);
    if (added) setAddedBatchId(added.id);
    if (snapshot?.batches.some((b) => !b.read)) void update({ kind: "read" });
  }, [snapshot, tab]);
  const acceptImage = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError("vocabulary.learning.imageInvalid");
      return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setImage({ mediaType: file.type as "image/png" | "image/jpeg" | "image/webp", data });
      setImageName(file.name);
    } catch {
      setError("vocabulary.learning.imageInvalid");
    }
  };
  const run = async (activityId?: string) => {
    if (!snapshot || busy) return;
    setChecking(true);
    setError("");
    try {
      if (!(await requestAiAccess("vocabulary-analysis", undefined, !activityId && Boolean(image))))
        return;
      const result = await operation.run({
        kind: "vocabulary-analysis",
        rootGeneration: snapshot.rootGeneration,
        source: activityId
          ? { kind: "activity", activityId: activityId as ActivityId }
          : { kind: "import", guidance, text, ...(image ? { image } : {}) },
      });
      const output = vocabularyAnalysisOutputSchema.parse(result.output);
      if (!output.readable) {
        setError("vocabulary.learning.unreadable");
        return;
      }
      setOpen(false);
      setTab("learning");
      setGuidance("");
      setText("");
      setImage(undefined);
      setImageName("");
      await refresh();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail.messageKey);
    } finally {
      setChecking(false);
    }
  };
  return (
    <Page
      title={t("vocabulary.title")}
      refresh={{
        onRefresh: async () => {
          await Promise.all([refresh(), refreshLibrary()]);
        },
        busy: libraryBusy,
      }}
      actions={
        <Button
          variant="secondary"
          leadingIcon={<BookPlus />}
          isDisabled={busy || !snapshot}
          onPress={() => setOpen(true)}
        >
          {t("vocabulary.learning.addContent")}
        </Button>
      }
    >
      {(error || readError) && !open && !focus && (
        <Feedback tone="error" live="polite">
          {t(error || readError)}
        </Feedback>
      )}
      <Tabs
        label={t("vocabulary.title")}
        selectedKey={tab}
        onSelectionChange={setTab}
        items={[
          {
            id: "learning",
            label: t("vocabulary.learning.tab"),
            children: (
              <div className={styles.overview}>
                <div className={styles.review}>
                  <BookOpen className={styles.reviewIcon} aria-hidden="true" />
                  <div className={styles.reviewText}>
                    <h2>
                      {dueCount === undefined
                        ? t("ui.loading")
                        : dueCount > 0
                          ? t("vocabulary.learning.ready", { count: dueCount })
                          : t("vocabulary.learning.upToDate")}
                    </h2>
                    {!!snapshot?.dueWords.length && (
                      <p lang={snapshot.language}>{snapshot.dueWords.join(" · ")}</p>
                    )}
                  </div>
                  {Boolean(dueCount) && (
                    <Button
                      ref={reviewButtonRef}
                      variant="primary"
                      trailingIcon={<ArrowRight />}
                      isDisabled={libraryBusy || busy}
                      onPress={onReview}
                    >
                      {t("vocabulary.learning.review")}
                    </Button>
                  )}
                </div>
                {addedBatch && (
                  <div className={styles.added} role="status">
                    <span>{t("vocabulary.learning.added", { count: addedBatch.added })}</span>
                    <Button
                      variant="quiet"
                      density="compact"
                      isDisabled={saving}
                      onPress={() => void update({ kind: "undo", batchId: addedBatch.id })}
                    >
                      {t("vocabulary.learning.undo")}
                    </Button>
                  </div>
                )}
                {busy && !open && <OperationProgress progress={operation.progress} />}
                {!snapshot && !readError && <LoadingState live>{t("ui.loading")}</LoadingState>}
                <section aria-labelledby="vocabulary-recent-title">
                  <div className={styles.sectionHeading}>
                    <h2 id="vocabulary-recent-title">{t("vocabulary.learning.recent")}</h2>
                    {recent.length > 3 && (
                      <Button variant="quiet" onPress={() => setShowAllRecent((value) => !value)}>
                        {t(
                          showAllRecent
                            ? "vocabulary.learning.showLess"
                            : "vocabulary.learning.viewAll",
                        )}
                      </Button>
                    )}
                  </div>
                  {snapshot && recent.length === 0 && (
                    <p className={styles.muted}>{t("vocabulary.learning.emptyRecent")}</p>
                  )}
                  {recent.slice(0, showAllRecent ? recent.length : 3).map((word) => (
                    <ContentRow key={word.vocabularyId} density="compact">
                      <div className={styles.wordRow}>
                        <Button
                          variant="quiet"
                          className={styles.wordButton}
                          onPress={() => setWordId(word.vocabularyId)}
                        >
                          <span lang={snapshot?.language}>{word.lemma}</span>
                        </Button>
                        <span>{word.meaning}</span>
                        <span className={styles.source}>
                          {t(`vocabulary.learning.sources.${word.batch.source}`)}
                        </span>
                      </div>
                    </ContentRow>
                  ))}
                </section>
                <section aria-labelledby="vocabulary-focus-title">
                  <div className={styles.sectionHeading}>
                    <h2 id="vocabulary-focus-title">{t("vocabulary.learning.title")}</h2>
                  </div>
                  {snapshot?.focuses.length === 0 && (
                    <p className={styles.muted}>{t("vocabulary.learning.emptyFocus")}</p>
                  )}
                  {snapshot?.focuses.map((item) => (
                    <ContentRow
                      key={item.id}
                      density="compact"
                      leading={<Compass className={styles.focusIcon} aria-hidden="true" />}
                    >
                      <div className={styles.focusRow}>
                        <Button
                          variant="quiet"
                          className={styles.focusButton}
                          onPress={() => {
                            setFocusId(item.id);
                            setFocusTitle(item.title);
                            setFocusText(item.text);
                          }}
                        >
                          {item.title}
                        </Button>
                        <span className={styles.preview} lang={snapshot.language}>
                          {[
                            ...new Set(
                              batches
                                .filter((b) => b.focusId === item.id)
                                .flatMap((b) => b.words.map((w) => w.lemma)),
                            ),
                          ]
                            .slice(0, 3)
                            .join(" · ")}
                        </span>
                        {!item.active && (
                          <span className={styles.source}>{t("vocabulary.learning.paused")}</span>
                        )}
                      </div>
                    </ContentRow>
                  ))}
                </section>
                {!!snapshot?.pendingActivities.length && (
                  <section aria-label={t("vocabulary.learning.pending")}>
                    <h2>{t("vocabulary.learning.pending")}</h2>
                    {snapshot.pendingActivities.map((a) => (
                      <ContentRow
                        key={a.activityId}
                        actions={
                          <Button
                            variant="secondary"
                            isDisabled={busy}
                            onPress={() => void run(a.activityId)}
                          >
                            {t("vocabulary.learning.retry")}
                          </Button>
                        }
                      >
                        {a.title}
                      </ContentRow>
                    ))}
                  </section>
                )}
              </div>
            ),
          },
          { id: "words", label: t("vocabulary.learning.allWords"), children },
        ]}
      />
      {focus && (
        <ModalDialog
          isOpen
          title={focus.title}
          closeLabel={t("actions.close")}
          isDismissable={!saving}
          onOpenChange={(value) => {
            if (!value && !saving) setFocusId(undefined);
          }}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void update({
                kind: "focus",
                focusId: focus.id,
                title: focusTitle,
                text: focusText,
                active: focus.active,
              }).then((saved) => {
                if (saved) setFocusId(undefined);
              });
            }}
          >
            <TextField
              label={t("vocabulary.learning.name")}
              value={focusTitle}
              required
              maxLength={160}
              disabled={saving}
              onChange={(event) => setFocusTitle(event.target.value)}
            />
            {focus.guidance && <p>{focus.guidance}</p>}
            <label>
              {t("vocabulary.learning.source")}
              <textarea
                value={focusText}
                maxLength={12000}
                rows={6}
                disabled={saving}
                onChange={(event) => setFocusText(event.target.value)}
              />
            </label>
            {readError && (
              <Feedback tone="error" live="polite">
                {t(readError)}
              </Feedback>
            )}
            <ActionGroup align="end">
              <Button
                variant="quiet"
                isDisabled={saving}
                onPress={() =>
                  void update({
                    kind: "focus",
                    focusId: focus.id,
                    title: focus.title,
                    text: focus.text,
                    active: !focus.active,
                  })
                }
              >
                {t(focus.active ? "vocabulary.learning.pause" : "vocabulary.learning.resume")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                isPending={saving}
                isDisabled={!focusTitle.trim()}
              >
                {t("vocabulary.learning.save")}
              </Button>
            </ActionGroup>
          </form>
        </ModalDialog>
      )}
      {selectedWord && (
        <ModalDialog
          isOpen
          title={selectedWord.lemma}
          closeLabel={t("actions.close")}
          onOpenChange={(value) => {
            if (!value) setWordId(undefined);
          }}
        >
          <div className={styles.form}>
            {readError && (
              <Feedback tone="error" live="polite">
                {t(readError)}
              </Feedback>
            )}
            <p className={styles.translation}>{selectedWord.meaning}</p>
            {selectedWord.examples.map((example, index) => (
              <div key={index}>
                <p lang={snapshot?.language}>{example.text}</p>
                <p className={styles.muted}>{example.meaning}</p>
              </div>
            ))}
            <div>
              <h3>{t("vocabulary.learning.whyAdded")}</h3>
              <p>{selectedWord.reason}</p>
              <p className={styles.muted}>{selectedWord.batch.title}</p>
            </div>
            <ActionGroup align="end">
              <Button
                variant="quiet"
                isDisabled={saving}
                onPress={() =>
                  void update({ kind: "undo", batchId: selectedWord.batch.id }).then((saved) => {
                    if (saved) setWordId(undefined);
                  })
                }
              >
                {t("vocabulary.learning.undoBatch", { count: selectedWord.batch.added })}
              </Button>
            </ActionGroup>
          </div>
        </ModalDialog>
      )}
      {open && (
        <ModalDialog
          isOpen
          title={t("vocabulary.learning.addContent")}
          isDismissable={!busy}
          onOpenChange={(value) => {
            if (!value && !busy) setOpen(false);
          }}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void acceptImage(event.dataTransfer.files[0]);
            }}
            onPaste={(event) => {
              const file = Array.from(event.clipboardData.files)[0];
              if (file && !busy) {
                event.preventDefault();
                void acceptImage(file);
              }
            }}
          >
            <TextField
              label={t("vocabulary.learning.guidance")}
              value={guidance}
              maxLength={2000}
              disabled={busy}
              onChange={(event) => setGuidance(event.target.value)}
            />
            <label>
              {t("vocabulary.learning.source")}
              <textarea
                rows={7}
                maxLength={12000}
                disabled={busy}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <ProviderActionSummary
              operation="vocabulary-analysis"
              hasImage={Boolean(image)}
              busy={busy}
            />
            <label>
              {t("vocabulary.learning.image")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(event) => void acceptImage(event.target.files?.[0])}
              />
            </label>
            {imageName && (
              <div className={styles.row}>
                <span>{imageName}</span>
                <Button
                  variant="quiet"
                  isDisabled={busy}
                  onPress={() => {
                    setImage(undefined);
                    setImageName("");
                  }}
                >
                  {t("vocabulary.learning.removeImage")}
                </Button>
              </div>
            )}
            {error && (
              <Feedback tone="error" live="polite">
                {t(error)}
              </Feedback>
            )}
            <OperationProgress progress={operation.progress} />
            <ActionGroup align="end">
              <Button
                variant="secondary"
                onPress={() => {
                  if (operation.busy) operation.cancel();
                  else if (!checking) setOpen(false);
                }}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                isDisabled={busy || (!guidance.trim() && !text.trim() && !image)}
                isPending={busy}
              >
                {t("vocabulary.learning.addContent")}
              </Button>
            </ActionGroup>
          </form>
        </ModalDialog>
      )}
    </Page>
  );
}
