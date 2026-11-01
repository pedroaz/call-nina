import type {
  CallNinaError,
  DesktopIpcResponse,
  PersonalDataCleanupScope,
  PersonalDataTable,
} from "@call-nina/contracts";
import { BookOpen, FolderOpen, HardDrive, History, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsLink, SettingsRow } from "../../components/layout/SettingsRow.js";
import tableStyles from "../../components/layout/Table.module.css";
import { OperationError } from "../../components/ui/OperationError.js";
import { SpeechSettings } from "../../learning/speech/SpeechSettings.js";
import { CleanupDialog } from "./CleanupDialog.js";

import { ActionGroup, Page, Section } from "../../components/layout/index.js";
import { Button, Feedback, ModalDialog, useNotifications } from "../../components/ui/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "../../runtime/ipc.js";
import styles from "./PersonalDataPage.module.css";

type Overview = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "personal-data/read" }
>["result"];

const categories: ReadonlyArray<{ id: string; tables: readonly PersonalDataTable[] }> = [
  { id: "profile", tables: ["learner_profiles", "language_profiles"] },
  { id: "preferences", tables: ["learner_settings"] },
  { id: "practice", tables: ["prepared_activities", "story_positions"] },
  { id: "attempts", tables: ["attempts"] },
  { id: "vocabulary", tables: ["vocabulary_entries"] },
  { id: "voice", tables: ["voice_summaries"] },
  { id: "history", tables: ["history_entries"] },
  { id: "insights", tables: ["mistakes"] },
  { id: "files", tables: ["attachment_metadata"] },
];
const cleanupScopes = ["practice", "vocabulary", "learning"] as const;

