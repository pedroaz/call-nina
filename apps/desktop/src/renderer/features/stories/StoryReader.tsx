import type { Language, Story } from "@call-nina/contracts";
import { ArrowLeft, ArrowRight, BookmarkPlus, Check, Library } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityFooter,
  ActivityFrame,
  ActivityProgress,
} from "../../components/activity/index.js";
import { ActionGroup, ContentRow } from "../../components/layout/index.js";
import { Button, Feedback, ModalDialog, Tabs } from "../../components/ui/index.js";
import { SpeechButton, stopSpeech } from "../../learning/speech/SpeechButton.js";
import styles from "./StoriesPage.module.css";

export function StoryReader({
  story,
  title,
  explanationLanguage,
  paragraph,
  busy,
  saved,
  error,
  onMove,
  onSave,
}: {
  story: Story;
  title: string;
  explanationLanguage: Language;
  paragraph: number;
  busy: boolean;
  saved: string[];
  error: boolean;
  onMove: (paragraph: number) => void;
  onSave: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("read");
  const [wordIndex, setWordIndex] = useState<number>();
  const passage = useRef<HTMLParagraphElement>(null);
  const previousParagraph = useRef(paragraph);
  useEffect(() => {
    if (previousParagraph.current !== paragraph) passage.current?.focus({ preventScroll: true });
    previousParagraph.current = paragraph;
  }, [paragraph]);
  const locale = explanationLanguage === "en-US" ? "en" : explanationLanguage;
  const word = wordIndex === undefined ? undefined : story.vocabulary[wordIndex];
  const wordTitle = (entry: Story["vocabulary"][number]) =>
    `${entry.lexeme?.partOfSpeech === "noun" && entry.lexeme.nounForm.article ? `${entry.lexeme.nounForm.article} ` : ""}${entry.text}`;
  const saveAction = (index: number) => {
    const isSaved = saved.includes(`${story.id}:${String(index)}`);
    return (
      <Button
        variant="secondary"
        density="compact"
        leadingIcon={isSaved ? <Check aria-hidden="true" /> : <BookmarkPlus aria-hidden="true" />}
        aria-label={`${t(isSaved ? "stories.saved" : "stories.saveWord")}: ${story.vocabulary[index]?.text ?? ""}`}
        isDisabled={busy || isSaved}
        onPress={() => {
          onSave(index);
        }}
      >
        {t(isSaved ? "stories.saved" : "stories.saveWord")}
      </Button>
    );
  };
  return (
    <>
      <Tabs
        label={title}
        selectedKey={tab}
        onSelectionChange={(next) => {
          stopSpeech();
          setTab(next);
        }}
        items={[
          {
            id: "read",
            label: t("stories.read"),
            children: (
              <ActivityFrame
                fillViewport={false}
                taskLabel={title}
                progress={
                  <ActivityProgress
                    current={paragraph + 1}
                    total={story.paragraphs.length}
                    label={t("stories.position", {
                      current: paragraph + 1,
                      total: story.paragraphs.length,
                    })}
                    actions={<span className={styles.storyLevel}>{story.level}</span>}
                  />
                }
                footer={
                  <ActivityFooter
                    previous={
                      <Button
                        variant="secondary"
                        isDisabled={busy || paragraph === 0}
                        leadingIcon={<ArrowLeft aria-hidden="true" />}
                        onPress={() => {
                          onMove(paragraph - 1);
                        }}
                      >
                        {t("stories.previous")}
                      </Button>
                    }
                  >
                    <Button
                      variant="primary"
                      isDisabled={busy || paragraph === story.paragraphs.length - 1}
                      trailingIcon={<ArrowRight aria-hidden="true" />}
                      onPress={() => {
                        onMove(paragraph + 1);
                      }}
                    >
                      {t("stories.next")}
                    </Button>
                  </ActivityFooter>
                }
              >
                <p
                  ref={passage}
                  tabIndex={-1}
                  data-focus-anchor
                  className={styles.passage}
                  lang={story.language}
                >
                  {story.paragraphs[paragraph]}
                </p>
                <SpeechButton
                  text={story.paragraphs[paragraph] ?? ""}
                  language={story.language}
                  variant="passage"
                  enabled={tab === "read"}
                />
              </ActivityFrame>
            ),
          },
          {
            id: "vocabulary",
            label: t("stories.vocabularyCount", { count: story.vocabulary.length }),
            icon: <Library aria-hidden="true" />,
            children: (
              <div>
                {story.vocabulary.map((entry, index) => (
                  <ContentRow
                    key={entry.text}
                    density="compact"
                    actions={
                      <ActionGroup>
                        <SpeechButton
                          text={entry.text}
                          language={story.language}
                          enabled={tab === "vocabulary"}
                        />
                        {saveAction(index)}
                      </ActionGroup>
                    }
                  >
                    <Button
                      variant="quiet"
                      className={styles.wordOpen}
                      aria-label={`${t("vocabulary.library.details")}: ${wordTitle(entry)}`}
                      onPress={() => {
                        stopSpeech();
                        setWordIndex(index);
                      }}
                    >
                      <span className={styles.wordCopy}>
                        <strong className={styles.wordText} lang={story.language}>
                          {wordTitle(entry)}
                        </strong>
                        <span className={styles.wordMeaning} lang={explanationLanguage}>
                          {entry.meaning[locale]}
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </ContentRow>
                ))}
              </div>
            ),
          },
        ]}
      />
      <ModalDialog
        isOpen={word !== undefined}
        size="reading"
        title={t("vocabulary.library.details")}
        closeLabel={t("actions.close")}
        onOpenChange={(open) => {
          if (!open) {
            stopSpeech();
            setWordIndex(undefined);
          }
        }}
      >
        {word && wordIndex !== undefined && (
          <div className={styles.wordDetails}>
            {error && (
              <Feedback tone="error" live="assertive">
                {t("stories.failed")}
              </Feedback>
            )}
            <div className={styles.wordDefinition}>
              <ActionGroup>
                <h2 lang={story.language}>{wordTitle(word)}</h2>
                <SpeechButton text={word.text} language={story.language} />
              </ActionGroup>
              <p className={styles.definitionMeaning} lang={explanationLanguage}>
                {word.meaning[locale]}
              </p>
              {word.lexeme?.partOfSpeech === "noun" && word.lexeme.plural.status === "form" && (
                <p className={styles.wordMeaning} lang={story.language}>
                  {t("stories.plural")}: {word.lexeme.plural.form}
                </p>
              )}
              {word.usage && <p lang={explanationLanguage}>{word.usage[locale]}</p>}
            </div>
            <div className={styles.wordExample}>
              <p className={styles.passage} lang={story.language}>
                {word.example}
              </p>
              <p className={styles.wordMeaning} lang={explanationLanguage}>
                {word.exampleMeaning[locale]}
              </p>
              <SpeechButton text={word.example} language={story.language} variant="passage" />
            </div>
            <ActionGroup align="end">{saveAction(wordIndex)}</ActionGroup>
          </div>
        )}
      </ModalDialog>
    </>
  );
}
