import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CallNinaError,
  VocabularyId,
  DataRootGeneration,
  Language,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "./components/layout/index.js";
import {
  Button,
  ConfirmDialog,
  Feedback,
  LoadingState,
  ModalDialog,
  TextField,
} from "./components/ui/index.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import {
  vocabularyVersion,
  type VocabularyEntry,
  type VocabularyBulkAction,
} from "./useVocabularyLibrary.js";
import styles from "./VocabularyPage.module.css";

export function VocabularyInformation({
  entry,
  explanationLanguage,
}: {
  entry: VocabularyEntry;
  explanationLanguage?: Language | undefined;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p lang={explanationLanguage}>{entry.meaning}</p>
      {entry.lexeme.partOfSpeech === "noun" && (
        <p>
          <span lang={entry.targetLanguage}>{entry.lexeme.nounForm.article}</span> ·{" "}
          {t("vocabulary.library.plural")}:{" "}
          {entry.lexeme.plural.status === "form" ? (
            <span lang={entry.targetLanguage}>{entry.lexeme.plural.form}</span>
          ) : (
            t(`vocabulary.library.plurals.${entry.lexeme.plural.status}`)
          )}
        </p>
      )}
      {entry.lexeme.partOfSpeech === "phrase" && (
        <p>
          <span lang={entry.targetLanguage}>{entry.lexeme.function}</span>
          {entry.lexeme.register ? ` · ${t(`vocabulary.register.${entry.lexeme.register}`)}` : ""}
        </p>
      )}
      {entry.lexeme.partOfSpeech === "verb" && entry.lexeme.pattern && (
        <p lang={entry.targetLanguage}>{entry.lexeme.pattern}</p>
      )}
      {entry.examples.map((example, index) => (
        <div key={index}>
          <p lang={entry.targetLanguage}>{example.text}</p>
          <p className={styles.muted} lang={explanationLanguage}>
            {example.meaning}
          </p>
        </div>
      ))}
    </>
  );
}

