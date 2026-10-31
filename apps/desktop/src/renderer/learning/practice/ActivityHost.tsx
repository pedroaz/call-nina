import { useEffect } from "react";
import { ActivitySourceContext } from "../../components/activity/ActivityWorkspace.js";
import { UploadSourceEvidence } from "../uploads/UploadSourceEvidence.js";
import { PracticeActivity } from "./PracticeActivity.js";
import { type ActivityHostProps } from "./activity-types.js";
import { useActivityController } from "./useActivityController.js";

export function ActivityHost(props: ActivityHostProps) {
  const model = useActivityController(props);
  const { activityId, prepared } = model;
  const { onLanguageSwitchBlockedChange } = props;
  useEffect(() => {
    onLanguageSwitchBlockedChange?.(Boolean(activityId));
    return () => onLanguageSwitchBlockedChange?.(false);
  }, [activityId, onLanguageSwitchBlockedChange]);
  return (
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
      <PracticeActivity model={model} />
    </ActivitySourceContext.Provider>
  );
}
