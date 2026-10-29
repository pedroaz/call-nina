import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import type { StorySnapshot } from "@call-nina/contracts";
import { Page, ContentRow, Section, ActionGroup } from "./components/layout/index.js";
import { Button, TextField, SelectField } from "./components/ui/index.js";
import { invokeDesktop } from "./ipc.js";
import { SpeechButton, stopSpeech } from "./SpeechButton.js";
import styles from "./StoriesPage.module.css";

export function StoriesPage() {
  const { t, i18n } = useTranslation();
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
      {error && <p role="alert">{t("stories.failed")}</p>}
      {!snapshot && !error && <p role="status">{t("stories.loading")}</p>}
      {story ? (
        <>
          <div className={styles.reading} lang={story.language}>
            <p className={styles.passage}>{story.paragraphs[paragraph]}</p>
            <SpeechButton text={story.paragraphs[paragraph] ?? ""} language={story.language} />
          </div>
          <ActionGroup>
            <Button
              variant="secondary"
              isDisabled={busy || paragraph === 0}
              onPress={() => void move(paragraph - 1)}
            >
              {t("stories.previous")}
            </Button>
            <span>
              {t("stories.position", { current: paragraph + 1, total: story.paragraphs.length })}
            </span>
            <Button
              variant="secondary"
              isDisabled={busy || paragraph === story.paragraphs.length - 1}
              onPress={() => void move(paragraph + 1)}
            >
              {t("stories.next")}
            </Button>
          </ActionGroup>
          <Section title={t("nav.vocabulary")}>
            {story.vocabulary.map((word, index) => (
              <ContentRow
                key={word.text}
                actions={
                  <Button
                    variant="quiet"
                    isDisabled={busy || saved.includes(`${story.id}:${String(index)}`)}
                    onPress={() => void saveWord(index)}
                  >
                    {t(
                      saved.includes(`${story.id}:${String(index)}`)
                        ? "stories.saved"
                        : "stories.saveWord",
                    )}
                  </Button>
                }
              >
                <strong lang={story.language}>{word.text}</strong>
                <p>
                  {
                    word.meaning[
                      snapshot?.learningContext.explanationLanguage === "en-US"
                        ? "en"
                        : (snapshot?.learningContext.explanationLanguage ?? "en")
                    ]
                  }
                </p>
              </ContentRow>
            ))}
          </Section>
        </>
      ) : (
        snapshot && (
          <>
            <div className={styles.filters}>
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
            </div>
            {snapshot.stories
              .filter(
                (item) =>
                  (level === "all" || item.level === level) &&
                  `${item.title[locale]} ${item.summary[locale]}`
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()),
              )
              .map((item) => (
                <ContentRow
                  key={item.id}
                  leading={<BookOpen aria-hidden="true" />}
                  metadata={item.level}
                  actions={
                    <Button
                      variant="secondary"
                      onPress={() => {
                        setSelected(item.id);
                        setParagraph(
                          Math.min(snapshot.positions[item.id] ?? 0, item.paragraphs.length - 1),
                        );
                      }}
                    >
                      {t("stories.read")}
                    </Button>
                  }
                >
                  <h2>{item.title[locale]}</h2>
                  <p>{item.summary[locale]}</p>
                </ContentRow>
              ))}
            {!snapshot.stories.some(
              (item) =>
                (level === "all" || item.level === level) &&
                `${item.title[locale]} ${item.summary[locale]}`
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
            ) && <p>{t("stories.empty")}</p>}
          </>
        )
      )}
    </Page>
  );
}
