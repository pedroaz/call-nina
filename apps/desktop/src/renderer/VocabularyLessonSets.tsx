import { useEffect, useState } from "react";
import type { DataRootGeneration, DesktopIpcResponse, CallNinaError } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Button, Feedback, LoadingState } from "./components/ui/index.js";
import { invokeDesktop, normalizeDesktopError } from "./ipc.js";

type Result = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "vocabulary-set/list" }
>["result"];

export function VocabularyLessonSets({ rootGeneration }: { rootGeneration: DataRootGeneration }) {
  return <LessonSets key={rootGeneration} rootGeneration={rootGeneration} />;
}
function LessonSets({ rootGeneration }: { rootGeneration: DataRootGeneration }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<CallNinaError>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void invokeDesktop("vocabulary-set/list", { rootGeneration })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(normalizeDesktopError(cause).detail);
      });
    return () => {
      active = false;
    };
  }, [rootGeneration, retry]);
  if (!error && result?.entries.length === 0) return null;
  return (
    <>
      {error && (
        <>
          <Feedback tone="error" live="assertive">
            {t(error.messageKey)}
          </Feedback>
          <Button
            variant="secondary"
            onPress={() => {
              setResult(undefined);
              setError(undefined);
              setRetry((value) => value + 1);
            }}
          >
            {t("vocabulary.refresh")}
          </Button>
        </>
      )}
      {!result && !error && <LoadingState live>{t("ui.loading")}</LoadingState>}
      {result && (
        <section aria-label={t("vocabulary.lessonSets")}>
          <h2>{t("vocabulary.lessonSets")}</h2>
          <ul>
            {result.entries.map((set) => (
              <li key={set.setId}>
                <strong>{set.title}</strong> —{" "}
                {t("vocabulary.lessonSetItems", { count: set.candidateCount })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
