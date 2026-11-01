import { useTranslation } from "react-i18next";
import { BookPlus, FileText, Globe, Image } from "lucide-react";
import { ContentRow } from "../../components/layout/index.js";
import { Button, EmptyState, LoadingState } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { type UploadsLibraryProps } from "../../learning/uploads/UploadsLibrary.types.js";
import { useUploads } from "../../learning/uploads/useUploads.js";
import { VocabularyDetails } from "../../learning/vocabulary/VocabularyDetails.js";
import { UploadDetailsDialog } from "./UploadDetailsDialog.js";
import { UploadEditorDialog } from "./UploadEditorDialog.js";
import styles from "./UploadsLibrary.module.css";

import { useUploadsLibraryController } from "./useUploadsLibraryController.js";

export function UploadsLibrary(props: UploadsLibraryProps) {
  const library = useUploads();
  return (
    <UploadsLibraryWorkspace
      key={JSON.stringify([library.snapshot?.rootGeneration, library.snapshot?.language])}
      {...props}
      library={library}
    />
  );
}
function UploadsLibraryWorkspace(
  props: UploadsLibraryProps & { library: ReturnType<typeof useUploads> },
) {
  const { i18n } = useTranslation();
  const model = useUploadsLibraryController(props);
  const {
    library,
    error,
    editor,
    selected,
    snapshot,
    t,
    working,
    onAddContent,
    open,
    setSelected,
    setWordId,
    wordId,
    onWordNavigate,
  } = model;
  return (
    <div className={styles.library}>
      {library.error && <OperationError error={library.error} />}
      {error && !editor && !selected && <OperationError error={error} />}
      {!snapshot && !library.error && <LoadingState>{t("ui.loading")}</LoadingState>}
      {snapshot?.uploads.length === 0 && !library.error && (
        <EmptyState
          variant="plain"
          icon={<BookPlus />}
          title={t("uploads.noUploads")}
          action={
            <Button
              variant="primary"
              isDisabled={working}
              leadingIcon={<BookPlus aria-hidden="true" />}
              onPress={onAddContent}
            >
              {t("uploads.add")}
            </Button>
          }
        />
      )}
      {snapshot?.uploads.map((upload) => (
        <ContentRow key={upload.uploadId} className={styles.uploadRow}>
          <Button
            variant="quiet"
            className={styles.uploadOpen}
            isDisabled={working}
            aria-label={`${t("uploads.open")}: ${upload.title}`}
            onPress={() => void open(upload)}
          >
            <span aria-hidden="true" className={styles.uploadIcon}>
              {upload.format === "image" ? (
                <Image />
              ) : upload.format === "website" ? (
                <Globe />
              ) : (
                <FileText />
              )}
            </span>
            <span className={styles.uploadCopy}>
              <strong>{upload.title}</strong>
              <span className={styles.meta}>
                {t(`uploads.formats.${upload.format}`)}
                {upload.url ? ` · ${new URL(upload.url).hostname}` : ""} ·{" "}
                {new Date(upload.createdAt).toLocaleDateString(i18n.language)}
              </span>
            </span>
          </Button>
        </ContentRow>
      ))}
      {selected && snapshot && <UploadDetailsDialog model={model} />}
      <UploadEditorDialog model={model} />
      {wordId && snapshot && (
        <VocabularyDetails
          vocabularyId={wordId}
          rootGeneration={snapshot.rootGeneration}
          onClose={() => {
            setWordId(undefined);
          }}
          onChanged={() => void library.refresh()}
          onNavigate={(page, scope) => {
            setWordId(undefined);
            setSelected(undefined);
            onWordNavigate(page, scope);
          }}
        />
      )}
    </div>
  );
}
