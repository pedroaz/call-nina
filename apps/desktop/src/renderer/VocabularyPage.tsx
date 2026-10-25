import { useEffect, useRef, useState } from "react";
import type {
  ActivityId,
  CallNinaError,
  Language,
  ProviderOperation,
  VocabularyId,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import {
  Button,
  Feedback,
  LoadingState,
  TextField,
  SelectField,
  ToggleButtonGroup,
} from "./components/ui/index.js";
import { ActionGroup, Page } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import {
  useVocabularyLibrary,
  vocabularyVersion,
  type VocabularyBulkAction,
  type VocabularyFilter,
  type VocabularySummary,
} from "./useVocabularyLibrary.js";
import { VocabularyGenerator } from "./VocabularyGenerator.js";
import { VocabularyDetails } from "./VocabularyDetails.js";
import { VocabularyLessonSets } from "./VocabularyLessonSets.js";
import { VocabularyReview } from "./VocabularyReview.js";
import styles from "./VocabularyPage.module.css";

type Props = Readonly<{
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  targetLanguage?: Language | undefined;
  initialDueOnly?: boolean;
  onOpenActivity: (activityId: ActivityId) => void;
  onNavigate: (page: "history" | "practice") => void;
}>;

export function VocabularyPage({
  targetLanguage,
  initialDueOnly = false,
  onNavigate,
  onOpenActivity,
  requestAiAccess,
}: Props) {
  const library = useVocabularyLibrary(initialDueOnly);
  return (
    <VocabularyWorkspace
      key={library.rootGeneration ?? "unconfigured"}
      library={library}
      targetLanguage={targetLanguage}
      onNavigate={onNavigate}
      onOpenActivity={onOpenActivity}
      requestAiAccess={requestAiAccess}
    />
  );
}

function VocabularyWorkspace({
  library,
  targetLanguage,
  onNavigate,
  onOpenActivity,
  requestAiAccess,
}: {
  library: ReturnType<typeof useVocabularyLibrary>;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  targetLanguage?: Language | undefined;
  onNavigate: Props["onNavigate"];
  onOpenActivity: Props["onOpenActivity"];
}) {
  const { t } = useTranslation();
  const { result, query } = library;
  const [search, setSearch] = useState(query.search);
  const [selection, setSelected] = useState<VocabularySummary[]>([]);
  const [detailId, setDetailId] = useState<VocabularyId>();
  const [reviewing, setReviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const [notice, setNotice] = useState("");
  const operation = useRef(0);
  const locked = useRef(false);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const wordButtons = useRef(new Map<VocabularyId, HTMLButtonElement>());
  const restoreWord = useRef<VocabularyId | undefined>(undefined);
  const libraryScroll = useRef(0);
  const restoreReview = useRef(false);
  const tableCaption = useRef<HTMLTableCaptionElement>(null);
  useEffect(() => {
    if (!restoreReview.current || reviewing || library.busy) return;
    const target =
      reviewButton.current && !reviewButton.current.disabled
        ? reviewButton.current
        : tableCaption.current;
    target?.focus({ preventScroll: true });
    window.scrollTo({ top: libraryScroll.current });
    restoreReview.current = false;
  }, [reviewing, library.busy, result]);
  useEffect(() => {
    if (detailId || !restoreWord.current || library.busy) return;
    const target = wordButtons.current.get(restoreWord.current) ?? tableCaption.current;
    target?.focus({ preventScroll: true });
    restoreWord.current = undefined;
  }, [detailId, library.busy, result]);
  const rows = result?.entries ?? [];
  // Only unchanged records on the visible page remain selected after invalidation.
  const selected = selection.filter((saved) =>
    rows.some(
      (row) =>
        row.vocabularyId === saved.vocabularyId &&
        row.revision === saved.revision &&
        row.updatedAt === saved.updatedAt &&
        row.status === saved.status,
    ),
  );
  const selectedIds = new Set(selected.map((entry) => entry.vocabularyId));
  const allSelected = rows.length > 0 && rows.every((entry) => selectedIds.has(entry.vocabularyId));
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && !allSelected;
  }, [selected, allSelected]);
  const changeLibraryQuery = library.changeQuery;
  useEffect(() => {
    if (search === query.search) return;
    const timer = window.setTimeout(() => {
      setSelected([]);
      changeLibraryQuery({ search, page: 0 });
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [search, query.search, changeLibraryQuery]);
  useEffect(() => {
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        operation.current += 1;
        locked.current = false;
        restoreWord.current = undefined;
        restoreReview.current = false;
        setBusy(false);
        setSelected([]);
        setDetailId(undefined);
        setReviewing(false);
        setCreating(false);
        setError(undefined);
        setNotice("");
      }
    });
    return () => {
      operation.current += 1;
      unsubscribe();
    };
  }, []);
  const changeQuery = (patch: Partial<VocabularyFilter>) => {
    setSelected([]);
    setError(undefined);
    library.changeQuery(patch);
  };
  const mutate = async (action: () => Promise<unknown>, after?: () => void) => {
    if (locked.current) return;
    locked.current = true;
    const current = operation.current;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await action();
      if (current !== operation.current) return;
      setSelected([]);
      after?.();
      await library.refresh();
    } catch (cause) {
      if (current === operation.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === operation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const studyFlashcards = async () => {
    if (!result || locked.current || selected.length < 3 || selected.length > 30) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const deck = await invokeDesktop("flashcards/create", {
        rootGeneration: result.rootGeneration,
        title: t("flashcards.vocabularyDeck"),
        entries: selected.map(vocabularyVersion),
      });
      onOpenActivity(deck.activityId);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const bulk = (action: VocabularyBulkAction) =>
    result &&
    void mutate(() =>
      invokeDesktop("vocabulary/bulk", {
        rootGeneration: result.rootGeneration,
        action,
        entries: selected.map(vocabularyVersion),
      }),
    );
  const canBulk = (status: VocabularySummary["status"]) =>
    selected.length > 0 &&
    selected.every((entry) => entry.status === status) &&
    !busy &&
    !library.busy;
  const changed = () => {
    setSelected([]);
    void library.refresh();
  };
  const nextReview = (entry: VocabularySummary) =>
    entry.status === "candidate"
      ? t("vocabulary.library.notScheduled")
      : entry.status === "suspended"
        ? t("vocabulary.filters.suspended")
        : entry.dueOn;
  const waiting = busy || library.busy || search !== query.search;
  const visibleError = error ?? library.error;

  return (
    <>
      {reviewing && result && (
        <VocabularyReview
          key={result.rootGeneration}
          rootGeneration={result.rootGeneration}
          onChanged={changed}
          onExit={() => {
            restoreReview.current = true;
            setReviewing(false);
            changed();
          }}
        />
      )}
      <div hidden={reviewing}>
        <Page
          title={t("vocabulary.title")}
          refresh={{ onRefresh: library.refresh, busy: waiting }}
          actions={
            result &&
            result.counts.all > 0 && (
              <ActionGroup>
                <Button
                  ref={reviewButton}
                  isDisabled={waiting || !result.counts.due}
                  onPress={() => {
                    setError(undefined);
                    libraryScroll.current = window.scrollY;
                    setReviewing(true);
                  }}
                >
                  {t("vocabulary.library.reviewDue", { count: result.counts.due })}
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => {
                    setError(undefined);
                    setCreating(true);
                  }}
                >
                  {t("vocabulary.flow.generate")}
                </Button>
              </ActionGroup>
            )
          }
        >
          {visibleError && (
            <Feedback tone="error" live="assertive">
              {t(visibleError.messageKey)}
            </Feedback>
          )}
          {notice && (
            <Feedback tone="success" live="polite">
              {notice}
            </Feedback>
          )}
          <p className={styles.muted}>{t("vocabulary.flow.intro")}</p>
          {result && result.counts.all === 0 && !library.busy && (
            <section className={styles.welcome}>
              <h2>{t("vocabulary.flow.emptyTitle")}</h2>
              <p>{t("vocabulary.flow.previewHint")}</p>
              <p>{t("vocabulary.flow.exerciseSources")}</p>
              <ActionGroup>
                <Button
                  onPress={() => {
                    setCreating(true);
                  }}
                >
                  {t("vocabulary.flow.generate")}
                </Button>
              </ActionGroup>
            </section>
          )}
          {result && result.counts.candidate > 0 && (
            <Feedback live="polite">
              {t("vocabulary.flow.suggestions", { count: result.counts.candidate })}
            </Feedback>
          )}
          {result && (
            <>
              <div className={styles.toolbar}>
                <TextField
                  label={t("vocabulary.library.search")}
                  type="search"
                  maxLength={500}
                  value={search}
                  onChange={(event) => {
                    setSelected([]);
                    setSearch(event.target.value);
                  }}
                />
                <SelectField
                  label={t("vocabulary.library.sort")}
                  value={query.sort}
                  onChange={(event) => {
                    changeQuery({ sort: event.target.value as VocabularyFilter["sort"], page: 0 });
                  }}
                >
                  <option value="word">{t("vocabulary.library.sortWord")}</option>
                  <option value="due">{t("vocabulary.library.sortDue")}</option>
                </SelectField>
              </div>
              <ToggleButtonGroup label={t("vocabulary.filtersLabel")}>
                {(["all", "candidate", "due", "active", "suspended"] as const).map((filter) => (
                  <Button
                    key={filter}
                    aria-pressed={query.filter === filter}
                    onPress={() => {
                      changeQuery({ filter, page: 0 });
                    }}
                  >
                    {t(`vocabulary.filters.${filter}`)} ({result.counts[filter]})
                  </Button>
                ))}
              </ToggleButtonGroup>
              {selected.length > 0 && (
                <ActionGroup>
                  <span>{t("vocabulary.library.selected", { count: selected.length })}</span>
                  <Button
                    isDisabled={waiting || selected.length < 3 || selected.length > 30}
                    onPress={() => void studyFlashcards()}
                  >
                    {t("flashcards.study")}
                  </Button>
                  {selected.length < 3 && <span>{t("flashcards.selectRange")}</span>}
                  <Button
                    isDisabled={!canBulk("candidate")}
                    onPress={() => {
                      bulk("confirm");
                    }}
                  >
                    {t("vocabulary.confirm")}
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={!canBulk("active")}
                    onPress={() => {
                      bulk("suspend");
                    }}
                  >
                    {t("vocabulary.suspend")}
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={!canBulk("suspended")}
                    onPress={() => {
                      bulk("resume");
                    }}
                  >
                    {t("vocabulary.resume")}
                  </Button>
                  <Button
                    variant="quiet"
                    isDisabled={busy}
                    onPress={() => {
                      setSelected([]);
                    }}
                  >
                    {t("vocabulary.library.clearSelection")}
                  </Button>
                </ActionGroup>
              )}
            </>
          )}
          {library.busy && <LoadingState live>{t("ui.loading")}</LoadingState>}
          {result && (
            <>
              <div className={styles.tableRegion} aria-busy={waiting}>
                <table className={styles.table}>
                  <caption ref={tableCaption} tabIndex={-1} className={styles.caption}>
                    {t("vocabulary.library.resultCount", { count: result.total })}
                  </caption>
                  <thead>
                    <tr>
                      <th className={styles.selection}>
                        <input
                          ref={selectAll}
                          type="checkbox"
                          aria-label={t("vocabulary.library.selectPage")}
                          checked={allSelected}
                          disabled={waiting || !rows.length}
                          onChange={(event) => {
                            setSelected(event.target.checked ? [...rows] : []);
                          }}
                        />
                      </th>
                      <th scope="col">{t("vocabulary.lemma")}</th>
                      <th scope="col" className={styles.meaningColumn}>
                        {t("vocabulary.meaning")}
                      </th>
                      <th scope="col">{t("vocabulary.library.status")}</th>
                      <th scope="col" className={styles.dueColumn}>
                        {t("vocabulary.library.nextReview")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry) => (
                      <tr key={entry.vocabularyId}>
                        <td className={styles.selection}>
                          <input
                            type="checkbox"
                            aria-label={t("vocabulary.library.selectWord", { word: entry.lemma })}
                            checked={selectedIds.has(entry.vocabularyId)}
                            disabled={waiting}
                            onChange={(event) => {
                              setSelected((previous) =>
                                event.target.checked
                                  ? [...previous, entry]
                                  : previous.filter(
                                      (item) => item.vocabularyId !== entry.vocabularyId,
                                    ),
                              );
                            }}
                          />
                        </td>
                        <td>
                          <Button
                            variant="quiet"
                            className={styles.word}
                            ref={(node) => {
                              if (node) wordButtons.current.set(entry.vocabularyId, node);
                              else wordButtons.current.delete(entry.vocabularyId);
                            }}
                            isDisabled={waiting}
                            onPress={() => {
                              restoreWord.current = entry.vocabularyId;
                              setDetailId(entry.vocabularyId);
                            }}
                          >
                            <span lang={targetLanguage}>{entry.lemma}</span>
                          </Button>
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
                          <span>{t(`vocabulary.filters.${entry.status}`)}</span>
                          <span className={styles.compactDue}>{nextReview(entry)}</span>
                        </td>
                        <td className={styles.dueColumn}>{nextReview(entry)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && (
                  <div className={styles.empty}>
                    <p>
                      {t(
                        result.counts.all
                          ? "vocabulary.library.noMatches"
                          : "vocabulary.flow.emptyLibrary",
                      )}
                    </p>
                    {result.counts.all > 0 && (
                      <Button
                        variant="secondary"
                        onPress={() => {
                          setSearch("");
                          changeQuery({ search: "", filter: "all", page: 0 });
                        }}
                      >
                        {t("vocabulary.flow.clearFilters")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {result.total > 30 && (
                <ActionGroup>
                  <Button
                    variant="secondary"
                    isDisabled={waiting || result.page === 0}
                    onPress={() => {
                      changeQuery({ page: result.page - 1 });
                    }}
                  >
                    {t("vocabulary.library.previous")}
                  </Button>
                  <span aria-live="polite">
                    {t("vocabulary.library.page", {
                      page: result.page + 1,
                      total: Math.max(1, Math.ceil(result.total / 30)),
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    isDisabled={waiting || (result.page + 1) * 30 >= result.total}
                    onPress={() => {
                      changeQuery({ page: result.page + 1 });
                    }}
                  >
                    {t("vocabulary.library.next")}
                  </Button>
                </ActionGroup>
              )}
            </>
          )}
          {result && <VocabularyLessonSets rootGeneration={result.rootGeneration} />}
        </Page>
      </div>
      {detailId && result && (
        <VocabularyDetails
          key={`${String(result.rootGeneration)}:${detailId}`}
          vocabularyId={detailId}
          rootGeneration={result.rootGeneration}
          onClose={() => {
            setDetailId(undefined);
          }}
          onChanged={changed}
          onNavigate={onNavigate}
        />
      )}
      {creating && result && (
        <VocabularyGenerator
          onClose={() => {
            setCreating(false);
          }}
          onOpenActivity={onOpenActivity}
          requestAiAccess={requestAiAccess}
        />
      )}
    </>
  );
}
