import { materialSourceSchema, websiteStudyPackOutputSchema } from "@call-nina/contracts";
import { ImagePlus, ScanText } from "lucide-react";
import { ActionGroup } from "../../components/layout/index.js";
import {
  Button,
  Feedback,
  FileTrigger,
  LoadingState,
  ModalDialog,
  TextAreaField,
  TextField,
  ToggleButtonGroup,
} from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { OperationProgress } from "../../learning/operations/OperationProgress.js";
import { UploadStudyItems } from "../../learning/uploads/UploadStudyItems.js";
import { uploadReference as reference } from "../../learning/uploads/useUploads.js";
import { createDesktopSubmissionId, invokeDesktop } from "../../runtime/ipc.js";
import { useOpenProviderSettings } from "../../runtime/navigation-context.js";
import styles from "./UploadsLibrary.module.css";
import { type useUploadsLibraryController } from "./useUploadsLibraryController.js";

export function UploadEditorDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useUploadsLibraryController>,
    | "editor"
    | "working"
    | "t"
    | "editing"
    | "setEditor"
    | "draft"
    | "setImageAccess"
    | "setError"
    | "setImportAccessError"
    | "setMessage"
    | "formatDrafts"
    | "formatWebsitePreview"
    | "websitePreview"
    | "setWebsitePreview"
    | "setOriginal"
    | "setTruncated"
    | "setDraft"
    | "snapshot"
    | "safely"
    | "checkImportAccess"
    | "scopeRef"
    | "readingId"
    | "setReadingWebsite"
    | "operation"
    | "imageAccess"
    | "rememberDraft"
    | "original"
    | "acceptImage"
    | "analyse"
    | "importAccessError"
    | "truncated"
    | "error"
    | "message"
    | "readingWebsite"
    | "cancelWebsite"
    | "scope"
    | "saveSubmission"
    | "setSelected"
    | "draftCache"
    | "websiteDraftCache"
    | "setSavedWords"
    | "setEditing"
    | "setAnalyses"
    | "library"
  >;
}) {
  const openProviderSettings = useOpenProviderSettings();
  const {
    editor,
    working,
    t,
    editing,
    setEditor,
    draft,
    setImageAccess,
    setError,
    setImportAccessError,
    setMessage,
    formatDrafts,
    formatWebsitePreview,
    websitePreview,
    setWebsitePreview,
    setOriginal,
    setTruncated,
    setDraft,
    snapshot,
    safely,
    checkImportAccess,
    scopeRef,
    readingId,
    setReadingWebsite,
    operation,
    imageAccess,
    rememberDraft,
    original,
    acceptImage,
    analyse,
    importAccessError,
    truncated,
    error,
    message,
    readingWebsite,
    cancelWebsite,
    scope,
    saveSubmission,
    setSelected,
    draftCache,
    websiteDraftCache,
    setSavedWords,
    setEditing,
    setAnalyses,
    library,
  } = model;
  return (
    <ModalDialog
      isOpen={editor}
      size="form"
      isDismissable={!working}
      title={t(editing ? "uploads.edit" : "uploads.add")}
      closeLabel={t("actions.close")}
      onOpenChange={setEditor}
    >
      <div className={styles.form}>
        {!editing && (
          <ToggleButtonGroup label={t("uploads.format")}>
            {(["text", "website", "image"] as const).map((format) => (
              <Button
                key={format}
                variant="secondary"
                aria-pressed={draft.format === format}
                isDisabled={working}
                onPress={() => {
                  if (draft.format === format) return;
                  if (format === "image") setImageAccess("checking");
                  setError(undefined);
                  setImportAccessError(undefined);
                  setMessage("");
                  formatDrafts.current.set(draft.format, draft);
                  if (draft.format === "website") formatWebsitePreview.current = websitePreview;
                  const next = formatDrafts.current.get(format) ?? {
                    format,
                    title: "",
                    text: "",
                  };
                  setWebsitePreview(
                    format === "website" ? formatWebsitePreview.current : undefined,
                  );
                  setOriginal(next.image);
                  setTruncated(false);
                  setDraft(next);
                }}
              >
                {t(`uploads.formats.${format}`)}
              </Button>
            ))}
          </ToggleButtonGroup>
        )}
        {draft.format === "website" && (
          <>
            <TextField
              disabled={working}
              label={t("uploads.url")}
              type="url"
              value={draft.url ?? ""}
              maxLength={2000}
              onChange={(e) => {
                setWebsitePreview(undefined);
                setTruncated(false);
                setDraft((d) => ({ ...d, url: e.target.value, text: "", title: "" }));
              }}
            />
            <Button
              variant="secondary"
              isPending={working}
              className={styles.sourceAction}
              isDisabled={!draft.url || !snapshot}
              onPress={() =>
                void safely(async () => {
                  if (!snapshot) return;
                  const parsedUrl = materialSourceSchema.shape.url.safeParse(draft.url);
                  if (!parsedUrl.success) {
                    setMessage("uploads.websiteInvalid");
                    return;
                  }
                  if (!(await checkImportAccess("website-study-pack"))) return;
                  const captured = scopeRef.current;
                  const importId = createDesktopSubmissionId();
                  readingId.current = importId;
                  setReadingWebsite(true);
                  try {
                    const capture = await invokeDesktop("material/import-web", {
                      rootGeneration: snapshot.rootGeneration,
                      language: snapshot.language,
                      url: parsedUrl.data,
                      importId,
                    });
                    if (captured !== scopeRef.current || readingId.current !== importId) return;
                    readingId.current = undefined;
                    setReadingWebsite(false);
                    const result = await operation.run({
                      kind: "website-study-pack",
                      rootGeneration: snapshot.rootGeneration,
                      captureId: capture.captureId,
                    });
                    if (captured !== scopeRef.current) return;
                    const output = websiteStudyPackOutputSchema.parse(result.output);
                    setWebsitePreview({
                      operationId: result.operationId,
                      source: capture.source,
                      output,
                      positions: output.items.map((_, i) => i),
                    });
                    setDraft((d) => ({
                      ...d,
                      title: output.title,
                      text: output.summary,
                      url: capture.source.url,
                    }));
                    setTruncated(capture.source.truncated);
                  } finally {
                    if (captured === scopeRef.current) {
                      readingId.current = undefined;
                      setReadingWebsite(false);
                    }
                  }
                })
              }
            >
              {t("uploads.import")}
            </Button>
          </>
        )}
        {draft.format === "image" &&
          imageAccess !== "available" &&
          (imageAccess === "checking" ? (
            <LoadingState>{t("providers.checkingConnection")}</LoadingState>
          ) : (
            <div className={styles.imageInput}>
              <p>{t("uploads.configureImageReading")}</p>
              <Button
                variant="primary"
                className={styles.sourceAction}
                onPress={() => {
                  rememberDraft();
                  setEditor(false);
                  openProviderSettings();
                }}
              >
                {t("uploads.configureNow")}
              </Button>
            </div>
          ))}
        {draft.format === "image" && imageAccess === "available" && (
          <div className={styles.imageInput}>
            {original && (
              <img
                className={styles.image}
                src={`data:${original.mediaType};base64,${original.data}`}
                alt={draft.title}
              />
            )}
            <ActionGroup {...(!original ? { className: styles.imageChooser } : {})}>
              <FileTrigger
                acceptedFileTypes={["image/png", "image/jpeg", "image/webp"]}
                onSelect={(files) => {
                  const file = files?.[0];
                  if (file) void safely(() => acceptImage(file));
                }}
              >
                <Button
                  variant="secondary"
                  {...(!original ? { className: styles.chooseImage } : {})}
                  leadingIcon={<ImagePlus aria-hidden="true" />}
                  isDisabled={working}
                >
                  {t(original || editing?.image ? "uploads.replaceImage" : "uploads.chooseImage")}
                </Button>
              </FileTrigger>
              {original && (
                <Button
                  variant="primary"
                  leadingIcon={<ScanText aria-hidden="true" />}
                  isDisabled={working}
                  onPress={() => {
                    void analyse(true);
                  }}
                >
                  {t("uploads.readImage")}
                </Button>
              )}
            </ActionGroup>
          </div>
        )}
        {importAccessError && (
          <span className={styles.importError} role="alert">
            {t(importAccessError)}
          </span>
        )}
        {(draft.format === "text" ||
          (draft.format === "image" &&
            imageAccess === "available" &&
            Boolean(original || editing?.image)) ||
          (draft.format === "website" && Boolean(websitePreview || editing))) && (
          <>
            <TextField
              disabled={working}
              label={t("uploads.title")}
              value={draft.title}
              maxLength={160}
              onChange={(e) => {
                setDraft((d) => ({ ...d, title: e.target.value }));
              }}
            />
            <TextAreaField
              disabled={working}
              label={t(draft.format === "website" ? "uploads.summary" : "uploads.text")}
              value={draft.text}
              rows={6}
              onChange={(e) => {
                setDraft((d) => ({ ...d, text: e.target.value }));
                setMessage(e.target.value.length > 12000 ? "uploads.textLimit" : "");
              }}
            />
            <span className={styles.meta}>{draft.text.length.toLocaleString()} / 12,000</span>
          </>
        )}
        {websitePreview && snapshot && (
          <>
            <UploadStudyItems
              items={websitePreview.output.items}
              language={snapshot.language}
              positions={websitePreview.positions}
              disabled={working}
              onSelectionChange={(positions) => {
                setWebsitePreview((p) => (p ? { ...p, positions } : p));
              }}
            />
            <details className={styles.secondary}>
              <summary>{t("uploads.originalText")}</summary>
              <div className={styles.sourceText}>{websitePreview.source.text}</div>
            </details>
          </>
        )}
        {truncated && <Feedback live="polite">{t("uploads.truncated")}</Feedback>}
        {error && <OperationError error={error} />}{" "}
        {message && (
          <Feedback live="polite" tone="error">
            {t(message)}
          </Feedback>
        )}
        {readingWebsite && <LoadingState>{t("uploads.readingWebsite")}</LoadingState>}
        <OperationProgress progress={operation.progress} />
        {(operation.busy || readingWebsite) && (
          <Button variant="secondary" onPress={cancelWebsite}>
            {t("actions.cancel")}
          </Button>
        )}
        <ActionGroup align="end">
          <Button
            variant="secondary"
            isDisabled={working}
            onPress={() => {
              setEditor(false);
            }}
          >
            {t("actions.cancel")}
          </Button>
          <Button
            variant="primary"
            isPending={working}
            isDisabled={
              !snapshot ||
              (draft.format === "image" && imageAccess !== "available") ||
              !draft.title.trim() ||
              draft.text.length > 12000 ||
              (draft.format === "website" &&
                (!materialSourceSchema.shape.url.safeParse(draft.url).success ||
                  (!websitePreview && (!editing || editing.url !== draft.url)))) ||
              (draft.format !== "image" && !draft.text.trim()) ||
              (draft.format === "image" && !draft.image && !editing?.image)
            }
            onPress={() =>
              void safely(async () => {
                if (!snapshot) return;
                const captured = scopeRef.current;
                const fingerprint = JSON.stringify({
                  draft,
                  previous: editing?.revisionId,
                  websitePack: websitePreview
                    ? {
                        operationId: websitePreview.operationId,
                        positions: websitePreview.positions,
                      }
                    : undefined,
                  scope,
                });
                if (saveSubmission.current?.fingerprint !== fingerprint)
                  saveSubmission.current = { fingerprint, id: createDesktopSubmissionId() };
                const result = await invokeDesktop("uploads/save", {
                  saveId: saveSubmission.current.id,
                  rootGeneration: snapshot.rootGeneration,
                  language: snapshot.language,
                  draft: {
                    ...draft,
                    ...(draft.format !== "image" ? { image: undefined } : {}),
                    ...(draft.format !== "website" ? { url: undefined } : {}),
                  },
                  ...(editing ? { previous: reference(editing) } : {}),
                  ...(draft.format === "website" && websitePreview
                    ? {
                        websitePack: {
                          operationId: websitePreview.operationId,
                          positions: websitePreview.positions,
                        },
                      }
                    : {}),
                });
                if (captured !== scopeRef.current) return;
                setSelected(result.upload);
                draftCache.current.delete(editing?.revisionId ?? "new");
                websiteDraftCache.current.delete(editing?.revisionId ?? "new");
                setWebsitePreview(undefined);
                setTruncated(false);
                const detail = await invokeDesktop("uploads/read", {
                  rootGeneration: snapshot.rootGeneration,
                  reference: reference(result.upload),
                });
                if (captured !== scopeRef.current) return;
                setSavedWords(detail.words);
                setEditor(false);
                setEditing(undefined);
                setDraft({ format: "text", title: "", text: "" });
                setOriginal(undefined);
                setAnalyses([]);
                await library.refresh();
              })
            }
          >
            {t("vocabulary.learning.save")}
          </Button>
        </ActionGroup>
      </div>
    </ModalDialog>
  );
}
