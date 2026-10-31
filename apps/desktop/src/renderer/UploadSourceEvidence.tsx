import { useState } from "react";
import type {
  DataRootGeneration,
  UploadReference,
  UploadDetail,
  CallNinaError,
} from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { UploadPreview } from "./useUploads.js";
import { Button, ModalDialog } from "./components/ui/index.js";
import { OperationError } from "./OperationError.js";
export function UploadSourceEvidence({
  reference,
  rootGeneration,
  title,
}: {
  reference: UploadReference;
  rootGeneration: DataRootGeneration;
  title: string;
}) {
  const { t } = useTranslation(),
    [upload, setUpload] = useState<UploadDetail>(),
    [error, setError] = useState<CallNinaError>(),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant="quiet"
        density="compact"
        isPending={busy}
        onPress={() => {
          setBusy(true);
          setError(undefined);
          void invokeDesktop("uploads/read", { rootGeneration, reference })
            .then((r) => setUpload(r.upload))
            .catch((e) => setError(normalizeDesktopError(e).detail))
            .finally(() => setBusy(false));
        }}
      >
        {t("uploads.usedMaterial", { title })}
      </Button>
      {error && <OperationError error={error} />}{" "}
      {upload && (
        <ModalDialog
          isOpen
          title={upload.title}
          closeLabel={t("actions.close")}
          onOpenChange={(open) => {
            if (!open) setUpload(undefined);
          }}
        >
          <UploadPreview upload={upload} rootGeneration={rootGeneration} />
        </ModalDialog>
      )}
    </>
  );
}
