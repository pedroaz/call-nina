import {
  Activity,
  BookOpen,
  Database,
  FileText,
  Info,
  Plug,
  Save,
  ShieldCheck,
} from "lucide-react";
import { ActionGroup, Page, Section } from "../../components/layout/index.js";
import { SettingsLink, SettingsRow } from "../../components/layout/SettingsRow.js";
import {
  Button,
  Feedback,
  ItemList,
  LoadingState,
  ModalDialog,
  Tabs,
} from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { LearningProfileFields } from "../../learning/profile/LearningProfileFields.js";
import { AiSettingsSection } from "./AiSettingsSection.js";
import { PersonalDataPage } from "./PersonalDataPage.js";
import styles from "./SettingsPage.module.css";
import { dataRootWarningKeys, type SettingsPageProps } from "./SettingsPage.types.js";

import { useSettingsPageController } from "./useSettingsPageController.js";

export function SettingsPage(props: SettingsPageProps) {
  const model = useSettingsPageController(props);
  const {
    persisted,
    loading,
    busy,
    dirty,
    connectionPending,
    loginId,
    onRunSetup,
    t,
    error,
    settingsReadError,
    load,
    notice,
    selectedTab,
    onTabChange,
    draft,
    selectTarget,
    setDraft,
    setFolderOpen,
    folderOpen,
    readiness,
    dataRootSelection,
    chooseDataRoot,
    confirmDataRoot,
    setDataRootSelection,
    technicalOpen,
    diagnosticsFailure,
    readDiagnostics,
    diagnostics,
    exportDiagnostics,
    setTechnicalOpen,
    clearLogs,
    save,
  } = model;
  return (
    <Page
      width="form"
      className={styles.settingsPage}
      data-settings-root={persisted?.dataRoot.generation}
      data-settings-language={persisted?.settings.learningScope.targetLanguage}
      data-settings-ready={Boolean(persisted) && !loading && !busy && !dirty && !connectionPending}
      actions={
        <ActionGroup>
          <Button
            variant="quiet"
            isDisabled={loading || busy || dirty || connectionPending || Boolean(loginId)}
            onPress={onRunSetup}
          >
            {t("onboarding.runAgain")}
          </Button>
        </ActionGroup>
      }
      title={t("settings.title")}
    >
      {loading && <LoadingState live>{t("settings.loading")}</LoadingState>}
      {error && <OperationError error={error} />}
      {settingsReadError && (
        <OperationError error={settingsReadError}>
          <Button
            variant="secondary"
            isPending={loading}
            isDisabled={busy}
            onPress={() => void load()}
          >
            {t("actions.retry")}
          </Button>
        </OperationError>
      )}
      {notice && <Feedback live="polite">{notice}</Feedback>}

      <Tabs
        selectedKey={selectedTab === "speech" ? "ai" : selectedTab}
        onSelectionChange={onTabChange}
        label={t("settings.title")}
        items={[
          {
            id: "profile",
            label: t("settings.tabs.profile"),
            icon: <BookOpen aria-hidden="true" />,
            children: (
              <>
                {draft && (
                  <div className={styles.learningProfile}>
                    <LearningProfileFields
                      value={draft}
                      language={draft.learningScope.targetLanguage}
                      disabled={busy}
                      onLanguage={(language) => void selectTarget(language)}
                      onChange={(key, value) => {
                        setDraft((current) => (current ? { ...current, [key]: value } : current));
                      }}
                    />
                  </div>
                )}
              </>
            ),
          },
          {
            id: "ai",
            label: t("settings.tabs.ai"),
            icon: <Plug aria-hidden="true" />,
            children: <AiSettingsSection model={model} />,
          },
          {
            id: "data",
            label: t("settings.tabs.data"),
            icon: <ShieldCheck aria-hidden="true" />,
            children: (
              <>
                <PersonalDataPage
                  embedded
                  onDataCleared={() => void load()}
                  folderAction={
                    <Button
                      variant="secondary"
                      isDisabled={busy || dirty || connectionPending}
                      onPress={() => {
                        setFolderOpen(true);
                      }}
                    >
                      {t("setupUx.change")}
                    </Button>
                  }
                />
                <ModalDialog
                  closeLabel={t("actions.close")}
                  isOpen={folderOpen}
                  title={t("settings.dataSwitch")}
                  isDismissable={!busy}
                  onOpenChange={setFolderOpen}
                >
                  <Section className={styles.settingsSection} aria-labelledby="settings-data-title">
                    <h2 id="settings-data-title">{t("settings.dataTitle")}</h2>
                    {readiness.dataRoot.status === "ready" && (
                      <dl className={styles.detailList}>
                        <div>
                          <dt>{t("settings.dataFolder")}</dt>
                          <dd>{readiness.dataRoot.displayName}</dd>
                        </div>
                      </dl>
                    )}
                    {!dataRootSelection ? (
                      <Button
                        variant="primary"
                        isDisabled={busy}
                        onPress={() => void chooseDataRoot()}
                      >
                        {t("settings.dataSwitch")}
                      </Button>
                    ) : (
                      <div
                        className={styles.switchConfirmation}
                        role="group"
                        aria-label={t("settings.dataSwitchConfirmTitle")}
                      >
                        <p>
                          {t("settings.dataSwitchConfirm", {
                            name: dataRootSelection.displayName,
                            generation: dataRootSelection.generation,
                          })}
                        </p>
                        {dataRootSelection.warnings.length > 0 && (
                          <ItemList>
                            {dataRootSelection.warnings.map((warning) => (
                              <li key={warning}>{t(dataRootWarningKeys[warning])}</li>
                            ))}
                          </ItemList>
                        )}
                        <ActionGroup>
                          <Button
                            variant="primary"
                            isDisabled={busy}
                            onPress={() => void confirmDataRoot()}
                          >
                            {t("settings.dataSwitchConfirmAction")}
                          </Button>
                          <Button
                            variant="secondary"
                            isDisabled={busy}
                            onPress={() => {
                              setDataRootSelection(undefined);
                            }}
                          >
                            {t("actions.cancel")}
                          </Button>
                        </ActionGroup>
                      </div>
                    )}
                  </Section>
                </ModalDialog>
              </>
            ),
          },
          {
            id: "diagnostics",
            label: t("settings.tabs.diagnostics"),
            icon: <Activity aria-hidden="true" />,
            children: (
              <>
                <Section
                  className={`${styles.settingsSection} ${styles.settingsGroup}`}
                  aria-labelledby="settings-diagnostics-title"
                >
                  <h2 id="settings-diagnostics-title">{t("settings.diagnosticsTitle")}</h2>
                  {!technicalOpen && diagnosticsFailure}
                  <SettingsRow
                    icon={<Database aria-hidden="true" />}
                    title={t("setupUx.checkApp")}
                    action={
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void readDiagnostics()}
                      >
                        {t("setupUx.runCheck")}
                      </Button>
                    }
                  >
                    {diagnostics && <span role="status">{t("setupUx.storageReadable")}</span>}
                  </SettingsRow>
                  <SettingsRow
                    icon={<FileText aria-hidden="true" />}
                    title={t("setupUx.supportReport")}
                    action={
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void exportDiagnostics()}
                      >
                        {t("setupUx.exportReport")}
                      </Button>
                    }
                  />
                  <SettingsLink
                    leadingIcon={<Info aria-hidden="true" />}
                    aria-haspopup="dialog"
                    onPress={() => {
                      setTechnicalOpen(true);
                    }}
                  >
                    {t("setupUx.technicalDetails")}
                  </SettingsLink>
                  <ModalDialog
                    closeLabel={t("actions.close")}
                    isOpen={technicalOpen}
                    title={t("setupUx.technicalDetails")}
                    onOpenChange={setTechnicalOpen}
                  >
                    {diagnosticsFailure}
                    {diagnostics && (
                      <dl className={styles.detailList}>
                        <div>
                          <dt>{t("settings.diagnosticsGeneration")}</dt>
                          <dd>{diagnostics.dataRootGeneration}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.diagnosticsSchema")}</dt>
                          <dd>{diagnostics.databaseSchemaVersion}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.diagnosticsDatabase")}</dt>
                          <dd>{diagnostics.journalMode.toUpperCase()}</dd>
                        </div>
                        <div>
                          <dt>{t("settings.diagnosticsLogs")}</dt>
                          <dd>{diagnostics.logFileCount}</dd>
                        </div>
                      </dl>
                    )}
                    <ActionGroup>
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void readDiagnostics()}
                      >
                        {t("setupUx.runCheck")}
                      </Button>
                      <Button
                        variant="secondary"
                        isDisabled={busy}
                        onPress={() => void clearLogs()}
                      >
                        {t("settings.clearLogs")}
                      </Button>
                    </ActionGroup>
                  </ModalDialog>
                </Section>
              </>
            ),
          },
        ]}
      />

      {draft && (selectedTab === "profile" || dirty) && (
        <div
          className={styles.settingsActions}
          role="group"
          aria-label={t("settings.profileTitle")}
        >
          <Button
            variant="secondary"
            isDisabled={busy || !persisted || !dirty}
            onPress={() => {
              if (persisted) setDraft(persisted.settings);
            }}
          >
            {t("settings.discard")}
          </Button>
          <Button variant="primary" isDisabled={busy || !dirty} onPress={() => void save()}>
            <Save aria-hidden="true" />
            {t("settings.save")}
          </Button>
        </div>
      )}
    </Page>
  );
}
