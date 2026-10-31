import { useEffect } from "react";
import { ActivitySourceContext } from "../../components/activity/ActivityWorkspace.js";
import { Page } from "../../components/layout/index.js";
import { Tabs } from "../../components/ui/index.js";
import { type PracticePageProps } from "./PracticePage.types.js";
import { UploadSourceEvidence } from "../../learning/uploads/UploadSourceEvidence.js";
import { PracticeLibrary } from "./PracticeLibrary.js";
import styles from "./PracticePage.module.css";
import { PracticePreparation } from "./PracticePreparation.js";

import { PracticeActivity } from "../../learning/practice/PracticeActivity.js";
import { useActivityController } from "../../learning/practice/useActivityController.js";
import { usePracticePreparation } from "./usePracticePreparation.js";
import { usePracticeLibrary } from "./usePracticeLibrary.js";

export function PracticePage(props: PracticePageProps) {
  const activity = useActivityController(props);
  const preparation = usePracticePreparation(props);
  const library = usePracticeLibrary(props);
  const { activityId, prepared } = activity;
  const { t, libraryView, setLibraryView } = library;
  const blocked = Boolean(
    activityId || preparation.formBusy || preparation.hasDraft || library.deleting,
  );
  const { onLanguageSwitchBlockedChange } = props;
  useEffect(() => {
    onLanguageSwitchBlockedChange?.(blocked);
    return () => onLanguageSwitchBlockedChange?.(false);
  }, [blocked, onLanguageSwitchBlockedChange]);
  return (
    <>
      <div hidden={Boolean(activityId)}>
        <Page
          title={t("practice.title")}
          width={libraryView ? "standard" : "form"}
          className={styles.creationPage}
        >
          <Tabs
            label={t("practice.title")}
            selectedKey={libraryView ? "saved" : "new"}
            onSelectionChange={(key) => {
              setLibraryView(key === "saved");
            }}
            items={[
              {
                id: "new",
                label: t("ui.newPractice"),
                children: <PracticePreparation model={preparation} />,
              },
              {
                id: "saved",
                label: t("practice.library.title"),
                children: <PracticeLibrary model={library} />,
              },
            ]}
          />
        </Page>
      </div>
      <ActivitySourceContext.Provider
        value={
          activityId && prepared?.activity.context.uploadSource ? (
            <UploadSourceEvidence
              reference={prepared.activity.context.uploadSource.upload}
              rootGeneration={prepared.rootGeneration}
              title={prepared.activity.context.uploadSource.material.title}
            />
          ) : null
        }
      >
        <PracticeActivity model={activity} />
      </ActivitySourceContext.Provider>
    </>
  );
}
