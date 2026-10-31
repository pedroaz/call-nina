import { ContentRow, FilterBar } from "../../components/layout/index.js";
import {
  Button,
  ConfirmDialog,
  FieldGroup,
  InfoHint,
  Muted,
  SelectControl,
  ToggleButtonGroup,
} from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { ActivityVisual } from "../../learning/activities/activityPresentation.js";
import type { PracticeLibraryFilter } from "./PracticePage.types.js";
import type { PreparedActivityId } from "../../learning/practice/activity-types.js";
import { type usePracticeLibrary } from "./usePracticeLibrary.js";
import { SavedResults } from "../../learning/results/SavedResults.js";
import styles from "./PracticePage.module.css";

export function PracticeLibrary({
  model,
}: {
  model: Pick<
    ReturnType<typeof usePracticeLibrary>,
    | "libraryBusy"
    | "library"
    | "libraryError"
    | "onReturnToSource"
    | "resultsReturnLabel"
    | "t"
    | "savedView"
    | "setSavedView"
    | "librarySearch"
    | "setLibrarySearch"
    | "libraryFilter"
    | "setLibraryFilter"
    | "preparedActivities"
    | "libraryMutationError"
    | "deleting"
    | "filteredActivities"
    | "setResultsScope"
    | "deletePreparedActivity"
    | "openSavedActivity"
    | "resultsScope"
    | "requestAiAccess"
    | "returnPositionRef"
    | "onPracticeAgain"
    | "onOpenActivity"
    | "onWriting"
  >;
}) {
  const {
    libraryBusy,
    library,
    libraryError,
    onReturnToSource,
    resultsReturnLabel,
    t,
    savedView,
    setSavedView,
    librarySearch,
    setLibrarySearch,
    libraryFilter,
    setLibraryFilter,
    preparedActivities,
    libraryMutationError,
    deleting,
    filteredActivities,
    setResultsScope,
    deletePreparedActivity,
    openSavedActivity,
    resultsScope,
    requestAiAccess,
    returnPositionRef,
    onPracticeAgain,
    onOpenActivity,
    onWriting,
  } = model;
  return (
    <section
      className={styles.generatedLibrary}
      aria-busy={libraryBusy}
      data-root-generation={library.rootGeneration}
      data-learning-language={library.learningScope?.targetLanguage}
      data-library-ready={library.loaded && !libraryBusy && !libraryError}
    >
      {onReturnToSource && (
        <Button variant="quiet" onPress={onReturnToSource}>
          {resultsReturnLabel ?? t("pathFlow.backLesson")}
        </Button>
      )}
      <ToggleButtonGroup label={t("practice.library.title")}>
        {(["activities", "results"] as const).map((view) => (
          <Button
            key={view}
            density="compact"
            variant="secondary"
            aria-pressed={savedView === view}
            onPress={() => {
              setSavedView(view);
            }}
          >
            {t(`savedResults.${view}`)}
          </Button>
        ))}
      </ToggleButtonGroup>
      <div className={styles.generatedLibrary} hidden={savedView !== "activities"}>
        <FilterBar columns={2} label={t("practice.library.filterLabel")}>
          <FieldGroup>
            {t("savedResults.searchActivities")}
            <input
              type="search"
              value={librarySearch}
              maxLength={160}
              onChange={(event) => {
                setLibrarySearch(event.target.value);
              }}
            />
          </FieldGroup>
          <FieldGroup>
            {t("history.filters.activityType")}
            <SelectControl
              value={libraryFilter}
              onChange={(event) => {
                setLibraryFilter(event.target.value as PracticeLibraryFilter);
              }}
            >
              {(
                [
                  "all",
                  "flashcards",
                  "custom-lesson",
                  "grammar",
                  "reading",
                  "writing",
                  "vocabulary-review",
                  "placement",
                  "codex-listening",
                  "voice-speaking",
                ] as const
              ).map((filter) => (
                <option key={filter} value={filter}>
                  {["writing", "vocabulary-review", "placement"].includes(filter)
                    ? t(`history.activityTypes.${filter}`)
                    : t(`practice.library.filters.${filter}`)}
                </option>
              ))}
            </SelectControl>
          </FieldGroup>
        </FilterBar>
        {preparedActivities.length > 0 && (
          <span className={styles.countBadge}>
            {t("practice.library.count", { count: preparedActivities.length })}
          </span>
        )}
        {libraryMutationError && <OperationError error={libraryMutationError} />}
        {library.error && (
          <OperationError error={library.error}>
            <Button
              variant="secondary"
              isPending={libraryBusy}
              isDisabled={deleting}
              onPress={() => void library.refresh()}
            >
              {t("actions.retry")}
            </Button>
          </OperationError>
        )}
        {!libraryError && libraryBusy && preparedActivities.length === 0 && (
          <Muted as="p">{t("practice.library.loading")}</Muted>
        )}
        {!libraryError && preparedActivities.length === 0 && !libraryBusy && (
          <Muted as="p">
            {t(
              libraryFilter === "all"
                ? "practice.library.empty"
                : "practice.library.noFilterResults",
            )}
          </Muted>
        )}
        {filteredActivities.length > 0 && (
          <div className={styles.generatedActivityList}>
            {filteredActivities.map((activity) => {
              const deletionBlocked = activity.deletionStatus === "retained-data";
              const deleteLabel = deletionBlocked
                ? t(`practice.library.deleteBlocked.${activity.deletionStatus}`, {
                    title: activity.title,
                  })
                : t("practice.library.deleteAction", { title: activity.title });
              return (
                <ContentRow
                  key={activity.activityId}
                  actions={
                    <div className={styles.generatedActivityActions}>
                      {activity.resultCount > 0 && (
                        <Button
                          variant="secondary"
                          density="compact"
                          onPress={() => {
                            setResultsScope({
                              activityId: activity.activityId,
                              label: activity.title,
                            });
                            setSavedView("results");
                          }}
                        >
                          {t("savedResults.results")}
                        </Button>
                      )}
                      <div className={styles.generatedActivityMenu}>
                        {deletionBlocked ? (
                          <InfoHint
                            label={t("practice.library.deleteAction", {
                              title: activity.title,
                            })}
                          >
                            {deleteLabel}
                          </InfoHint>
                        ) : (
                          <ConfirmDialog
                            body={t(
                              activity.activityType === "flashcards"
                                ? "flashcards.deleteBody"
                                : activity.deletionStatus === "cascade"
                                  ? "practice.library.deleteCascadeBody"
                                  : "practice.library.deleteBody",
                            )}
                            cancel={t("actions.cancel")}
                            confirm={t("practice.library.deleteConfirm")}
                            title={t("practice.library.deleteTitle", {
                              title: activity.title,
                            })}
                            trigger={t("practice.library.delete")}
                            triggerNode={
                              <Button variant="quiet" density="compact" aria-label={deleteLabel}>
                                {t("practice.library.delete")}
                              </Button>
                            }
                            onConfirm={() => deletePreparedActivity(activity)}
                          />
                        )}
                      </div>
                    </div>
                  }
                >
                  <Button
                    id={`activity-open-${activity.activityId}`}
                    aria-label={t("practice.library.open", { title: activity.title })}
                    className={styles.generatedActivityOpen}
                    variant="quiet"
                    onPress={() => {
                      void openSavedActivity(activity.activityId);
                    }}
                  >
                    <ActivityVisual kind={activity.activityType} />
                    <span className={styles.generatedActivityCopy}>
                      <strong>{activity.title}</strong>
                      <span>
                        {t(`practice.library.types.${activity.activityType}`)} ·{" "}
                        {activity.preparedAt.slice(0, 10)}
                        {activity.resultCount > 0
                          ? ` · ${t("savedResults.count", { count: activity.resultCount })}`
                          : ""}
                        {activity.deletionStatus !== "available"
                          ? ` · ${t(`practice.library.deleteStates.${activity.deletionStatus}`)}`
                          : ""}
                      </span>
                    </span>
                  </Button>
                </ContentRow>
              );
            })}
          </div>
        )}
        {library.hasMore && (
          <Button
            variant="secondary"
            isDisabled={libraryBusy}
            onPress={() => void library.loadMore()}
          >
            {t("practice.library.loadMore")}
          </Button>
        )}
      </div>
      <SavedResults
        scope={resultsScope}
        onClearScope={() => {
          setResultsScope(undefined);
        }}
        view={savedView}
        requestAiAccess={requestAiAccess}
        onChanged={() => {
          void library.refresh();
        }}
        onPracticeAgain={(seed) => {
          returnPositionRef.current = {
            y: window.scrollY,
            id: seed.kind === "exercise" ? seed.activityId : "",
          };
          if (onPracticeAgain) onPracticeAgain(seed);
          else if (seed.kind === "exercise") onOpenActivity(seed.activityId as PreparedActivityId);
          else onWriting?.();
        }}
      />
    </section>
  );
}
