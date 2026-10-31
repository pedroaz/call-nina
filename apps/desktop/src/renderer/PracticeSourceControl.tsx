import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CallNinaError, PracticeSource, UploadDetail } from "@call-nina/contracts";
import { useUploads, UploadPreview } from "./useUploads.js";
import { Button, ModalDialog, SelectField } from "./components/ui/index.js";
import styles from "./PracticeSourceControl.module.css";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { OperationError } from "./OperationError.js";
export function PracticeSourceControl({
  value,
  onChange,
  disabled = false,
}: {
  value: PracticeSource;
  onChange: (source: PracticeSource) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(),
    library = useUploads(),
    [preview, setPreview] = useState<UploadDetail>(),
    [error, setError] = useState<CallNinaError>();
  const selected =
    value.kind === "upload"
      ? library.snapshot?.uploads.find(
          (u) =>
            u.uploadId === value.reference.uploadId && u.revisionId === value.reference.revisionId,
        )
      : undefined;
  useEffect(() => {
    if (
      value.kind === "upload" &&
      library.snapshot &&
      (value.rootGeneration !== library.snapshot.rootGeneration ||
        !library.snapshot.uploads.some(
          (u) =>
            u.uploadId === value.reference.uploadId && u.revisionId === value.reference.revisionId,
        ))
    )
      onChange({ kind: "adaptive" });
  }, [library.snapshot, value, onChange]);
  return (
    <div className={styles.source}>
      <div className={styles.controls}>
        <SelectField
          className={styles.selection}
          density="compact"
          label={t("uploads.practiceSource")}
          value={value.kind === "upload" ? (selected?.uploadId ?? "adaptive") : "adaptive"}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === "adaptive") {
              onChange({ kind: "adaptive" });
              return;
            }
            const upload = library.snapshot?.uploads.find(
              (item) => item.uploadId === event.target.value,
            );
            if (upload && library.snapshot)
              onChange({
                kind: "upload",
                reference: { uploadId: upload.uploadId, revisionId: upload.revisionId },
                rootGeneration: library.snapshot.rootGeneration,
              });
          }}
        >
          <option value="adaptive">{t("uploads.adaptive")}</option>
          <optgroup label={t("uploads.tab")}>
            {library.snapshot?.uploads.length ? (
              library.snapshot.uploads.map((upload) => (
                <option key={upload.uploadId} value={upload.uploadId}>
                  {upload.title}
                </option>
              ))
            ) : (
              <option disabled>{t("uploads.noUploads")}</option>
            )}
          </optgroup>
        </SelectField>
        {value.kind === "upload" && selected && (
          <Button
            variant="quiet"
            density="compact"
            leadingIcon={<Eye aria-hidden="true" />}
            isDisabled={disabled}
            onPress={() => {
              if (value.kind === "upload")
                void invokeDesktop("uploads/read", {
                  rootGeneration: value.rootGeneration,
                  reference: value.reference,
                })
                  .then((r) => setPreview(r.upload))
                  .catch((e) => setError(normalizeDesktopError(e).detail));
            }}
          >
            {t("uploads.preview")}
          </Button>
        )}
      </div>
      {(error || library.error) && <OperationError error={(error ?? library.error)!} />}
      {preview && library.snapshot && (
        <ModalDialog
          isOpen
          title={preview.title}
          closeLabel={t("actions.close")}
          onOpenChange={(v) => {
            if (!v) setPreview(undefined);
          }}
        >
          <UploadPreview upload={preview} rootGeneration={library.snapshot.rootGeneration} />
        </ModalDialog>
      )}
    </div>
  );
}
