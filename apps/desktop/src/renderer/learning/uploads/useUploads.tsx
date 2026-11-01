import type {
  CallNinaError,
  DataRootGeneration,
  UploadDetail,
  UploadImageInput,
  UploadReference,
} from "@call-nina/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OperationError } from "../../components/ui/OperationError.js";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import { useDesktopRead } from "../../runtime/useDesktopRead.js";
import styles from "./UploadSource.module.css";

export function useUploads(
  vocabularyId?: Parameters<typeof invokeDesktop<"uploads/list">>[1]["vocabularyId"],
) {
  const read = useDesktopRead({
    key: JSON.stringify(vocabularyId ?? null),
    read: () => invokeDesktop("uploads/list", vocabularyId ? { vocabularyId } : {}),
    scopes: ["vocabulary", "settings"],
    refreshOnFocus: false,
  });
  return { snapshot: read.value, error: read.error, refresh: read.refresh };
}
export const uploadReference = (upload: UploadReference): UploadReference => ({
  uploadId: upload.uploadId,
  revisionId: upload.revisionId,
});
export function UploadPreview({
  upload,
  rootGeneration,
}: {
  upload: UploadDetail;
  rootGeneration: DataRootGeneration;
}) {
  const { t } = useTranslation();
  const [image, setImage] = useState<UploadImageInput>();
  const [error, setError] = useState<CallNinaError>();
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setImage(undefined);
      setError(undefined);
      if (upload.image)
        void invokeDesktop("uploads/image", { rootGeneration, reference: uploadReference(upload) })
          .then((r) => {
            if (active && r.image) setImage(r.image);
          })
          .catch((e: unknown) => {
            if (active) setError(normalizeDesktopError(e).detail);
          });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [upload, rootGeneration]);
  return (
    <div className={styles.preview}>
      {error && <OperationError error={error} />}
      {image && (
        <img
          className={styles.image}
          src={`data:${image.mediaType};base64,${image.data}`}
          alt={upload.title}
        />
      )}
      {upload.studyPack && <h3>{t("uploads.summary")}</h3>}
      <div className={styles.sourceText} lang={upload.language}>
        {upload.text}
      </div>
      {upload.url && <span>{new URL(upload.url).hostname}</span>}
      {upload.studyPack && (
        <details className={styles.secondary}>
          <summary>{t("uploads.originalText")}</summary>
          <div className={styles.sourceText}>{upload.studyPack.source.text}</div>
          {upload.studyPack.source.truncated && <p>{t("uploads.truncated")}</p>}
        </details>
      )}
    </div>
  );
}
