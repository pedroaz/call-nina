import { type SpeechAction, type SpeechSnapshot } from "@call-nina/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/index.js";
import { invokeDesktop } from "../../runtime/ipc.js";

export function CourseAudio({ courseId }: { courseId: string }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<SpeechSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void invokeDesktop("speech/read", {})
        .then((result) => {
          if (live) setView(result);
        })
        .catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [courseId]);
  const course = view?.courses.find((c) => c.id === courseId);
  if (!course) return null;
  const act = async (action: SpeechAction) => {
    setError(false);
    try {
      setView(await invokeDesktop("speech/manage", action));
    } catch {
      setError(true);
    }
  };
  return (
    <div>
      <Button
        variant="quiet"
        onPress={() =>
          void act(
            view?.downloadingCourse === courseId
              ? { action: "cancel-course" }
              : { action: course.pinned ? "remove-course" : "download-course", courseId },
          )
        }
      >
        {t(
          view?.downloadingCourse === courseId
            ? "actions.cancel"
            : course.pinned
              ? "speech.removeCourse"
              : "speech.downloadCourse",
        )}{" "}
        ·{" "}
        {(course.bytes / 1e6).toLocaleString(i18n.language, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}{" "}
        MB
      </Button>
      {course.hasDownload && !course.pinned && (
        <Button variant="quiet" onPress={() => void act({ action: "remove-course", courseId })}>
          {t("speech.removeCourse")}
        </Button>
      )}
      {course.hasDownload && (
        <span>
          {t("speech.installedSize", {
            size: (course.diskBytes / 1e6).toLocaleString(i18n.language, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }),
          })}
        </span>
      )}
      {view?.downloadingCourse === courseId && (
        <progress
          aria-label={t("speech.downloadCourse")}
          value={course.downloadedBytes}
          max={course.bytes}
        />
      )}{" "}
      {(error || view?.error) && <p role="status">{t("speech.unavailable")}</p>}
    </div>
  );
}
