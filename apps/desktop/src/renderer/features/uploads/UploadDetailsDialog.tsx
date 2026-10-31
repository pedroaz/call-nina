import { type UploadDraft } from "@call-nina/contracts";
import { Pencil } from "lucide-react";
import { ActionGroup } from "../../components/layout/index.js";
import { Button, Feedback, IconButton, ModalDialog, TextField } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { OperationProgress } from "../../learning/operations/OperationProgress.js";
import { UploadStudyItems } from "../../learning/uploads/UploadStudyItems.js";
import { UploadPreview, uploadReference as reference } from "../../learning/uploads/useUploads.js";
import { createDesktopSubmissionId, invokeDesktop } from "../../runtime/ipc.js";
import styles from "./UploadsLibrary.module.css";
import { type useUploadsLibraryController } from "./useUploadsLibraryController.js";

export function UploadDetailsDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useUploadsLibraryController>,
    | "editor"
    | "working"
    | "selected"
    | "t"
    | "setRenaming"
    | "setSelected"
    | "renaming"
    | "safely"
    | "scopeRef"
    | "scope"
    | "saveSubmission"
    | "snapshot"
    | "setAnalyses"
    | "setSavedWords"
    | "library"
    | "rememberDraft"
    | "setEditing"
    | "setWebsitePreview"
    | "websiteDraftCache"
    | "setDraft"
    | "draftCache"
    | "setOriginal"
    | "setEditor"
    | "analyse"
    | "onPractise"
    | "operation"
    | "error"
    | "message"
    | "proposal"
    | "positions"
    | "setPositions"
    | "savedWords"
    | "setWordId"
  >;
}) {
  const {
    editor,
    working,
    selected,
    t,
    setRenaming,
    setSelected,
    renaming,
    safely,
    scopeRef,
    scope,
    saveSubmission,
    snapshot,
    setAnalyses,
    setSavedWords,
    library,
    rememberDraft,
    setEditing,
    setWebsitePreview,
    websiteDraftCache,
    setDraft,
    draftCache,
    setOriginal,
    setEditor,
    analyse,
    onPractise,
    operation,
    error,
    message,
    proposal,
    positions,
    setPositions,
    savedWords,
    setWordId,
  } = model;
  if (!selected) return null;
  if (!snapshot) return null;
  return (
    <ModalDialog
      isOpen={!editor}
      isDismissable={!working}
      title={selected.title}
      titleAction={
        <IconButton
          variant="quiet"
          label={t("uploads.rename")}
          leadingIcon={<Pencil aria-hidden="true" />}
          isDisabled={working || selected.archived}
          onPress={() => {
            setRenaming({ revisionId: selected.revisionId, title: selected.title });
          }}
        />
      }
      closeLabel={t("actions.close")}
      onOpenChange={(v) => {
        if (!v && !working) setSelected(undefined);
      }}
    >
      {renaming?.revisionId === selected.revisionId && (
        <form
          className={styles.preview}
          onSubmit={(event) => {
            event.preventDefault();
            if (!renaming.title.trim() || renaming.title.trim() === selected.title) return;
            void safely(async () => {
              const captured = scopeRef.current;
              const draft: UploadDraft = {
                format: selected.format,
                title: renaming.title,
                text: selected.text,
                ...(selected.url ? { url: selected.url } : {}),
              };
              const fingerprint = JSON.stringify({
                draft,
                previous: selected.revisionId,
                scope,
              });
              if (saveSubmission.current?.fingerprint !== fingerprint)
                saveSubmission.current = { fingerprint, id: createDesktopSubmissionId() };
              const result = await invokeDesktop("uploads/save", {
                saveId: saveSubmission.current.id,
                rootGeneration: snapshot.rootGeneration,
                language: snapshot.language,
                previous: reference(selected),
                draft,
              });
              if (captured !== scopeRef.current) return;
              setSelected(result.upload);
              setRenaming(undefined);
              setAnalyses([]);
              const detail = await invokeDesktop("uploads/read", {
                rootGeneration: snapshot.rootGeneration,
                reference: reference(result.upload),
              });
              if (captured !== scopeRef.current) return;
              setSavedWords(detail.words);
              await library.refresh();
            });
          }}
        >
          <TextField
            label={t("uploads.title")}
            value={renaming.title}
            maxLength={160}
            required
            disabled={working}
            onChange={(event) => {
              setRenaming({ ...renaming, title: event.target.value });
            }}
          />
          <ActionGroup align="end">
            <Button
              variant="secondary"
              isDisabled={working}
              onPress={() => {
                setRenaming(undefined);
              }}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              isPending={working}
              isDisabled={!renaming.title.trim() || renaming.title.trim() === selected.title}
            >
              {t("vocabulary.learning.save")}
            </Button>
          </ActionGroup>
        </form>
      )}
      <UploadPreview upload={selected} rootGeneration={snapshot.rootGeneration} />
      <ActionGroup>
        <Button
          variant="secondary"
          isDisabled={working || selected.archived}
          onPress={() => {
            rememberDraft();
            setEditing(selected);
            setWebsitePreview(websiteDraftCache.current.get(selected.revisionId));
            setDraft(
              draftCache.current.get(selected.revisionId) ?? {
                format: selected.format,
                title: selected.title,
                text: selected.text,
                ...(selected.url ? { url: selected.url } : {}),
              },
            );
            setOriginal(undefined);
            if (selected.image)
              void safely(async () => {
                const image = await invokeDesktop("uploads/image", {
                  rootGeneration: snapshot.rootGeneration,
                  reference: reference(selected),
                });
                if (image.image) setOriginal(image.image);
              });
            setEditor(true);
          }}
        >
          {t("uploads.edit")}
        </Button>
        <Button
          variant="secondary"
          isPending={working}
          isDisabled={selected.archived}
          onPress={() => void analyse()}
        >
          {t("uploads.extract")}
        </Button>
        <Button
          variant="primary"
          isDisabled={!selected.hasText || selected.archived || working}
          onPress={() => {
            setSelected(undefined);
            onPractise({
              kind: "upload",
              reference: reference(selected),
              rootGeneration: snapshot.rootGeneration,
            });
          }}
        >
          {t("uploads.practise")}
        </Button>
      </ActionGroup>
      {!selected.hasText && <Feedback live="polite">{t("uploads.textRequired")}</Feedback>}
      <OperationProgress progress={operation.progress} />
      {operation.busy && (
        <Button variant="secondary" onPress={operation.cancel}>
          {t("actions.cancel")}
        </Button>
      )}
      {error && <OperationError error={error} />}{" "}
      {message && (
        <Feedback live="polite" tone="error">
          {t(message)}
        </Feedback>
      )}
      {proposal && (
        <section className={styles.proposals}>
          <h3>{t("uploads.proposals")}</h3>
          {proposal.output.words.map((word, i) => (
            <label key={i} className={styles.proposal}>
              <input
                type="checkbox"
                checked={positions.includes(i)}
                disabled={working}
                onChange={(e) => {
                  setPositions((p) => (e.target.checked ? [...p, i] : p.filter((n) => n !== i)));
                }}
              />
              <span>
                <strong>{word.lemma}</strong> · {word.meaning}
                {word.examples.map((example, n) => (
                  <p key={n} lang={selected.language}>
                    {example.text}
                  </p>
                ))}
              </span>
            </label>
          ))}
          <Button
            variant="primary"
            isDisabled={working || !positions.length}
            onPress={() =>
              void safely(async () => {
                await invokeDesktop("uploads/commit", {
                  rootGeneration: snapshot.rootGeneration,
                  analysisId: proposal.analysisId,
                  positions,
                });
                setAnalyses([]);
                setPositions([]);
                const updated = await invokeDesktop("uploads/read", {
                  rootGeneration: snapshot.rootGeneration,
                  reference: reference(selected),
                });
                setSelected(updated.upload);
                setSavedWords(updated.words);
                await library.refresh();
              })
            }
          >
            {t("uploads.saveSelected", { count: positions.length })}
          </Button>
        </section>
      )}
      <UploadStudyItems
        items={selected.items}
        language={selected.language}
        sourceFormat={selected.format}
      />
      {!!savedWords.length && (
        <section>
          <h3>{t("uploads.extractedWords")}</h3>
          {savedWords.map((word) => (
            <Button
              key={word.vocabularyId}
              variant="quiet"
              onPress={() => {
                setWordId(word.vocabularyId);
              }}
            >
              {word.lemma} · {word.meaning}
            </Button>
          ))}
        </section>
      )}
      <Button
        variant="danger"
        isDisabled={working || selected.archived}
        onPress={() =>
          void safely(async () => {
            await invokeDesktop("uploads/archive", {
              rootGeneration: snapshot.rootGeneration,
              reference: reference(selected),
            });
            setSelected(undefined);
            await library.refresh();
          })
        }
      >
        {t("uploads.remove")}
      </Button>
    </ModalDialog>
  );
}
