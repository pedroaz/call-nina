import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  CourseReference,
  DataRootGeneration,
  Language,
  CallNinaError,
} from "@call-nina/contracts";
import { courseActivityStatus, resolveCourseReference } from "@call-nina/domain";
import { ActivityWorkspace, ActivityFrame, ActivityFooter } from "./components/activity/index.js";
import { Button, LoadingState } from "./components/ui/index.js";
import { OperationError } from "./OperationError.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";
import { LessonListening } from "./LessonListening.js";
import type { LearningPathSnapshot } from "./useLearningPath.js";

// Old saved course-listening IDs still resolve here, without reopening a Voice session.
export function PreparedCourseListening({
  reference,
  generation,
  language,
  title,
  breadcrumbs,
  onClose,
}: {
  reference: CourseReference;
  generation: DataRootGeneration;
  language: Language;
  title: string;
  breadcrumbs: ReadonlyArray<{ label: string; onPress: () => void }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<LearningPathSnapshot>();
  const [error, setError] = useState<CallNinaError>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void invokeDesktop("learning-path/read", {})
      .then((value) => {
        if (!live) return;
        if (
          value.rootGeneration !== generation ||
          value.learningContext.targetLanguage !== language
        )
          throw new Error("OD_DATA_ROOT_STALE");
        const { activity } = resolveCourseReference(value.course, reference);
        if (activity.delivery !== "listening") throw new Error("OD_COURSE_REFERENCE_INVALID");
        setSnapshot(value);
      })
      .catch((cause: unknown) => {
        if (live) setError(normalizeDesktopError(cause).detail);
      });
    return () => {
      live = false;
    };
  }, [reference, generation, language]);
  const status = snapshot ? courseActivityStatus(snapshot.state, reference) : "not-started";
  const finished = reference.mode === "review" || status === "completed" || status === "skipped";
  const update = async (action: "complete-listening" | "skip" | "reopen") => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const value = await invokeDesktop("learning-path/update", {
        expectedGeneration: generation,
        reference,
        action,
      });
      setSnapshot(value);
      if (action === "complete-listening") onClose();
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  let content: ReactNode;
  if (snapshot) {
    const { activity } = resolveCourseReference(snapshot.course, reference);
    const locale =
      snapshot.learningContext.explanationLanguage === "en-US"
        ? "en"
        : snapshot.learningContext.explanationLanguage;
    content = <LessonListening activity={activity} language={language} locale={locale} />;
  }
  return (
    <ActivityWorkspace title={title} breadcrumbs={breadcrumbs}>
      <ActivityFrame
        fillViewport={false}
        taskLabel={t("activity.task")}
        footer={
          snapshot && (
            <ActivityFooter
              utilities={
                reference.mode === "course" && (
                  <Button
                    variant="quiet"
                    isDisabled={busy}
                    onPress={() => void update(finished ? "reopen" : "skip")}
                  >
                    {t(finished ? "learningPath.reopen" : "learningPath.skip")}
                  </Button>
                )
              }
            >
              <Button
                variant="primary"
                isPending={busy}
                onPress={() => (finished ? onClose() : void update("complete-listening"))}
              >
                {t(finished ? "actions.continue" : "speech.finishListening")}
              </Button>
            </ActivityFooter>
          )
        }
      >
        {error && <OperationError error={error} />}
        {!snapshot && !error && <LoadingState live>{t("ui.loading")}</LoadingState>}
        {content}
      </ActivityFrame>
    </ActivityWorkspace>
  );
}