export function VocabularyDetails(props: {
  explanationLanguage?: Language | undefined;
  vocabularyId: VocabularyId;
  rootGeneration: DataRootGeneration;
  onClose: () => void;
  onChanged: () => void;
  onNavigate: (page: "history" | "practice") => void;
}) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState<VocabularyEntry>();
  const [error, setError] = useState<CallNinaError>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ lemma: "", meaning: "", example: "", exampleMeaning: "" });
  const alive = useRef(true);
  const locked = useRef(false);
  const loadVersion = useRef(0);
  const { vocabularyId, rootGeneration } = props;
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const result = await invokeDesktop("vocabulary/detail", { vocabularyId, rootGeneration });
      if (alive.current && version === loadVersion.current) setEntry(result.entry);
    } catch (cause) {
      if (alive.current && version === loadVersion.current)
        setError(normalizeDesktopError(cause).detail);
    } finally {
      if (alive.current && version === loadVersion.current) setLoading(false);
    }
  }, [vocabularyId, rootGeneration]);
  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      alive.current = false;
      loadVersion.current += 1;
      window.clearTimeout(timer);
    };
  }, [load]);
  const mutate = async (action: () => Promise<unknown>, close = false) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (!alive.current) return;
      props.onChanged();
      if (close) props.onClose();
      else {
        setEditing(false);
        await load();
      }
    } catch (cause) {
      if (alive.current) setError(normalizeDesktopError(cause).detail);
      throw cause;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const bulk = (action: VocabularyBulkAction) =>
    entry &&
    void mutate(() =>
      invokeDesktop("vocabulary/bulk", {
        rootGeneration: props.rootGeneration,
        action,
        entries: [vocabularyVersion(entry)],
      }),
    ).catch(() => undefined);
  const beginEdit = () => {
    if (!entry) return;
    setDraft({
      lemma: entry.lemma,
      meaning: entry.meaning,
      example: entry.examples[0]?.text ?? "",
      exampleMeaning: entry.examples[0]?.meaning ?? "",
    });
    setEditing(true);
  };
  return (
    <ModalDialog
      isOpen
      title={entry?.lemma ?? t("vocabulary.library.details")}
      isDismissable={!busy && !editing}
      onOpenChange={(open) => {
        if (!open && !busy && !editing) props.onClose();
      }}
    >
      {error && (
        <Feedback tone="error" live="assertive">
          {t(error.messageKey)}
        </Feedback>
      )}
      {loading && <LoadingState live>{t("ui.loading")}</LoadingState>}
      {entry && !editing && (
        <>
          <VocabularyInformation entry={entry} explanationLanguage={props.explanationLanguage} />
          <p>{t(`vocabulary.filters.${entry.state.status}`)}</p>
          {entry.state.status !== "candidate" && (
            <>
              <p>{t("vocabulary.due", { date: entry.state.dueOn, stage: entry.state.stage })}</p>
              {entry.state.lastReview && (
                <p>
                  {t("vocabulary.library.lastReview", {
                    date: entry.state.lastReview.reviewedAt.slice(0, 10),
                    grade: t(`vocabulary.grades.${entry.state.lastReview.grade}`),
                  })}
                </p>
              )}
            </>
          )}
          {entry.state.status === "suspended" && (
            <p>
              {t("vocabulary.suspendedState", {
                reason: t(`vocabulary.library.reasons.${entry.state.reason}`),
              })}
            </p>
          )}
          <div>
            <strong>{t("vocabulary.library.source")}</strong>
            <p>{entry.source.context}</p>
          </div>
          <ActionGroup>
            {entry.state.status === "candidate" && (
              <Button
                isDisabled={busy || loading}
                onPress={() => {
                  bulk("confirm");
                }}
              >
                {t("vocabulary.confirm")}
              </Button>
            )}
            {entry.state.status === "active" && (
              <Button
                variant="secondary"
                isDisabled={busy || loading}
                onPress={() => {
                  bulk("suspend");
                }}
              >
                {t("vocabulary.suspend")}
              </Button>
            )}
            {entry.state.status === "suspended" && (
              <Button
                isDisabled={busy || loading}
                onPress={() => {
                  bulk("resume");
                }}
              >
                {t("vocabulary.resume")}
              </Button>
            )}
            <Button variant="secondary" isDisabled={busy || loading} onPress={beginEdit}>
              {t("vocabulary.edit")}
            </Button>
            {(entry.source.kind === "activity" || entry.source.kind === "correction") && (
              <Button
                variant="quiet"
                isDisabled={busy}
                onPress={() => {
                  props.onClose();
                  props.onNavigate(entry.source.kind === "activity" ? "practice" : "history");
                }}
              >
                {t("vocabulary.openSource")}
              </Button>
            )}
            {
              <ConfirmDialog
                triggerNode={
                  <Button variant="quiet" isDisabled={busy || loading}>
                    {t("vocabulary.delete")}
                  </Button>
                }
                trigger={t("vocabulary.delete")}
                triggerVariant="quiet"
                title={t("ui.deleteWord", { word: entry.lemma })}
                body={t("vocabulary.deleteConfirm")}
                confirm={t("vocabulary.delete")}
                cancel={t("actions.cancel")}
                errorMessage={t("ui.actionFailed")}
                onConfirm={() =>
                  mutate(
                    () =>
                      invokeDesktop("vocabulary/delete", {
                        vocabularyId: entry.vocabularyId,
                        rootGeneration: props.rootGeneration,
                      }),
                    true,
                  )
                }
              />
            }
          </ActionGroup>
        </>
      )}
      {entry && editing && (
        <form
          className={styles.editForm}
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(() =>
              invokeDesktop("vocabulary/edit", {
                rootGeneration: props.rootGeneration,
                ...vocabularyVersion(entry),
                ...draft,
              }),
            ).catch(() => undefined);
          }}
        >
          {(["lemma", "meaning", "example", "exampleMeaning"] as const).map((field) => (
            <TextField
              key={field}
              label={t(`vocabulary.${field}`)}
              value={draft[field]}
              required
              maxLength={field === "lemma" ? 160 : 500}
              disabled={busy}
              onChange={(event) => {
                setDraft((previous) => ({ ...previous, [field]: event.target.value }));
              }}
            />
          ))}
          <ActionGroup>
            <Button
              type="submit"
              isPending={busy}
              isDisabled={loading || Object.values(draft).some((value) => !value.trim())}
            >
              {t("vocabulary.save")}
            </Button>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => {
                setEditing(false);
              }}
            >
              {t("actions.cancel")}
            </Button>
          </ActionGroup>
        </form>
      )}
      {error && (
        <Button
          variant="secondary"
          isDisabled={busy || loading}
          onPress={() => {
            setError(undefined);
            void load();
          }}
        >
          {t("vocabulary.library.reloadDetails")}
        </Button>
      )}
      {!editing && (
        <Button variant="secondary" isDisabled={busy} onPress={props.onClose}>
          {t("vocabulary.library.close")}
        </Button>
      )}
    </ModalDialog>
  );
}
