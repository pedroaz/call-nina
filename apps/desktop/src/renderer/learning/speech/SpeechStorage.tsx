import { languageDefinitions, type SpeechSnapshot } from "@call-nina/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup, Section } from "../../components/layout/index.js";
import { Button, Feedback, ModalDialog } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { useSpeechSettings, voiceName } from "./speech-settings-state.js";
import styles from "./SpeechSettings.module.css";

export function SpeechStorage() {
  const { t, i18n } = useTranslation();
  const { view, error, busy, act } = useSpeechSettings();
  const [removal, setRemoval] = useState<SpeechSnapshot["packs"][number] | null>(null);
  const size = (bytes: number) => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unit = bytes > 0 ? Math.min(4, Math.floor(Math.log10(bytes) / 3)) : 0;
    return `${(bytes / 1000 ** unit).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} ${units[unit] ?? "B"}`;
  };
  return (
    <Section title={t("speech.storageTitle")}>
      {error && !removal && <OperationError error={error} />}
      {!view && !error && <p role="status">{t("speech.loading")}</p>}
      {view && (
        <div className={styles.sections}>
          <>
            <div className={styles.storage}>
              <h3>{t("speech.deviceStorage")}</h3>
              <p>{t("speech.freeSpace", { size: size(view.freeBytes) })}</p>
              <dl className={styles.usage}>
                <div>
                  <dt>{t("speech.models")}</dt>
                  <dd>{size(view.modelBytes)}</dd>
                </div>
                <div>
                  <dt>{t("speech.publicAudio")}</dt>
                  <dd>{size(view.publicBytes)}</dd>
                </div>
                <div>
                  <dt>{t("speech.privateAudio")}</dt>
                  <dd>{size(view.privateBytes)}</dd>
                </div>
              </dl>
              <p>{t("speech.ownership")}</p>
            </div>
            <section className={styles.sections} aria-label={t("speech.models")}>
              <h3>{t("speech.models")}</h3>
              {!view.supported && <Feedback live="off">{t("speech.linuxOnly")}</Feedback>}
              {view.packs
                .filter(
                  (pack) =>
                    pack.diskBytes > 0 ||
                    pack.state === "partial" ||
                    pack.state === "update" ||
                    pack.state === "downloading" ||
                    pack.state === "installed",
                )
                .map((pack) => (
                  <div className={styles.pack} key={pack.id}>
                    <div className={styles.details}>
                      <strong>
                        {pack.engine === "piper" ? "Piper" : "Pocket TTS"} ·{" "}
                        {languageDefinitions[pack.language].name}
                        {" · "}
                        {voiceName(pack.voice)}
                      </strong>
                      <span>
                        {pack.voice} ·{" "}
                        {t(
                          pack.state === "downloading"
                            ? "speech.installing"
                            : `speech.states.${pack.state}`,
                        )}
                      </span>
                      {pack.state !== "unavailable" && (
                        <span>
                          {t("speech.packSizes", {
                            download: size(pack.downloadBytes),
                            installed: size(pack.installedBytes),
                            disk: size(pack.diskBytes),
                          })}
                        </span>
                      )}
                      {pack.unavailableReason && (
                        <span>{t(`speech.unavailableReasons.${pack.unavailableReason}`)}</span>
                      )}
                      {pack.error && (
                        <span role="status">
                          {t(
                            pack.error === "OD_SPEECH_DISK_FULL"
                              ? "speech.diskFull"
                              : "speech.downloadFailed",
                          )}
                        </span>
                      )}
                      {pack.state === "downloading" && (
                        <>
                          <progress
                            aria-label={`${t("speech.download")} ${pack.voice}`}
                            value={pack.downloadedBytes}
                            max={pack.downloadBytes}
                          />
                          <span>
                            {size(pack.downloadedBytes)} / {size(pack.downloadBytes)}
                          </span>
                        </>
                      )}
                    </div>
                    <ActionGroup>
                      {pack.state === "downloading" ? (
                        <Button
                          variant="secondary"
                          onPress={() => void act({ action: "cancel-download", packId: pack.id })}
                        >
                          {t("actions.cancel")}
                        </Button>
                      ) : (
                        <>
                          {(pack.state === "installed" ||
                            pack.state === "partial" ||
                            pack.state === "update" ||
                            pack.diskBytes > 0) && (
                            <Button
                              variant="quiet"
                              isDisabled={busy}
                              onPress={() => {
                                setRemoval(pack);
                              }}
                            >
                              {t("speech.remove")}
                            </Button>
                          )}
                        </>
                      )}
                    </ActionGroup>
                  </div>
                ))}
            </section>
            <section className={styles.storage} aria-label={t("speech.cacheTitle")}>
              <h3>{t("speech.cacheTitle")}</h3>
              <p>
                {t("speech.cache", {
                  size: (view.cacheBytes / 1e6).toLocaleString(i18n.language, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }),
                })}
              </p>
              <p>{t("speech.cachePolicy")}</p>
              <ActionGroup>
                <Button
                  variant="secondary"
                  isDisabled={busy || view.privateBytes === 0}
                  onPress={() => void act({ action: "clear-private-cache" })}
                >
                  {t("speech.clearPrivate")}
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={busy || view.cacheBytes === 0}
                  onPress={() => void act({ action: "clear-cache" })}
                >
                  {t("speech.clear")}
                </Button>
              </ActionGroup>
            </section>
          </>
        </div>
      )}
      {removal && (
        <ModalDialog
          isOpen
          title={t("speech.remove")}
          isDismissable={!busy}
          onOpenChange={(open) => {
            if (!open && !busy) setRemoval(null);
          }}
        >
          <p>
            {removal.voice} · {languageDefinitions[removal.language].name}
          </p>
          <p>{t("speech.removeConsequences")}</p>
          {error && <OperationError error={error} message={t("speech.removeFailed")} />}
          <ActionGroup align="end">
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => {
                setRemoval(null);
              }}
            >
              {t("actions.cancel")}
            </Button>
            <Button
              variant="danger"
              isDisabled={busy}
              onPress={() =>
                void act({ action: "remove", packId: removal.id }).then((ok) => {
                  if (ok) setRemoval(null);
                })
              }
            >
              {t("speech.remove")}
            </Button>
          </ActionGroup>
        </ModalDialog>
      )}
    </Section>
  );
}
