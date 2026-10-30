import { OperationError } from "./OperationError.js";
import { SettingsRow } from "./SettingsRow.js";
import { SpeechSettings } from "./SpeechSettings.js";
import tableStyles from "./components/layout/Table.module.css";
import type {
  DesktopIpcResponse,
  CallNinaError,
  PersonalDataCleanupScope,
  PersonalDataTable,
} from "@call-nina/contracts";
import { FolderOpen, Volume2, History, BookOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ActionGroup, Page, Section } from "./components/layout/index.js";
import {
  Button,
  Feedback,
  useNotifications,
  ModalDialog,
  Muted,
  TextField,
} from "./components/ui/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import styles from "./PersonalDataPage.module.css";

type Overview = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "personal-data/read" }
>["result"];
type CleanupResult = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "personal-data/clear" }
>["result"];
type BlockReason = Extract<CleanupResult, { status: "blocked" }>["reason"];

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
const visibleLocations = ["database", "attachments", "bootstrap", "appConfig"];

function CleanupDialog({
  scope,
  generation,
  onClose,
  onCleared,
  onBusy,
}: {
  scope: PersonalDataCleanupScope;
  generation: Overview["rootGeneration"];
  onClose: () => void;
  onCleared: (scope: PersonalDataCleanupScope) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<CallNinaError>();
  const [blocked, setBlocked] = useState<BlockReason>();
  const clear = async () => {
    setPending(true);
    onBusy(true);
    setError(undefined);
    setBlocked(undefined);
    try {
      const result = await invokeDesktop("personal-data/clear", {
        scope,
        expectedGeneration: generation,
        confirmed: true,
      });
      if (result.status === "blocked") setBlocked(result.reason);
      else onCleared(scope);
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
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError(undefined);
    try {
      const next = await invokeDesktop("personal-data/read", {});
      if (sequence === requestSequence.current) setOverview(next);
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setError(normalizeDesktopError(cause).detail);
        setOverview(undefined);
        setSelected(undefined);
      }
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    let timer = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "state-invalidated" &&
        ["dashboard", "history", "vocabulary", "settings"].includes(event.scope) &&
        !cleanupBusy.current
      ) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void refresh(), 0);
      }
    });
    return () => {
      requestSequence.current += 1;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);

  const count = (tables: readonly PersonalDataTable[]) =>
    tables.reduce(
      (sum, table) => sum + (overview?.tables.find((entry) => entry.table === table)?.count ?? 0),
      0,
    );
  const content = (
    <>
      {error && <OperationError error={error} />}
      {busy && !overview && <Feedback live="polite">{t("personalData.loading")}</Feedback>}
      {overview && (
        <>
          <Section title={t("setupUx.onDevice")}>
            <SettingsRow
              icon={<FolderOpen aria-hidden="true" />}
              title={t("settings.dataFolder")}
              action={folderAction}
            >
              <span className={styles.path}>{overview.dataRoot}</span>
            </SettingsRow>
            <SettingsRow
              icon={<Volume2 aria-hidden="true" />}
              title={t("speech.cacheTitle")}
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
            />
            <Button
              variant="quiet"
              onPress={() => {
                setDetails("storage");
              }}
            >
              {t("setupUx.storageDetails")}
            </Button>
          </Section>
          <Section title={t("setupUx.privacy")}>
            <p>{t("setupUx.localPrivacy")}</p>
            <p>{t("setupUx.aiPrivacy")}</p>
            <Button
              variant="quiet"
              onPress={() => {
                setDetails("privacy");
              }}
            >
              {t("ui.details")}
            </Button>
          </Section>
          <Section title={t("setupUx.clearLearning")}>
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
                      variant="quiet"
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
            <Button
              variant="quiet"
              isDisabled={busy || Boolean(error)}
              onPress={() => {
                setSelected("learning");
              }}
            >
              {t("personalData.cleanup.learning.action")}
            </Button>
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
                {" "}
                <div className={styles.tableWrap}>
                  <table className={`${tableStyles.table} ${styles.table}`}>
                    <caption>{t("personalData.storageCaption")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("personalData.columns.location")}</th>
                        <th scope="col">{t("personalData.columns.path")}</th>
                        <th scope="col">{t("personalData.columns.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.locations
                        .filter(({ id }) => visibleLocations.includes(id))
                        .map((location) => (
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
              }}
              onCleared={(scope) => {
                setSelected(undefined);
                notify({ message: t(`personalData.cleanup.${scope}.success`), tone: "success" });
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
    <Page
      {...(breadcrumbs ? { breadcrumbs } : {})}
      title={t("settings.tabs.data")}
      refresh={{ onRefresh: refresh, busy }}
    >
      {content}
    </Page>
  );
}
