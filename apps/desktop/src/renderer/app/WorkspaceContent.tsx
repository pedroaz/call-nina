import { languageCapabilities, languageDefinitions } from "@call-nina/contracts";
import { ActionGroup, Page } from "../components/layout/index.js";
import { Button, Card, Feedback, LoadingState } from "../components/ui/index.js";
import { OperationError } from "../components/ui/OperationError.js";
import { NinaHome, emptyNinaHomeDraft } from "../features/home/index.js";
import { LearningPathPage } from "../features/learning-path/index.js";
import { MobilePage } from "../features/mobile/index.js";
import { PracticePage } from "../features/practice/index.js";
import { PersonalDataPage, SettingsPage } from "../features/settings/index.js";
import { StoriesPage } from "../features/stories/index.js";
import { VocabularyPage } from "../features/vocabulary/index.js";
import { WritingWorkspace } from "../learning/activities/WritingWorkspace.js";
import { invokeDesktop, normalizeDesktopError } from "../runtime/ipc.js";
import { type useDesktopWorkspaceController } from "./useDesktopWorkspaceController.js";

export function WorkspaceContent({
  model,
}: {
  model: Pick<
    ReturnType<typeof useDesktopWorkspaceController>,
    | "navigation"
    | "resetNotice"
    | "t"
    | "setResetNotice"
    | "setOperationError"
    | "operationError"
    | "providerUnavailable"
    | "navigate"
    | "setProviderUnavailable"
    | "page"
    | "learningScope"
    | "ninaScopeKey"
    | "ninaDrafts"
    | "setNinaDrafts"
    | "openAi"
    | "launchPractice"
    | "writingOrigin"
    | "practiceContainer"
    | "setPracticeLanguageBlocked"
    | "resultsRequest"
    | "resultsOrigin"
    | "pathHistory"
    | "savedResultsScrollRef"
    | "setWritingDirty"
    | "practiceTab"
    | "setPracticeTab"
    | "uploadPracticeSource"
    | "openCompletionPage"
    | "preparedActivityId"
    | "quickStartId"
    | "activityOrigin"
    | "practiceSeed"
    | "writingPracticeSource"
    | "parent"
    | "writingSeed"
    | "suggestedWriting"
    | "setHelperSelection"
    | "readiness"
    | "initialPath"
    | "setPathLanguageBlocked"
    | "openSavedResults"
    | "setSettingsTab"
    | "setVocabularyLanguageBlocked"
    | "vocabularyDue"
    | "vocabularyViewRequest"
    | "openExternalActivity"
    | "setHelperEpoch"
    | "settingsTab"
    | "reload"
    | "onRunSetup"
    | "refreshScope"
  >;
}) {
  const {
    navigation,
    resetNotice,
    t,
    setResetNotice,
    setOperationError,
    operationError,
    providerUnavailable,
    navigate,
    setProviderUnavailable,
    page,
    learningScope,
    ninaScopeKey,
    ninaDrafts,
    setNinaDrafts,
    openAi,
    launchPractice,
    writingOrigin,
    practiceContainer,
    setPracticeLanguageBlocked,
    resultsRequest,
    resultsOrigin,
    pathHistory,
    savedResultsScrollRef,
    setWritingDirty,
    practiceTab,
    setPracticeTab,
    uploadPracticeSource,
    openCompletionPage,
    preparedActivityId,
    quickStartId,
    activityOrigin,
    practiceSeed,
    writingPracticeSource,
    parent,
    writingSeed,
    suggestedWriting,
    setHelperSelection,
    readiness,
    initialPath,
    setPathLanguageBlocked,
    openSavedResults,
    setSettingsTab,
    setVocabularyLanguageBlocked,
    vocabularyDue,
    vocabularyViewRequest,
    openExternalActivity,
    setHelperEpoch,
    settingsTab,
    reload,
    onRunSetup,
    refreshScope,
  } = model;
  return (
    <>
      {resetNotice && (
        <Feedback live="polite">
          <p>{t("developmentReset.body")}</p>
          <Button
            variant="primary"
            onPress={() => {
              void invokeDesktop("development-notice/dismiss", {})
                .then(() => {
                  setResetNotice(false);
                })
                .catch((cause: unknown) => {
                  setOperationError(normalizeDesktopError(cause).detail);
                });
            }}
          >
            {t("developmentReset.dismiss")}
          </Button>
        </Feedback>
      )}
      {operationError && <OperationError error={operationError} />}
      {providerUnavailable && (
        <Feedback live="assertive" tone="warning">
          <p>{t(`providerAccess.reasons.${providerUnavailable.reason}`)}</p>
          <p>{t("providerAccess.localAvailable")}</p>
          <ActionGroup>
            <Button
              variant="primary"
              onPress={() => {
                navigate("settings");
              }}
            >
              {t("nav.settings")}
            </Button>
            <Button
              variant="quiet"
              onPress={() => {
                setProviderUnavailable(undefined);
              }}
            >
              {t("providerAccess.dismiss")}
            </Button>
          </ActionGroup>
        </Feedback>
      )}
      {page === "nina" && learningScope ? (
        <NinaHome
          onLearningPaths={() => {
            navigate("learningPath");
          }}
          key={ninaScopeKey}
          draft={ninaDrafts[ninaScopeKey] ?? emptyNinaHomeDraft}
          onDraftChange={(draft) => {
            setNinaDrafts((current) => ({ ...current, [ninaScopeKey]: draft }));
          }}
          requestAiAccess={openAi}
          onLaunch={launchPractice}
        />
      ) : null}
      {page === "practice" || (page === "writing" && writingOrigin === "practice") ? (
        <div ref={practiceContainer} hidden={page !== "practice"}>
          <PracticePage
            onLanguageSwitchBlockedChange={setPracticeLanguageBlocked}
            key={ninaScopeKey}
            resultsRequest={resultsRequest}
            onReturnToSource={
              resultsOrigin
                ? () => {
                    navigation.returnFromResults();
                    pathHistory.back();
                  }
                : undefined
            }
            resultsReturnLabel={resultsOrigin ? t(`nav.${resultsOrigin}`) : undefined}
            onPracticeAgain={(seed) => {
              if (seed.kind === "writing") savedResultsScrollRef.current = window.scrollY;
              if (seed.kind === "writing") setWritingDirty(false);
              navigation.practiceAgain(seed);
            }}
            selectedTab={practiceTab}
            onTabChange={setPracticeTab}
            initialPracticeSource={uploadPracticeSource}
            onWriting={(source) => {
              if (pathHistory.view) pathHistory.back();
              navigation.write(source);
            }}
            onResults={(language, rootGeneration) =>
              void openCompletionPage("results", language, rootGeneration)
            }
            onNina={(language, rootGeneration) =>
              void openCompletionPage("nina", language, rootGeneration)
            }
            onReviewVocabulary={(language, rootGeneration) =>
              void openCompletionPage("vocabulary", language, rootGeneration)
            }
            autoStart={Boolean(preparedActivityId && quickStartId === preparedActivityId)}
            targetLanguage={learningScope?.targetLanguage}
            {...(activityOrigin ? { parentLabel: t(`nav.${activityOrigin}`) } : {})}
            onVocabulary={() => {
              navigate("vocabulary");
            }}
            {...(practiceSeed ? { initialPreparation: practiceSeed } : {})}
            {...(preparedActivityId ? { activityId: preparedActivityId } : {})}
            requestAiAccess={openAi}
            onOpenActivity={navigation.openActivity}
            onCloseActivity={navigation.closeActivity}
          />
        </div>
      ) : null}
      {page === "writing" ? (
        <WritingWorkspace
          practiceSource={writingPracticeSource}
          {...(parent ? { breadcrumbs: [parent] } : {})}
          key={writingSeed?.historyEntryId ?? "new-writing"}
          {...(writingSeed
            ? { initialContext: writingSeed.context, initialDraft: writingSeed.draft }
            : suggestedWriting
              ? { initialContext: suggestedWriting }
              : {})}
          onDirtyChange={setWritingDirty}
          onHelperSelection={setHelperSelection}
          requestAiAccess={openAi}
        />
      ) : null}
      {page === "stories" && (
        <StoriesPage
          key={`${String(readiness.dataRoot.status === "ready" ? readiness.dataRoot.generation : 0)}:${learningScope?.learnerId ?? ""}:${learningScope?.targetLanguage ?? ""}`}
        />
      )}
      {page === "mobile" && <MobilePage />}
      {(page === "learningPath" || pathHistory.view === "results") &&
      learningScope &&
      languageCapabilities[learningScope.targetLanguage].structuredPath &&
      learningScope.courseId ===
        languageDefinitions[learningScope.targetLanguage].structuredCourseId ? (
        <div hidden={page !== "learningPath"}>
          <LearningPathPage
            initialDestination={initialPath}
            onLanguageSwitchBlockedChange={setPathLanguageBlocked}
            onNina={() => {
              navigate("nina");
            }}
            requestAiAccess={openAi}
            onOpenResults={(ids) => {
              pathHistory.open("results");
              openSavedResults(ids?.length ? { historyEntryIds: ids } : undefined, "learningPath");
            }}
          />
        </div>
      ) : page === "learningPath" ? (
        <Page title={t("nav.learningPath")}>
          {!learningScope ? (
            <LoadingState live>{t("startup.loading")}</LoadingState>
          ) : (
            <Card as="section">
              <p>
                {t(
                  learningScope.targetLanguage === "de"
                    ? "learningPath.enrollRequired"
                    : "learningPath.languageUnavailable",
                )}
              </p>
              <ActionGroup>
                <Button
                  variant="primary"
                  onPress={() => {
                    setSettingsTab("profile");
                    navigate("settings");
                  }}
                >
                  {t("nav.settings")}
                </Button>
                <Button
                  variant="secondary"
                  onPress={() => {
                    navigate("practice");
                  }}
                >
                  {t("nav.practice")}
                </Button>
              </ActionGroup>
            </Card>
          )}
        </Page>
      ) : null}
      {page === "vocabulary" || resultsOrigin === "vocabulary" ? (
        <div hidden={page !== "vocabulary"}>
          <VocabularyPage
            onUploadPractice={navigation.uploadPractice}
            onLanguageSwitchBlockedChange={setVocabularyLanguageBlocked}
            requestAiAccess={openAi}
            targetLanguage={learningScope?.targetLanguage}
            onOpenActivity={navigation.vocabularyActivity}
            initialDueOnly={vocabularyDue}
            viewRequest={vocabularyViewRequest}
            onNavigate={(destination, scope) => {
              if (destination === "results") openSavedResults(scope, "vocabulary");
              else if (scope?.activityId) openExternalActivity(scope.activityId);
              else navigate(destination);
            }}
          />
        </div>
      ) : null}
      {page === "personalData" ? (
        <PersonalDataPage
          {...(parent ? { breadcrumbs: [parent] } : {})}
          onDataCleared={() => {
            setHelperSelection(undefined);
            setHelperEpoch((value) => value + 1);
            setWritingDirty(false);
            navigation.clearLearning();
          }}
        />
      ) : null}
      {page === "settings" ? (
        <SettingsPage
          readiness={readiness}
          selectedTab={settingsTab}
          onTabChange={setSettingsTab}
          onOpenPersonalData={() => {
            navigate("personalData");
          }}
          onDataRootChanged={reload}
          onRunSetup={onRunSetup}
          onLearningLanguageChange={() => {
            void refreshScope().catch((cause: unknown) => {
              setOperationError(normalizeDesktopError(cause).detail);
            });
          }}
        />
      ) : null}
    </>
  );
}
