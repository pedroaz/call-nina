import { speechTextSchema, type Language, type SpeechSnapshot } from "@call-nina/contracts";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup, Section } from "../../components/layout/index.js";
import {
  Button,
  Feedback,
  ModalDialog,
  SelectField,
  TextAreaField,
} from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { NinaAccountSettings } from "../account/NinaAccount.js";
import { ProviderChoice, ProviderMatrix } from "../providers/ProviderMatrix.js";
import {
  accountReason,
  languages,
  samples,
  useSpeechSettings,
  voiceName,
} from "./speech-settings-state.js";
import { SpeechButton, stopSpeech } from "./SpeechButton.js";
import styles from "./SpeechSettings.module.css";

export function SpeechConnections({ language }: { language: Language }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { view, account, error, busy, act } = useSpeechSettings();
  const [editing, setEditing] = useState<Language>();
  const [preview, setPreview] = useState(samples[language]);
  const [source, setSource] = useState<"piper" | "pocket" | "managed">("piper");
  const [target, setTarget] = useState<Language>(language);
  const [editingVoice, setEditingVoice] = useState<string>();
  const [voiceOnly, setVoiceOnly] = useState(false);
  const [previousLanguage, setPreviousLanguage] = useState(language);
  if (previousLanguage !== language) {
    setPreviousLanguage(language);
    setTarget(language);
  }
  const packStatus = (pack: SpeechSnapshot["packs"][number] | undefined) => {
    if (!pack) return t("speech.states.unavailable");
    if (pack.unavailableReason) return t(`speech.unavailableReasons.${pack.unavailableReason}`);
    return t(pack.state === "downloading" ? "speech.installing" : `speech.states.${pack.state}`);
  };
  const row = (engine: "piper" | "pocket" | "managed") => {
    if (!view) return null;
    const choices = view.packs.filter(
      (entry) => entry.language === target && entry.engine === engine,
    );
    const saved = view.preferences.voices[`${engine}:${target}`];
    const pack = choices.find((entry) => entry.id === saved) ?? choices[0];
    const ready =
      engine === "managed"
        ? accountReason(account) === "ready"
        : view.supported && pack?.state === "installed";
    const name =
      engine === "managed"
        ? t("connectionSettings.routes.managed")
        : engine === "piper"
          ? "Piper"
          : "Pocket TTS";
    const selected = view.preferences[target] === engine;
    const unavailable =
      engine !== "managed" && (!view.supported || !pack || pack.state === "unavailable");
    const status =
      engine === "managed"
        ? !account
          ? t("providers.checkingConnection")
          : account.status !== "signed-in"
            ? t("providers.signInRequired")
            : accountReason(account) === "account"
              ? t("providers.accessRequired")
              : t(`speech.readiness.${accountReason(account)}`)
        : packStatus(pack);
    const open = (voiceId = pack?.id, onlyVoice = false) => {
      stopSpeech();
      setPreview(samples[target]);
      setSource(engine);
      setEditing(target);
      setEditingVoice(voiceId);
      setVoiceOnly(onlyVoice);
    };
    const actionLabel = ready
      ? "providers.configure"
      : unavailable
        ? "ui.details"
        : engine === "managed" && account?.status !== "signed-in"
          ? "ninaAccount.signIn"
          : "setupUx.setUp";
    return (
      <tr key={engine} data-selected={selected}>
        <th scope="row">{name}</th>
        <td id={`${id}-${engine}-status`}>
          <div className={styles.details} role="status">
            <span>{status}</span>
            {pack?.error && (
              <span>
                {t(
                  pack.error === "OD_SPEECH_DISK_FULL"
                    ? "speech.diskFull"
                    : "speech.downloadFailed",
                )}
              </span>
            )}
            {pack?.state === "downloading" && (
              <progress
                value={pack.downloadedBytes}
                max={pack.downloadBytes}
                aria-label={t("speech.download")}
              />
            )}
          </div>
        </td>
        <td>
          {engine === "managed" ? (
            t("providers.default")
          ) : ready ? (
            <SelectField
              density="compact"
              className={styles.voice}
              label={`${t("speech.voice")}: ${name}`}
              value={pack?.id ?? ""}
              disabled={unavailable || !choices.length}
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              onChange={(event) => {
                if (busy) return;
                const candidate = choices.find((entry) => entry.id === event.currentTarget.value);
                if (!candidate) return;
                if (candidate.state === "installed")
                  void act({
                    action: "preferences",
                    preferences: {
                      ...view.preferences,
                      voices: {
                        ...view.preferences.voices,
                        [`${engine}:${target}`]: candidate.id,
                      },
                    },
                  });
                else open(candidate.id, true);
              }}
            >
              {choices
                .filter((entry) => entry.state === "installed")
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {voiceName(entry.voice)}
                  </option>
                ))}
            </SelectField>
          ) : null}
        </td>
        <td>
          <ProviderChoice
            name={`${id}-${target}`}
            checked={selected}
            disabled={busy || !ready}
            aria-label={`${t("setupUx.speechAi")}: ${name} · ${t(`languages.${target}`)}`}
            aria-describedby={`${id}-${engine}-status`}
            onChange={() => {
              open();
            }}
          />
        </td>
        <td>
          <Button
            variant={selected ? "secondary" : "quiet"}
            isDisabled={busy}
            aria-label={`${t(actionLabel)}: ${name} · ${t(`languages.${target}`)}`}
            aria-haspopup="dialog"
            onPress={() => {
              open();
            }}
          >
            {t(actionLabel)}
          </Button>
        </td>
      </tr>
    );
  };
  const pack = view?.packs.find((entry) => entry.id === editingVoice);
  const sameVoice = Boolean(
    pack && view?.preferences.voices[`${source}:${String(editing)}`] === pack.id,
  );
  const savedPack = view?.packs.find(
    (entry) => entry.engine === source && entry.language === editing,
  );
  const voiceSelected =
    sameVoice ||
    Boolean(
      pack &&
      !view?.preferences.voices[`${source}:${String(editing)}`] &&
      savedPack?.id === pack.id,
    );
  const ready =
    source === "managed"
      ? accountReason(account) === "ready"
      : view?.supported && pack?.state === "installed";
  const downloadable =
    source !== "managed" &&
    view?.supported &&
    pack &&
    !["unavailable", "downloading", "installed"].includes(pack.state);
  const apply = async () => {
    if (!view || !editing) return;
    stopSpeech();
    if (downloadable) {
      await act({ action: "install", packId: pack.id });
      return;
    }
    await act({
      action: "preferences",
      preferences: {
        ...view.preferences,
        ...(!voiceOnly ? { [editing]: source } : {}),
        voices: {
          ...view.preferences.voices,
          ...(pack ? { [`${source}:${editing}`]: pack.id } : {}),
        },
      },
    });
  };
  return (
    <Section
      title={t("setupUx.speechAi")}
      actions={
        <SelectField
          className={styles.language}
          label={t("setupUx.language")}
          value={target}
          onChange={(event) => {
            stopSpeech();
            setTarget(event.target.value as Language);
          }}
        >
          {languages.map((entry) => (
            <option key={entry} value={entry}>
              {t(`languages.${entry}`)}
            </option>
          ))}
        </SelectField>
      }
    >
      {error && !editing && <OperationError error={error} />}
      {!view && !error && <p role="status">{t("speech.loading")}</p>}
      {view && (
        <ProviderMatrix withVoice label={`${t("setupUx.speechAi")} · ${t(`languages.${target}`)}`}>
          {(["piper", "pocket", "managed"] as const).map(row)}
        </ProviderMatrix>
      )}
      <ModalDialog
        closeLabel={t("actions.close")}
        isOpen={Boolean(editing)}
        title={`${source === "managed" ? t("connectionSettings.routes.managed") : source === "piper" ? "Piper" : "Pocket TTS"} · ${pack ? voiceName(pack.voice) : editing ? t(`languages.${editing}`) : ""}`}
        onOpenChange={(open) => {
          if (!open) {
            stopSpeech();
            setEditing(undefined);
          }
        }}
      >
        {editing && view && (
          <div className={styles.sections}>
            {error && <OperationError error={error} />}
            {source !== "managed" &&
              view.packs.filter((entry) => entry.engine === source && entry.language === editing)
                .length > 1 && (
                <SelectField
                  label={t("speech.voice")}
                  value={editingVoice ?? ""}
                  disabled={busy || view.packs.some((entry) => entry.state === "downloading")}
                  onChange={(event) => {
                    stopSpeech();
                    setEditingVoice(event.target.value);
                  }}
                >
                  {view.packs
                    .filter((entry) => entry.engine === source && entry.language === editing)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {voiceName(entry.voice)}
                      </option>
                    ))}
                </SelectField>
              )}
            <p role="status">
              {source === "managed"
                ? t(`speech.readiness.${accountReason(account)}`)
                : packStatus(pack)}
              {source !== "managed" &&
                pack &&
                !["unavailable", "installed"].includes(pack.state) &&
                ` · ${t("speech.installSize", { size: (pack.downloadBytes / 1e6).toLocaleString(i18n.language, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) })}`}
            </p>
            {source === "managed" && accountReason(account) === "account" && (
              <NinaAccountSettings />
            )}
            {source === "managed" && accountReason(account) !== "account" && (
              <p>
                {t("speech.balance", { count: account?.access?.speech.remainingCharacters ?? 0 })}
              </p>
            )}
            {pack?.error && (
              <Feedback tone="error" live="polite">
                {t(
                  pack.error === "OD_SPEECH_DISK_FULL"
                    ? "speech.diskFull"
                    : "speech.downloadFailed",
                )}
              </Feedback>
            )}
            {pack?.state === "downloading" && (
              <>
                <progress
                  value={pack.downloadedBytes}
                  max={pack.downloadBytes}
                  aria-label={t("speech.download")}
                />
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => void act({ action: "cancel-download", packId: pack.id })}
                >
                  {t("actions.cancel")}
                </Button>
              </>
            )}
            {ready && (
              <div className={styles.storage}>
                {source === "managed" ? (
                  <p lang={editing}>{samples[editing]}</p>
                ) : (
                  <TextAreaField
                    label={t("speech.previewText")}
                    lang={editing}
                    value={preview}
                    rows={4}
                    maxLength={12000}
                    error={
                      speechTextSchema.safeParse(preview).success
                        ? undefined
                        : t("speech.previewInvalid")
                    }
                    onChange={(event) => {
                      stopSpeech();
                      setPreview(event.target.value);
                    }}
                  />
                )}
                {(source === "managed"
                  ? view.preferences[editing] === source
                  : speechTextSchema.safeParse(preview).success) && (
                  <SpeechButton
                    text={source === "managed" ? samples[editing] : preview}
                    language={editing}
                    {...(source === "managed" ? {} : { source, voice: pack?.id })}
                    variant="passage"
                    showUnavailableReason={false}
                  />
                )}
              </div>
            )}
            <ActionGroup align="end">
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => {
                  stopSpeech();
                  setEditing(undefined);
                }}
              >
                {t("actions.close")}
              </Button>
              <Button
                variant="primary"
                isDisabled={
                  busy ||
                  (!ready && !downloadable) ||
                  (ready &&
                    (source === "managed"
                      ? view.preferences[editing] === source
                      : voiceSelected && (voiceOnly || view.preferences[editing] === source))) ||
                  Boolean(downloadable && view.packs.some((entry) => entry.state === "downloading"))
                }
                onPress={() => void apply()}
              >
                {t(
                  downloadable
                    ? pack.state === "partial"
                      ? "speech.resume"
                      : "speech.install"
                    : "speech.useVoice",
                )}
              </Button>
            </ActionGroup>
          </div>
        )}
      </ModalDialog>
    </Section>
  );
}
