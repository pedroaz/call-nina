import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { Button } from "./components/ui/index.js";
import type { OperationProgressState } from "./useOperationProgress.js";
import styles from "./OperationProgress.module.css";

export function OperationProgress({
  progress,
  onCancel,
}: {
  progress: OperationProgressState | undefined;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => performance.now());
  const startedAt = progress?.startedAt;
  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = window.setInterval(() => {
      setNow(performance.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [startedAt]);
  if (!progress) return null;
  const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  const generating = progress.stage === "running";
  const stage =
    progress.stage === "cancelling"
      ? "cancelling"
      : progress.stage === "validating"
        ? "checking"
        : progress.stage === "persisting"
          ? "saving"
          : progress.attempt === 2
            ? progress.kind === "exercise-generation"
              ? "refiningExercises"
              : "refining"
            : generating
              ? progress.kind
              : "preparing";
  return (
    <div className={styles["progress"]}>
      <LoaderCircle className={styles["indicator"]} aria-hidden="true" />
      <div className={styles["copy"]}>
        <div role="status" aria-live="polite" aria-atomic="true">
          <strong>{t(`aiProgress.stages.${stage}`)}</strong>
          <span className={styles["attempt"]}>
            {" "}
            · {t("aiProgress.attempt", { count: progress.attempt })}
          </span>
        </div>
        <div className={styles["detail"]} aria-live="off">
          <span>
            {t("aiProgress.elapsed", {
              time: `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`,
            })}
          </span>
          {generating && (
            <span>{t(`aiProgress.messages.${String(Math.floor(seconds / 8) % 3)}`)}</span>
          )}
        </div>
      </div>
      {onCancel && (
        <Button variant="secondary" isDisabled={progress.stage === "cancelling"} onPress={onCancel}>
          {t("actions.cancel")}
        </Button>
      )}
    </div>
  );
}
