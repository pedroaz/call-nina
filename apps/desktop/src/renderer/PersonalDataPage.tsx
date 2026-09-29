import type {
  DesktopIpcResponse,
  CallNinaError,
  PersonalDataCleanupScope,
  PersonalDataTable,
} from "@call-nina/contracts";
import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ActionGroup, Page } from "./components/layout/index.js";
import {
  Button,
  Card,
  DiagnosticCode,
  Feedback,
  ModalDialog,
  Muted,
  Tabs,
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
  { id: "practice", tables: ["prepared_activities"] },
  { id: "attempts", tables: ["attempts"] },
  { id: "vocabulary", tables: ["vocabulary_entries"] },
  { id: "voice", tables: ["voice_summaries"] },
  { id: "history", tables: ["history_entries"] },
  { id: "insights", tables: ["mistakes"] },
  { id: "files", tables: ["attachment_metadata"] },
];
const cleanupScopes = ["practice", "vocabulary", "learning"] as const;
const visibleLocations = ["database", "attachments", "bootstrap", "appConfig"];

function DataError({ error }: { error: CallNinaError }) {
  const { t } = useTranslation();
  return (
    <Feedback tone="error" live="assertive">
      <span>{t(error.messageKey)}</span>
      <DiagnosticCode>
        {error.reference.code} · {error.reference.correlationId}
      </DiagnosticCode>
    </Feedback>
  );
}

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
      {error && <DataError error={error} />}
      <ActionGroup>
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
        <Button variant="secondary" isDisabled={pending} onPress={onClose}>
          {t("actions.cancel")}
        </Button>
      </ActionGroup>
    </ModalDialog>
  );
}

export function PersonalDataPage({ onDataCleared }: { onDataCleared: () => void }) {
  const { t, i18n } = useTranslation();
  const [overview, setOverview] = useState<Overview>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<CallNinaError>();
  const [selected, setSelected] = useState<PersonalDataCleanupScope>();
  const [cleared, setCleared] = useState<PersonalDataCleanupScope>();
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
  return (
    <Page
      title={t("personalData.title")}
      description={t("personalData.intro")}
      aria-busy={busy}
      refresh={{ onRefresh: refresh, busy: busy }}
    >
      {error && <DataError error={error} />}
      {busy && !overview && <Feedback live="polite">{t("personalData.loading")}</Feedback>}
      {cleared && (
        <Feedback tone="success" live="polite">
          {t(`personalData.cleanup.${cleared}.success`)}
        </Feedback>
      )}
      {overview && (
        <>
          <div className={styles.folder}>
            <FolderOpen aria-hidden="true" />
            <strong>{t("personalData.folder")}</strong>
            <code className={styles.path}>{overview.dataRoot}</code>
          </div>
          <Tabs
            label={t("personalData.title")}
            items={[
              {
                id: "overview",
                label: t("personalData.tabs.overview"),
                children: (
                  <>
                    <Muted>{t("personalData.overviewHelp")}</Muted>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
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
                    <Muted>{t("personalData.supporting")}</Muted>
                    <Feedback live="off">{t("personalData.privacy")}</Feedback>
                  </>
                ),
              },
              {
                id: "storage",
                label: t("personalData.tabs.storage"),
                children: (
                  <>
                    <Muted>{t("personalData.storageHelp")}</Muted>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
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
                  </>
                ),
              },
              {
                id: "cleanup",
                label: t("personalData.tabs.cleanup"),
                children: (
                  <>
                    <Muted>{t("personalData.cleanup.intro")}</Muted>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <caption>{t("personalData.cleanup.caption")}</caption>
                        <thead>
                          <tr>
                            <th scope="col">{t("personalData.columns.cleanup")}</th>
                            <th scope="col">{t("personalData.columns.removes")}</th>
                            <th scope="col">{t("personalData.columns.action")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cleanupScopes
                            .filter((scope) => scope !== "learning")
                            .map((scope) => (
                              <tr key={scope}>
                                <th scope="row">{t(`personalData.cleanup.${scope}.title`)}</th>
                                <td>
                                  {t(`personalData.cleanup.${scope}.removes`)}
                                  <span className={styles.description}>
                                    {t(`personalData.cleanup.${scope}.keeps`)}
                                  </span>
                                </td>
                                <td>
                                  <Button
                                    variant="secondary"
                                    isDisabled={busy || Boolean(error)}
                                    onPress={() => {
                                      setCleared(undefined);
                                      setSelected(scope);
                                    }}
                                  >
                                    {t(`personalData.cleanup.${scope}.action`)}
                                  </Button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <Card className={styles.reset}>
                      <h2>{t("personalData.cleanup.learning.title")}</h2>
                      <p>{t("personalData.cleanup.learning.removes")}</p>
                      <Muted>{t("personalData.cleanup.learning.keeps")}</Muted>
                      <Button
                        variant="danger"
                        isDisabled={busy || Boolean(error)}
                        onPress={() => {
                          setCleared(undefined);
                          setSelected("learning");
                        }}
                      >
                        {t("personalData.cleanup.learning.action")}
                      </Button>
                    </Card>
                    <Muted>{t("personalData.cleanup.retained")}</Muted>
                  </>
                ),
              },
            ]}
          />
          <Muted>
            {t("personalData.updated", {
              time: new Date(overview.refreshedAt).toLocaleTimeString(i18n.language),
            })}
          </Muted>
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
                setCleared(scope);
                onDataCleared();
                void refresh();
              }}
            />
          )}
        </>
      )}
    </Page>
  );
}
