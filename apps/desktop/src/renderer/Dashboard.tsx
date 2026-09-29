import { recommendCourseActivity } from "@call-nina/domain";
import { useLearningPath } from "./useLearningPath.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageSchema, type DesktopIpcResponse, type CallNinaError } from "@call-nina/contracts";
import { useTranslation } from "react-i18next";
import { Button, Card, LoadingState } from "./components/ui/index.js";
import { ActionGroup, Page, ContentGrid, SectionHeader } from "./components/layout/index.js";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import { PracticeSuggestionCard } from "./PracticeSuggestionCard.js";
import { usePracticeSuggestion, type SuggestionActions } from "./usePracticeSuggestion.js";
import { OperationError } from "./Startup.js";
import styles from "./Dashboard.module.css";

type Snapshot = Extract<DesktopIpcResponse, { status: "ok"; channel: "dashboard/read" }>["result"];
type Destination = "writing" | "practice" | "vocabulary" | "learningPath" | "history";

export function Dashboard({
  onNavigate,
  ...actions
}: SuggestionActions & {
  onNavigate: (destination: Destination) => void;
}) {
  const { t, i18n } = useTranslation();
  const learning = useLearningPath();
  const next = learning.snapshot?.course
    ? (recommendCourseActivity(learning.snapshot.course, learning.snapshot.state)?.reference ??
      null)
    : null;
  const locale = languageSchema.safeParse(i18n.resolvedLanguage).data ?? "en-US";
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const request = useRef(0);
  const launch = usePracticeSuggestion(actions);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invokeDesktop("dashboard/read", { locale });
      if (current === request.current) setSnapshot(result);
    } catch (cause) {
      if (current === request.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      if (current === request.current) setBusy(false);
    }
  }, [locale]);
  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const onFocus = () => void refresh();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "state-invalidated" && ["dashboard", "settings"].includes(event.scope))
        void refresh();
    });
    window.addEventListener("focus", onFocus);
    return () => {
      request.current += 1;
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);
  const suggestions = snapshot?.suggestions ?? [];
  const visible = suggestions.length
    ? Array.from(
        { length: Math.min(3, suggestions.length) },
        (_, index) => suggestions[(offset + index) % suggestions.length],
      ).flatMap((suggestion) => (suggestion ? [suggestion] : []))
    : [];
  return (
    <Page title={t("dashboard.title")} refresh={{ onRefresh: refresh, busy: busy }}>
      {error && <OperationError error={error} />}
      {launch.error && <OperationError error={launch.error} />}
      {!snapshot && !error && <LoadingState live>{t("dashboard.refreshing")}</LoadingState>}
      {snapshot && (
        <>
          <Card as="section" className={styles.summary}>
            <h2>{t("learningPath.continue")}</h2>
            <p>
              {next
                ? `${learning.snapshot?.course?.units.find((u) => u.id === next.unitId)?.title[locale === "de" ? "de" : "en"] ?? ""} · ${learning.snapshot?.course?.units.find((u) => u.id === next.unitId)?.activities.find((a) => a.id === next.activityKey)?.title[locale === "de" ? "de" : "en"] ?? ""}`
                : t("learningPath.intro")}
            </p>
            <Button
              variant="primary"
              onPress={() => {
                onNavigate("learningPath");
              }}
            >
              {t("learningPath.continue")}
            </Button>
          </Card>
          <section aria-labelledby="practice-next-heading" aria-busy={busy}>
            <SectionHeader>
              <h2 id="practice-next-heading">{t("suggestions.title")}</h2>
              <Button
                isDisabled={Boolean(launch.starting) || suggestions.length <= 3}
                onPress={() => {
                  setOffset((value) => (value + 3) % suggestions.length);
                }}
              >
                {t("suggestions.more")}
              </Button>
            </SectionHeader>
            <div className={styles.suggestions}>
              {visible.map((suggestion) => (
                <PracticeSuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  progress={launch.starting === suggestion.id ? launch.progress : undefined}
                  recommended={false}
                  starting={launch.starting === suggestion.id}
                  onCancel={launch.generating ? launch.cancel : undefined}
                  disabled={Boolean(launch.starting)}
                  onStart={() => void launch.start(suggestion)}
                />
              ))}
            </div>
          </section>
          <ContentGrid>
            <Card as="section" className={styles.summary}>
              <h2>{t("suggestions.learningSummary")}</h2>
              <p>
                {t("suggestions.recentSummary", {
                  corrections: snapshot.recentCorrections.length,
                  patterns: snapshot.recurringMistakes.length,
                })}
              </p>
              <ActionGroup>
                <Button
                  onPress={() => {
                    onNavigate("history");
                  }}
                >
                  {t("dashboard.openHistory")}
                </Button>
                <Button
                  onPress={() => {
                    onNavigate("vocabulary");
                  }}
                >
                  {t("dashboard.openVocabulary")}
                </Button>
              </ActionGroup>
            </Card>
          </ContentGrid>
          <ActionGroup>
            <Button
              onPress={() => {
                onNavigate("practice");
              }}
            >
              {t("suggestions.choosePractice")}
            </Button>
            <Button
              onPress={() => {
                onNavigate("writing");
              }}
            >
              {t("suggestions.freeWriting")}
            </Button>
          </ActionGroup>
        </>
      )}
    </Page>
  );
}
