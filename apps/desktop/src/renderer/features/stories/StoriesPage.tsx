import type { StorySnapshot } from "@call-nina/contracts";
import { BookOpen, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContentRow, FilterBar, Page } from "../../components/layout/index.js";
import {
  Button,
  EmptyState,
  Feedback,
  SelectField,
  TextField,
  useNotifications,
} from "../../components/ui/index.js";
import { stopSpeech } from "../../learning/speech/SpeechButton.js";
import { invokeDesktop } from "../../runtime/ipc.js";
import { StoryReader } from "./StoryReader.js";
import styles from "./StoriesPage.module.css";

export function StoriesPage() {
  const { t, i18n } = useTranslation();
  const { notify } = useNotifications();
  const [snapshot, setSnapshot] = useState<StorySnapshot>();
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [paragraph, setParagraph] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const current = useRef(0);
  useEffect(() => {
    let active = true;
    const ticket = current.current;
    void invokeDesktop("stories/read", {}).then(
      (value) => {
        if (active) setSnapshot(value);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
      current.current = ticket + 1;
      stopSpeech();
    };
  }, []);
  const locale = (i18n.resolvedLanguage === "en-US" ? "en" : (i18n.resolvedLanguage ?? "en")) as
    "en" | "de" | "es" | "pt-BR";
  const story = snapshot?.stories.find((item) => item.id === selected);
  const move = async (next: number) => {
    if (!snapshot || !story || busy) return;
    stopSpeech();
    setBusy(true);
    setError(false);
    const ticket = current.current;
    try {
      await invokeDesktop("stories/position", {
        expectedGeneration: snapshot.rootGeneration,
        language: story.language,
        storyId: story.id,
        paragraph: next,
      });
      if (ticket !== current.current) return;
      setParagraph(next);
      setSnapshot({ ...snapshot, positions: { ...snapshot.positions, [story.id]: next } });
    } catch {
      if (ticket === current.current) setError(true);
    } finally {
      if (ticket === current.current) setBusy(false);
    }
  };
  const saveWord = async (index: number) => {
    if (!snapshot || !story || busy) return;
    setBusy(true);
    setError(false);
    try {
      await invokeDesktop("stories/vocabulary", {
        expectedGeneration: snapshot.rootGeneration,
        language: story.language,
        storyId: story.id,
        word: index,
      });
      setSaved((values) => [...values, `${story.id}:${String(index)}`]);
      notify({ message: "flashcards.saveNotice", tone: "success" });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      title={story ? story.title[locale] : t("nav.stories")}
      width={story ? "reading" : "standard"}
      {...(story
        ? {
            breadcrumbs: [
              {
                label: t("nav.stories"),
                onPress: () => {
                  if (busy) return;
                  stopSpeech();
                  setSelected(undefined);
                },
              },
            ],
          }
        : {})}
    >
      {error && (
        <Feedback tone="error" live="assertive">
          {t("stories.failed")}
        </Feedback>
      )}
      {!snapshot && !error && <p role="status">{t("stories.loading")}</p>}
      {story ? (
        <StoryReader
          key={story.id}
          story={story}
          title={story.title[locale]}
          explanationLanguage={snapshot?.learningContext.explanationLanguage ?? "en-US"}
          paragraph={paragraph}
          busy={busy}
          saved={saved}
          error={error}
          onMove={(next) => void move(next)}
          onSave={(index) => void saveWord(index)}
        />
      ) : (
        snapshot && (
          <>
            <FilterBar columns={2} label={t("stories.search")}>
              <TextField
                label={t("stories.search")}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
              <SelectField
                label={t("stories.level")}
                value={level}
                onChange={(event) => {
                  setLevel(event.target.value);
                }}
              >
                <option value="all">{t("stories.allLevels")}</option>
                {["A1", "A2", "B1", "B2"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </SelectField>
            </FilterBar>
            <div>
              {snapshot.stories
                .filter(
                  (item) =>
                    (level === "all" || item.level === level) &&
                    `${item.title[locale]} ${item.summary[locale]}`
                      .toLocaleLowerCase()
                      .includes(query.trim().toLocaleLowerCase()),
                )
                .map((item) => (
                  <ContentRow key={item.id} className={styles.storyRow}>
                    <Button
                      variant="quiet"
                      className={styles.storyOpen}
                      aria-label={`${t("stories.read")}: ${item.title[locale]} · ${item.level}`}
                      onPress={() => {
                        setSelected(item.id);
                        setParagraph(
                          Math.min(snapshot.positions[item.id] ?? 0, item.paragraphs.length - 1),
                        );
                      }}
                    >
                      <span className={styles.storyIcon}>
                        <BookOpen aria-hidden="true" />
                      </span>
                      <span className={styles.storyCopy}>
                        <span className={styles.storyTitle}>
                          <strong>{item.title[locale]}</strong>
                          <span className={styles.storyLevel}>{item.level}</span>
                        </span>
                        <span className={styles.storySummary}>{item.summary[locale]}</span>
                      </span>
                      <ChevronRight className={styles.storyChevron} aria-hidden="true" />
                    </Button>
                  </ContentRow>
                ))}
            </div>
            {!snapshot.stories.some(
              (item) =>
                (level === "all" || item.level === level) &&
                `${item.title[locale]} ${item.summary[locale]}`
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
            ) && <EmptyState variant="plain" icon={<BookOpen />} title={t("stories.empty")} />}
          </>
        )
      )}
    </Page>
  );
}
