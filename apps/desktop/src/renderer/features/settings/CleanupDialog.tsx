import type { CallNinaError, DesktopResult, PersonalDataCleanupScope } from "@call-nina/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "../../components/layout/index.js";
import { Button, Feedback, ModalDialog, Muted, TextField } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { stopSpeech } from "../../learning/speech/SpeechButton.js";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";

type Overview = DesktopResult<"personal-data/read">;
type BlockReason = Extract<DesktopResult<"personal-data/clear">, { status: "blocked" }>["reason"];
export function CleanupDialog({
  scope,
  generation,
  onClose,
  onCleared,
  onPartial,
  onBusy,
}: {
  scope: PersonalDataCleanupScope;
  generation: Overview["rootGeneration"];
  onClose: () => void;
  onCleared: (scope: PersonalDataCleanupScope) => void;
  onPartial: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<CallNinaError>();
  const [blocked, setBlocked] = useState<BlockReason>();
  const [partial, setPartial] = useState(false);
  const clear = async () => {
    setPending(true);
    onBusy(true);
    setError(undefined);
    setBlocked(undefined);
    setPartial(false);
    try {
      const result = await invokeDesktop("personal-data/clear", {
        scope,
        expectedGeneration: generation,
        confirmed: true,
      });
      if (result.status === "blocked") setBlocked(result.reason);
      else if (result.status === "partial") {
        stopSpeech();
        setPartial(true);
        onPartial();
      } else {
        stopSpeech();
        onCleared(scope);
      }
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      onBusy(false);
      setPending(false);
    }
  };
  return (
    <ModalDialog
      isOpen
      isDismissable={!pending}
      title={t(`personalData.cleanup.${scope}.action`)}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <p>{t(`personalData.cleanup.${scope}.removes`)}</p>
      <Muted>{t(`personalData.cleanup.${scope}.keeps`)}</Muted>
      <Feedback tone="warning" live="off">
        {t("personalData.cleanup.permanent")}
      </Feedback>
      {scope === "learning" && (
        <TextField
          label={t("personalData.cleanup.confirmLabel")}
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
          disabled={pending}
          autoComplete="off"
        />
      )}
      {blocked && (
        <Feedback tone="warning" live="polite">
          {t(`personalData.cleanup.blocked.${blocked}`)}
        </Feedback>
      )}
      {error && <OperationError error={error} />}
      {partial && (
        <Feedback tone="error" live="polite">
          {t("personalData.cleanup.partial")}
        </Feedback>
      )}
      <ActionGroup align="end">
        <Button variant="secondary" isDisabled={pending} onPress={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button
          variant="danger"
          isPending={pending}
          pendingLabel={t("personalData.cleanup.clearing")}
          isDisabled={
            scope === "learning" && confirmation !== t("personalData.cleanup.confirmWord")
          }
          onPress={() => void clear()}
        >
          {t(`personalData.cleanup.${scope}.action`)}
        </Button>
      </ActionGroup>
    </ModalDialog>
  );
}
