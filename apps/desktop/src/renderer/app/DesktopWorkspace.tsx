import { useAnalyticsScreen } from "../runtime/usage-analytics.js";
import { SidebarFeedback } from "./SidebarFeedback.js";
import { Settings } from "lucide-react";
import { ActionGroup, AppShell as ApplicationShell } from "../components/layout/index.js";
import { Button, ModalDialog } from "../components/ui/index.js";
import { UploadsLibrary } from "../features/uploads/index.js";
import { VocabularyLearningNotice } from "../features/vocabulary/index.js";
import { ContextualHelper } from "../learning/helper/ContextualHelper.js";
import { UploadLibraryComponent } from "../learning/uploads/uploads-library-context.js";
import type { UploadsLibraryProps } from "../learning/uploads/UploadsLibrary.types.js";
import { VocabularyNavigation } from "../learning/vocabulary/VocabularyUpdateSummary.js";
import { ProviderSettingsNavigation } from "../runtime/navigation-context.js";
import { FirstAiReminder, navigation, type DesktopWorkspaceProps } from "./App.types.js";
import { SidebarAccount } from "./SidebarAccount.js";
import { SidebarLanguages } from "./SidebarLanguages.js";
import { SidebarModelControl } from "./SidebarModelControl.js";
import { WorkspaceContent } from "./WorkspaceContent.js";

import { useDesktopWorkspaceController } from "./useDesktopWorkspaceController.js";

const renderUploadLibrary = (props: UploadsLibraryProps) => <UploadsLibrary {...props} />;

export function DesktopWorkspace(props: DesktopWorkspaceProps) {
  const model = useDesktopWorkspaceController(props);
  useAnalyticsScreen(model.page);
  const {
    navigation: workspaceNavigation,
    vocabularyActivityId,
    learningScope,
    navigate,
    shellPage,
    t,
    page,
    openAi,
    setWritingDirty,
    readiness,
    setSettingsTab,
    openExternalActivity,
    helperEpoch,
    helperSelection,
    helperOpen,
    navCollapsed,
    switchingLanguage,
    languageSwitchBlocked,
    selectTarget,
    moveNavFocus,
    wideHelper,
    setNavPreference,
    setHelperPreference,
    reminderOpen,
    setReminderOpen,
    disclosure,
    pendingNavigation,
    setPendingNavigation,
    applyNavigation,
    returnTo,
  } = model;
  return (
    <UploadLibraryComponent.Provider value={renderUploadLibrary}>
      <ProviderSettingsNavigation.Provider value={model.openProviderSettings}>
        <VocabularyNavigation.Provider
          value={{
            activityId: vocabularyActivityId,
            view: (activityId) => {
              workspaceNavigation.viewVocabulary(
                activityId && learningScope
                  ? { activityId, language: learningScope.targetLanguage }
                  : undefined,
              );
              navigate("vocabulary");
            },
          }}
        >
          <ApplicationShell
            activePage={shellPage}
            brandName={t("app.name")}
            content={<WorkspaceContent model={model} />}
            helper={
              <ContextualHelper
                key={helperEpoch}
                selection={helperSelection}
                targetLanguage={learningScope?.targetLanguage}
                requestAiAccess={openAi}
              />
            }
            helperOpen={helperOpen}
            helperTitle={t("dashboard.helperTitle")}
            helperToggleLabel={helperOpen ? t("actions.hideHelper") : t("actions.showHelper")}
            navCollapsed={navCollapsed}
            navigation={navigation.map(({ page: destination, icon }) => ({
              page: destination,
              icon,
              disabled: destination === "community",
              label: t(`nav.${destination}`),
              ...(destination === "vocabulary"
                ? {
                    feedback: <VocabularyLearningNotice />,
                  }
                : {}),
            }))}
            settingsNavigation={{ page: "settings", icon: Settings, label: t("nav.settings") }}
            feedbackAction={<SidebarFeedback />}
            accountWidget={<SidebarAccount collapsed={navCollapsed} />}
            navigationLabel={t("nav.label")}
            navFooter={
              <>
                {learningScope && (
                  <span
                    hidden
                    data-learning-root={
                      readiness.dataRoot.status === "ready"
                        ? readiness.dataRoot.generation
                        : undefined
                    }
                  />
                )}
                <SidebarLanguages
                  language={learningScope?.targetLanguage}
                  disabled={switchingLanguage || languageSwitchBlocked}
                  notice={
                    languageSwitchBlocked && page !== "settings"
                      ? t("settings.finishBeforeSwitch")
                      : undefined
                  }
                  collapsed={navCollapsed}
                  onLanguage={(language) => void selectTarget(language)}
                />
                <SidebarModelControl
                  language={learningScope?.targetLanguage ?? "de"}
                  collapsed={navCollapsed}
                  onConfigure={() => {
                    setSettingsTab("ai");
                    navigate("settings");
                  }}
                />
              </>
            }
            navToggleLabel={
              navCollapsed ? t("actions.expandNavigation") : t("actions.collapseNavigation")
            }
            onMoveNavFocus={moveNavFocus}
            onNavigate={(destination) => {
              navigate(destination);
              if (!wideHelper) setNavPreference(true);
            }}
            onToggleHelper={() => {
              setHelperPreference(!helperOpen);
            }}
            onToggleNavigation={() => {
              setNavPreference(!navCollapsed);
            }}
          />
          {reminderOpen && (
            <FirstAiReminder
              close={(acknowledged) => {
                setReminderOpen(false);
                for (const resolve of disclosure.current.splice(0)) resolve(acknowledged);
              }}
            />
          )}
          {pendingNavigation && (
            <ModalDialog
              isOpen
              title={t("writing.unsavedTitle")}
              onOpenChange={(open) => {
                if (!open) setPendingNavigation(undefined);
              }}
            >
              <p>{t("writing.unsavedBody")}</p>
              <ActionGroup align="end">
                <Button
                  variant="secondary"
                  onPress={() => {
                    setPendingNavigation(undefined);
                  }}
                >
                  {t("writing.keepEditing")}
                </Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    setWritingDirty(false);
                    if (pendingNavigation.mode === "normal")
                      applyNavigation(pendingNavigation.destination);
                    else if (pendingNavigation.mode === "return")
                      returnTo(pendingNavigation.destination);
                    else openExternalActivity(pendingNavigation.activityId);
                    setPendingNavigation(undefined);
                  }}
                >
                  {t("writing.leave")}
                </Button>
              </ActionGroup>
            </ModalDialog>
          )}
        </VocabularyNavigation.Provider>
      </ProviderSettingsNavigation.Provider>
    </UploadLibraryComponent.Provider>
  );
}
