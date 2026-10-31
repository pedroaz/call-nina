import { useTranslation } from "react-i18next";
import { OperationError } from "./OperationError.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CallNinaError,
  DataRootGeneration,
  DesktopIpcResponse,
  UploadDetail,
  UploadImageInput,
  UploadReference,
} from "@call-nina/contracts";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import styles from "./UploadsLibrary.module.css";
type Snapshot = Extract<DesktopIpcResponse, { status: "ok"; channel: "uploads/list" }>["result"];
export function useUploads(
  vocabularyId?: Parameters<typeof invokeDesktop<"uploads/list">>[1]["vocabularyId"],
) {
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [error, setError] = useState<CallNinaError>();
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++epoch.current;
    try {
      const next = await invokeDesktop("uploads/list", vocabularyId ? { vocabularyId } : {});
      if (version === epoch.current) {
        setSnapshot(next);
        setError(undefined);
      }
      return next;
    } catch (e) {
      if (version === epoch.current) setError(normalizeDesktopError(e).detail);
      return undefined;
    }
  }, [vocabularyId]);
  useEffect(() => {
    void refresh();
    const off = subscribeDesktop((e) => {
      if (e.event === "data-root-changed") {
        epoch.current++;
        setSnapshot(undefined);
        void refresh();
      } else if (e.event === "state-invalidated" && ["vocabulary", "settings"].includes(e.scope))
        void refresh();
    });
    return () => {
      epoch.current++;
      off();
    };
  }, [refresh]);
  return { snapshot, error, refresh };
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
    setImage(undefined);
    setError(undefined);
    if (upload.image)
      void invokeDesktop("uploads/image", { rootGeneration, reference: uploadReference(upload) })
        .then((r) => {
          if (active && r.image) setImage(r.image);
        })
        .catch((e) => {
          if (active) setError(normalizeDesktopError(e).detail);
        });
    return () => {
      active = false;
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
