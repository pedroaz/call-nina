import { NinaAccountSettings } from "./NinaAccount.js";
import routingStyles from "./ConnectionSettings.module.css";
import { SpeechButton } from "./SpeechButton.js";
import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  languageDefinitions,
  type SpeechAction,
  type SpeechSnapshot,
  type Language,
  type NinaAccountState,
} from "@call-nina/contracts";
import { Button, SelectField, Feedback, ModalDialog } from "./components/ui/index.js";
import { ActionGroup, Section } from "./components/layout/index.js";
import { invokeDesktop, subscribeDesktop } from "./ipc.js";
import styles from "./SpeechSettings.module.css";

const languages: Language[] = ["de", "en-US", "pt-BR", "es"];
function useSpeechSettings() {
  const [view, setView] = useState<SpeechSnapshot | null>(null);
  const [account, setAccount] = useState<NinaAccountState | null>(null);
  const [error, setError] = useState(false);
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
          setError(false);
        }
      } catch {
        if (live && ticket === sequence) setError(true);
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
    setBusy(true);
    setError(false);
    try {
      setView(await invokeDesktop("speech/manage", action));
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { view, account, error, busy, act };
}
function accountReason(account: NinaAccountState | null) {
  const access = account?.access?.speech;
  return !access?.enabled || !access.serviceEnabled
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
  const { view, account, error, busy, act } = useSpeechSettings();
  const [editing, setEditing] = useState<Language>();
  const [source, setSource] = useState<"piper" | "pocket" | "managed">("piper");
  const [target, setTarget] = useState<Language>(language);
  const [previousLanguage, setPreviousLanguage] = useState(language);
  if (previousLanguage !== language) {
    setPreviousLanguage(language);
    setTarget(language);
  }
  const row = (engine: "piper" | "pocket" | "managed") => {
    if (!view) return null;
    const pack = view.packs.find((entry) => entry.language === target && entry.engine === engine);
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
    return (
      <tr key={engine}>
        <th scope="row">{name}</th>
        <td>
          <span role="status">
            {pack?.state === "downloading"
              ? t("speech.states.downloading")
              : t(
                  ready
                    ? "speech.readiness.ready"
                    : engine === "managed"
                      ? "providers.disconnected"
                      : !pack || pack.state === "unavailable"
                        ? "speech.states.unavailable"
                        : "providers.notInstalled",
                )}
            {view.preferences[target] === engine && ready
              ? ` · ${t("providers.selectedDefault")}`
              : ""}
          </span>
          {pack?.state === "downloading" && (
            <progress
              value={pack.downloadedBytes}
              max={pack.downloadBytes}
              aria-label={t("speech.download")}
            />
          )}
        </td>
        <td>
          <Button
            variant="quiet"
            onPress={() => {
              setProvidersOpen(false);
              setSource(engine);
              setEditing(target);
            }}
          >
            {t(ready ? "setupUx.manage" : "setupUx.setUp")}
          </Button>
        </td>
      </tr>
    );
  };
  const pack = view?.packs.find((entry) => entry.language === editing && entry.engine === source);
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
    if (
      !(await act({
        action: "preferences",
        preferences: { ...view.preferences, [editing]: source },
      }))
    )
      return;
    if (downloadable) await act({ action: "install", packId: pack.id });
  };
  const [providersOpen, setProvidersOpen] = useState(false);
  return (
    <Section title={t("setupUx.speechAi")}>
      {error && (
        <Feedback tone="error" live="polite">
          {t("speech.unavailable")}
        </Feedback>
      )}
      {!view && !error && <p role="status">{t("speech.loading")}</p>}
      {view && (
        <>
          <SelectField
            label={t("setupUx.language")}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as Language);
            }}
          >
            {languages.map((entry) => (
              <option key={entry} value={entry}>
                {t(`languages.${entry}`)}
              </option>
            ))}
          </SelectField>
          <ActionGroup className={routingStyles.providerControls}>
            <SelectField
              label={t("providers.provider")}
              value={view.preferences[target]}
              disabled={busy}
              onChange={(event) => {
                setSource(event.target.value as typeof source);
                setEditing(target);
              }}
            >
              <option value="piper">Piper</option>
              <option value="pocket">Pocket TTS</option>
              <option value="managed">{t("connectionSettings.routes.managed")}</option>
            </SelectField>
            <Button
              variant="secondary"
              onPress={() => {
                setSource(view.preferences[target]);
                setEditing(target);
              }}
            >
              {t("setupUx.manage")}
            </Button>
            <Button
              variant="quiet"
              onPress={() => {
                setProvidersOpen(true);
              }}
            >
              {t("providers.capabilities")}
            </Button>
          </ActionGroup>
          <p role="status">
            {view.preferences[target] === "managed"
              ? t(`speech.readiness.${accountReason(account)}`)
              : !view.supported
                ? t("speech.linuxOnly")
                : t(
                    `speech.states.${view.packs.find((entry) => entry.language === target && entry.engine === view.preferences[target])?.state ?? "unavailable"}`,
                  )}
          </p>
          <ModalDialog
            closeLabel={t("actions.close")}
            isOpen={providersOpen}
            title={t("providers.capabilities")}
            onOpenChange={setProvidersOpen}
          >
            <div className={routingStyles.matrix}>
              <table className={routingStyles.routingMatrix}>
                <thead>
                  <tr>
                    <th scope="col">{t("providers.provider")}</th>
                    <th scope="col">{t("providers.status")}</th>
                    <th scope="col">
                      <span className={styles.actionLabel}>{t("setupUx.manage")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>{(["piper", "pocket", "managed"] as const).map(row)}</tbody>
              </table>
            </div>
          </ModalDialog>
        </>
      )}
      <ModalDialog
        closeLabel={t("actions.close")}
        isOpen={Boolean(editing)}
        title={`${source === "managed" ? t("connectionSettings.routes.managed") : source === "piper" ? "Piper" : "Pocket TTS"} · ${editing ? t(`languages.${editing}`) : ""}`}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        {editing && view && (
          <div className={styles.sections}>
            <p role="status">
              {source === "managed"
                ? t(`speech.readiness.${accountReason(account)}`)
                : !view.supported
                  ? t("speech.linuxOnly")
                  : pack?.state === "unavailable"
                    ? t("speech.qualification")
                    : t(`speech.states.${pack?.state ?? "unavailable"}`)}
            </p>
            {source === "managed" && accountReason(account) === "account" && (
              <NinaAccountSettings />
            )}
            {source === "managed" && accountReason(account) !== "account" && (
              <p>
                {t("speech.balance", { count: account?.access?.speech.remainingCharacters ?? 0 })}
              </p>
            )}
            {source !== "managed" && pack && pack.state !== "unavailable" && (
              <p>{t("setupUx.voiceDownload", { size: (pack.downloadBytes / 1e6).toFixed(0) })}</p>
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
              <p lang={editing}>{samples[editing]}</p>
              {view.preferences[editing] === source && (
                <SpeechButton
                  text={samples[editing]}
                  language={editing}
                  showUnavailableReason={false}
                />
              )}
            </div>
            <ActionGroup align="end">
              <Button
                variant="primary"
                isDisabled={
                  busy ||
                  (!ready && !downloadable) ||
                  (ready && view.preferences[editing] === source) ||
                  Boolean(downloadable && view.packs.some((entry) => entry.state === "downloading"))
                }
                onPress={() => void apply()}
              >
                {t(downloadable ? "setupUx.setUpVoice" : "speech.useVoice")}
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
      {error && (
        <Feedback tone="error" live="polite">
          {t("speech.unavailable")}
        </Feedback>
      )}
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
                    pack.state === "downloading" ||
                    pack.state === "installed",
                )
                .map((pack) => (
                  <div className={styles.pack} key={pack.id}>
                    <div className={styles.details}>
                      <strong>
                        {pack.engine === "piper" ? "Piper" : "Pocket TTS"} ·{" "}
                        {languageDefinitions[pack.language].name}
                      </strong>
                      <span>
                        {pack.voice} · {t(`speech.states.${pack.state}`)}
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
                      {pack.state === "unavailable" && <span>{t("speech.qualification")}</span>}
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