export function PersonalDataPage({
  onDataCleared,
  breadcrumbs,
  embedded = false,
  folderAction,
}: {
  onDataCleared: () => void;
  embedded?: boolean;
  folderAction?: ReactNode;
  breadcrumbs?: ReadonlyArray<{ label: string; onPress: () => void }>;
}) {
  const { t, i18n } = useTranslation();
  const { notify } = useNotifications();
  const [details, setDetails] = useState<"storage" | "privacy" | "audio">();
  const [overview, setOverview] = useState<Overview>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<CallNinaError>();
  const [selected, setSelected] = useState<PersonalDataCleanupScope>();
  const requestSequence = useRef(0);
  const cleanupBusy = useRef(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const refresh = useCallback(async () => {
    if (cleanupBusy.current) return;
    const sequence = ++requestSequence.current;
    setBusy(true);
    try {
      const next = await invokeDesktop("personal-data/read", {});
      if (sequence === requestSequence.current) {
        setOverview(next);
        setError(undefined);
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setError(normalizeDesktopError(cause).detail);
      }
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    let timer = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        requestSequence.current = requestSequence.current + 1;
        setOverview(undefined);
        setDetails(undefined);
        setSelected(undefined);
        setError(undefined);
        void refresh();
      }
      if (
        event.event === "state-invalidated" &&
        ["dashboard", "history", "vocabulary", "settings", "ai-connections"].includes(
          event.scope,
        ) &&
        !cleanupBusy.current
      ) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void refresh(), 0);
      }
    });
    return () => {
      requestSequence.current += 1;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    if (!details) return;
    const initial = window.setTimeout(() => {
      if (details === "storage" || details === "privacy") void refresh();
    }, 0);
    const timer = window.setInterval(() => {
      if (!cleanupBusy.current) void refresh();
    }, 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [details, refresh]);
  const size = (bytes: number | null) => {
    if (bytes === null) return "—";
    const [unit, divisor] =
      bytes >= 1e9
        ? (["gigabyte", 1e9] as const)
        : bytes >= 1e6
          ? (["megabyte", 1e6] as const)
          : bytes >= 1e3
            ? (["kilobyte", 1e3] as const)
            : (["byte", 1] as const);
    return new Intl.NumberFormat(i18n.language, {
      style: "unit",
      unit,
      maximumFractionDigits: 1,
    }).format(bytes / divisor);
  };
  const storedSize = (ids: readonly Overview["locations"][number]["id"][]) => {
    const locations = overview?.locations.filter((location) => ids.includes(location.id)) ?? [];
    return size(
      locations.length !== ids.length ||
        locations.some((location) => location.status === "unavailable")
        ? null
        : locations.reduce((sum, location) => sum + (location.bytes ?? 0), 0),
    );
  };
  const count = (tables: readonly PersonalDataTable[]) =>
    tables.reduce(
      (sum, table) => sum + (overview?.tables.find((entry) => entry.table === table)?.count ?? 0),
      0,
    );
  const readFailure = error && (
    <OperationError error={error}>
      <Button
        variant="secondary"
        isPending={busy}
        isDisabled={cleanupPending}
        onPress={() => void refresh()}
      >
        {t("actions.retry")}
      </Button>
    </OperationError>
  );
  const content = (
    <>
      {!details && readFailure}
      {busy && !overview && <Feedback live="polite">{t("personalData.loading")}</Feedback>}
      {overview && (
        <>
          <Section className={styles.settingsGroup} title={t("setupUx.onDevice")}>
            <SettingsRow
              icon={<FolderOpen aria-hidden="true" />}
              title={t("settings.dataFolder")}
              action={folderAction}
            >
              <span className={styles.path}>{overview.dataRoot}</span>
            </SettingsRow>
            <SettingsRow
              icon={<HardDrive aria-hidden="true" />}
              title={t("personalData.locations.textModels.title")}
              action={<span className={styles.count}>{storedSize(["textModels"])}</span>}
            />
            <SettingsRow
              icon={<Volume2 aria-hidden="true" />}
              title={t("speech.storageTitle")}
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    setDetails("audio");
                  }}
                >
                  {t("setupUx.manageDownloads")}
                </Button>
              }
            >
              {storedSize(["speechModels", "preparedSpeech", "curriculumAudio", "privateAudio"])}
            </SettingsRow>
            <SettingsLink
              leadingIcon={<HardDrive aria-hidden="true" />}
              aria-haspopup="dialog"
              onPress={() => {
                setDetails("storage");
              }}
            >
              {t("setupUx.storageDetails")}
            </SettingsLink>
          </Section>
          <Section title={t("setupUx.privacy")}>
            <div className={styles.privacyCopy}>
              <p>{t("setupUx.localPrivacy")}</p>
              <p>{t("setupUx.aiPrivacy")}</p>
            </div>
            <SettingsLink
              aria-haspopup="dialog"
              onPress={() => {
                setDetails("privacy");
              }}
            >
              {t("ui.details")}
            </SettingsLink>
          </Section>
          <Section className={styles.settingsGroup} title={t("setupUx.clearLearning")}>
            {cleanupScopes
              .filter((scope) => scope !== "learning")
              .map((scope) => (
                <SettingsRow
                  key={scope}
                  icon={
                    scope === "practice" ? (
                      <History aria-hidden="true" />
                    ) : (
                      <BookOpen aria-hidden="true" />
                    )
                  }
                  title={t(`personalData.cleanup.${scope}.title`)}
                  action={
                    <Button
                      variant="dangerQuiet"
                      isDisabled={busy || Boolean(error)}
                      onPress={() => {
                        setSelected(scope);
                      }}
                    >
                      {t(`personalData.cleanup.${scope}.action`)}
                    </Button>
                  }
                />
              ))}
            <SettingsRow
              icon={<Trash2 aria-hidden="true" />}
              title={t("personalData.cleanup.learning.title")}
              action={
                <Button
                  variant="dangerQuiet"
                  isDisabled={busy || Boolean(error)}
                  onPress={() => {
                    setSelected("learning");
                  }}
                >
                  {t("personalData.cleanup.learning.action")}
                </Button>
              }
            />
          </Section>
          <ModalDialog
            closeLabel={t("actions.close")}
            isOpen={Boolean(details)}
            title={t(
              details === "audio"
                ? "speech.storageTitle"
                : details === "privacy"
                  ? "setupUx.privacy"
                  : "setupUx.storageDetails",
            )}
            onOpenChange={(open) => {
              if (!open) setDetails(undefined);
            }}
          >
            {details === "audio" && <SpeechSettings mode="storage" />}
            {details === "privacy" && readFailure}
            {details === "storage" && (
              <>
                {error && <OperationError error={error} />}
                <ActionGroup>
                  <Button
                    variant="secondary"
                    isPending={busy}
                    pendingLabel={t("personalData.recheckingStorage")}
                    isDisabled={cleanupPending}
                    onPress={() => void refresh()}
                  >
                    {t("personalData.recheckStorage")}
                  </Button>
                </ActionGroup>
              </>
            )}
            {details === "privacy" && (
              <div className={styles.details}>
                <p>{t("folder.privacyBody")}</p>
                <p>{t("setupUx.aiPrivacy")}</p>
                <p>{t("setupUx.audioPrivacy")}</p>
                <div className={styles.tableWrap}>
                  <table className={`${tableStyles.table} ${styles.table}`}>
                    <caption>{t("personalData.overviewCaption")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("personalData.columns.data")}</th>
                        <th scope="col">{t("personalData.columns.purpose")}</th>
                        <th scope="col">{t("personalData.columns.saved")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map(({ id, tables }) => (
                        <tr key={id}>
                          <th scope="row">
                            <strong>{t(`personalData.categories.${id}.title`)}</strong>
                            <span className={styles.description}>
                              {t(`personalData.categories.${id}.contains`)}
                            </span>
                          </th>
                          <td>{t(`personalData.categories.${id}.purpose`)}</td>
                          <td className={styles.count}>
                            {count(tables).toLocaleString(i18n.language)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {details === "storage" && (
              <div className={styles.details}>
                <div className={styles.tableWrap}>
                  <table className={`${tableStyles.table} ${styles.table} ${styles.storageTable}`}>
                    <caption>{t("personalData.storageCaption")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("personalData.columns.location")}</th>
                        <th scope="col">{t("personalData.columns.path")}</th>
                        <th scope="col">{t("personalData.columns.status")}</th>
                        <th scope="col">{t("personalData.columns.size")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.locations.map((location) => (
                        <tr key={location.id}>
                          <th scope="row">
                            {t(`personalData.locations.${location.id}.title`)}
                            <span className={styles.description}>
                              {t(`personalData.locations.${location.id}.description`)}
                            </span>
                          </th>
                          <td>
                            <code className={styles.path}>{location.path}</code>
                          </td>
                          <td>{t(`personalData.status.${location.status}`)}</td>
                          <td className={styles.count}>{size(location.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </ModalDialog>
          {selected && (
            <CleanupDialog
              key={selected}
              scope={selected}
              generation={overview.rootGeneration}
              onClose={() => {
                setSelected(undefined);
              }}
              onBusy={(pending) => {
                cleanupBusy.current = pending;
                setCleanupPending(pending);
                if (pending) {
                  requestSequence.current = requestSequence.current + 1;
                  setBusy(false);
                } else void refresh();
              }}
              onPartial={() => {
                onDataCleared();
                void refresh();
              }}
              onCleared={(scope) => {
                setSelected(undefined);
                notify({ message: `personalData.cleanup.${scope}.success`, tone: "success" });
                onDataCleared();
                void refresh();
              }}
            />
          )}
        </>
      )}
    </>
  );
  return embedded ? (
    <div className={styles.details}>{content}</div>
  ) : (
    <Page {...(breadcrumbs ? { breadcrumbs } : {})} title={t("settings.tabs.data")}>
      {content}
    </Page>
  );
}
