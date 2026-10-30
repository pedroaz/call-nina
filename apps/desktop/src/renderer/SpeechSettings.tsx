import { OperationError } from "./OperationError.js";
import { NinaAccountSettings } from "./NinaAccount.js";
import { ProviderMatrix, ProviderChoice } from "./ProviderMatrix.js";
import { SpeechButton, stopSpeech } from "./SpeechButton.js";
import { useEffect, useState, useCallback, useId } from "react";
import { useTranslation } from "react-i18next";
import {
  languageDefinitions,
  speechTextSchema,
  type SpeechAction,
  type CallNinaError,
  type SpeechSnapshot,
  type Language,
  type NinaAccountState,
} from "@call-nina/contracts";
import {
  Button,
  SelectField,
  TextAreaField,
  Feedback,
  ModalDialog,
} from "./components/ui/index.js";
import { ActionGroup, Section } from "./components/layout/index.js";
import { invokeDesktop, subscribeDesktop, normalizeDesktopError } from "./ipc.js";
import styles from "./SpeechSettings.module.css";

const languages: Language[] = ["de", "en-US", "pt-BR", "es"];
const voiceName = (voice: string) =>
  voice === "juergen"
    ? "Jürgen"
    : voice === "hfc_male"
      ? "Hi-Fi Captain"
      : voice === "mls_10246"
        ? "MLS 10246"
        : voice.charAt(0).toUpperCase() + voice.slice(1).replaceAll("_", " ");
function useSpeechSettings() {
  const [view, setView] = useState<SpeechSnapshot | null>(null);
  const [account, setAccount] = useState<NinaAccountState | null>(null);
  const [readError, setReadError] = useState<CallNinaError>();
  const [actionError, setActionError] = useState<CallNinaError>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true,
      sequence = 0;
    const refresh = async () => {
      const ticket = ++sequence;
      try {
        const [next, user] = await Promise.all([
          invokeDesktop("speech/read", {}),
          invokeDesktop("nina-account/read", {}),
        ]);
        if (live && ticket === sequence) {
          setView(next);
          setAccount(user);
          setReadError(undefined);
        }
      } catch (cause) {
        if (live && ticket === sequence) setReadError(normalizeDesktopError(cause).detail);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated") void refresh();
    });
    return () => {
      live = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);
  const act = useCallback(async (action: SpeechAction) => {
    if (
      ["preferences", "remove", "clear-private-cache", "clear-cache", "remove-course"].includes(
        action.action,
      )
    )
      stopSpeech();
    setBusy(true);
    setActionError(undefined);
    try {
      setView(await invokeDesktop("speech/manage", action));
      return true;
    } catch (cause) {
      setActionError(normalizeDesktopError(cause).detail);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { view, account, error: actionError ?? readError, busy, act };
}
function accountReason(account: NinaAccountState | null) {
  const access = account?.access?.speech;
  return account?.status !== "signed-in" || !access?.enabled || !access.serviceEnabled
    ? "account"
    : access.remainingCharacters < 1
      ? "allowance"
      : "ready";
}
const samples: Record<Language, string> = {
  de: "Guten Morgen! Wie geht es dir?",
  "en-US": "Good morning! How are you?",
  "pt-BR": "Bom dia! Como você está?",
  es: "¡Buenos días! ¿Cómo estás?",
};

export function SpeechSettings({
  mode = "full",
  language = "de",
}: {
  mode?: "full" | "routing" | "storage";
  language?: Language;
}) {
  return mode === "storage" ? <SpeechStorage /> : <SpeechConnections language={language} />;
}

function SpeechConnections({ language }: { language: Language }) {
  const { t } = useTranslation();
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
          ) : (
            <SelectField
              density="compact"
              className={styles.voice}
              label={`${t("speech.voice")}: ${name}`}
              value={pack?.id ?? ""}
              disabled={!choices.length}
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
              {choices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {voiceName(entry.voice)}
                  {entry.state === "installed" ? "" : ` · ${packStatus(entry)}`}
                </option>
              ))}
            </SelectField>
          )}
        </td>
        <td>
          <ProviderChoice
            name={`${id}-${target}`}
            checked={selected}
            disabled={busy || !ready}
            aria-label={`${t("setupUx.speechAi")}: ${name} · ${t(`languages.${target}`)}`}
            aria-describedby={`${id}-${engine}-status`}
            onChange={() => open()}
          />
        </td>
        <td>
          <Button
            variant={selected ? "secondary" : "quiet"}
            isDisabled={busy}
            aria-label={`${t(actionLabel)}: ${name} · ${t(`languages.${target}`)}`}
            aria-haspopup="dialog"
            onPress={() => open()}
          >
            {t(actionLabel)}
          </Button>
        </td>
      </tr>
    );
  };
  const pack = view?.packs.find((entry) => entry.id === editingVoice);
  const sameVoice = Boolean(pack && view?.preferences.voices[`${source}:${editing}`] === pack.id);
  const savedPack = view?.packs.find(
    (entry) => entry.engine === source && entry.language === editing,
  );
  const voiceSelected =
    sameVoice ||
    Boolean(pack && !view?.preferences.voices[`${source}:${editing}`] && savedPack?.id === pack.id);
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
            <p role="status">
              {source === "managed"
                ? t(`speech.readiness.${accountReason(account)}`)
                : packStatus(pack)}
            </p>
            {source === "managed" && accountReason(account) === "account" && (
              <NinaAccountSettings />
            )}
            {source === "managed" && accountReason(account) !== "account" && (
              <p>
                {t("speech.balance", { count: account?.access?.speech.remainingCharacters ?? 0 })}
              </p>
            )}
            {source !== "managed" && pack && !["unavailable", "installed"].includes(pack.state) && (
              <p>{t("speech.installSize", { size: (pack.downloadBytes / 1e6).toFixed(0) })}</p>
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
              {ready &&
                (source === "managed"
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

function SpeechStorage() {
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
              <p>{t("speech.cache", { size: (view.cacheBytes / 1e6).toFixed(1) })}</p>
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
export function CourseAudio({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<SpeechSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void invokeDesktop("speech/read", {})
        .then((result) => {
          if (live) setView(result);
        })
        .catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [courseId]);
  const course = view?.courses.find((c) => c.id === courseId);
  if (!course) return null;
  const act = async (action: SpeechAction) => {
    setError(false);
    try {
      setView(await invokeDesktop("speech/manage", action));
    } catch {
      setError(true);
    }
  };
  return (
    <div>
      <Button
        variant="quiet"
        onPress={() =>
          void act(
            view?.downloadingCourse === courseId
              ? { action: "cancel-course" }
              : { action: course.pinned ? "remove-course" : "download-course", courseId },
          )
        }
      >
        {t(
          view?.downloadingCourse === courseId
            ? "actions.cancel"
            : course.pinned
              ? "speech.removeCourse"
              : "speech.downloadCourse",
        )}{" "}
        · {(course.bytes / 1e6).toFixed(1)} MB
      </Button>
      {course.hasDownload && !course.pinned && (
        <Button variant="quiet" onPress={() => void act({ action: "remove-course", courseId })}>
          {t("speech.removeCourse")}
        </Button>
      )}
      {course.hasDownload && (
        <span>{t("speech.installedSize", { size: (course.diskBytes / 1e6).toFixed(1) })}</span>
      )}
      {view?.downloadingCourse === courseId && (
        <progress
          aria-label={t("speech.downloadCourse")}
          value={course.downloadedBytes}
          max={course.bytes}
        />
      )}{" "}
      {(error || view?.error) && <p role="status">{t("speech.unavailable")}</p>}
    </div>
  );
}
