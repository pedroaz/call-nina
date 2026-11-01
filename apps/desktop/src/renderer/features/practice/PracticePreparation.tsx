import { BookOpen } from "lucide-react";
import { ActionGroup, Section } from "../../components/layout/index.js";
import { Button } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { CodexActivityPreparation } from "../../learning/activities/CodexActivityPreparation.js";
import { ReadingPractice } from "../../learning/activities/ReadingPractice.js";
import { OperationProgress } from "../../learning/operations/OperationProgress.js";
import { PracticeComposer } from "../../learning/practice/PracticeComposer.js";
import { validPracticeCount } from "../../learning/practice/PracticeCount.js";
import { PracticeSourceControl } from "../../learning/practice/PracticeSourceControl.js";
import { practiceStarterExamples } from "../../learning/practice/practiceStarterExamples.js";
import { type usePracticePreparation } from "./usePracticePreparation.js";
import { ProviderActionSummary } from "../../learning/providers/ProviderActionSummary.js";
import styles from "./PracticePage.module.css";

export function PracticePreparation({
  model,
}: {
  model: Pick<
    ReturnType<typeof usePracticePreparation>,
    | "onWriting"
    | "practiceSource"
    | "setPracticeSource"
    | "formBusy"
    | "selectedKind"
    | "customRequest"
    | "grammarRequest"
    | "flashcardTopic"
    | "readingTopic"
    | "listeningTopic"
    | "speakingTopic"
    | "setCustomRequest"
    | "setGrammarRequest"
    | "setFlashcardTopic"
    | "setReadingTopic"
    | "setListeningTopic"
    | "setSpeakingTopic"
    | "setSelectedKind"
    | "practiceSettings"
    | "generationError"
    | "generating"
    | "generation"
    | "cardCount"
    | "generateFlashcards"
    | "t"
    | "quizCountValid"
    | "generateCustomLesson"
    | "targetLanguage"
    | "exerciseCount"
    | "targetLevel"
    | "setReadingBusy"
    | "requestAiAccess"
    | "onOpenActivity"
    | "setVoiceBusy"
  >;
}) {
  const {
    onWriting,
    practiceSource,
    setPracticeSource,
    formBusy,
    selectedKind,
    customRequest,
    grammarRequest,
    flashcardTopic,
    readingTopic,
    listeningTopic,
    speakingTopic,
    setCustomRequest,
    setGrammarRequest,
    setFlashcardTopic,
    setReadingTopic,
    setListeningTopic,
    setSpeakingTopic,
    setSelectedKind,
    practiceSettings,
    generationError,
    generating,
    generation,
    cardCount,
    generateFlashcards,
    t,
    quizCountValid,
    generateCustomLesson,
    targetLanguage,
    exerciseCount,
    targetLevel,
    setReadingBusy,
    requestAiAccess,
    onOpenActivity,
    setVoiceBusy,
  } = model;
  return (
    <div className={styles.creationStudio}>
      <PracticeComposer
        onWriting={
          onWriting
            ? () => {
                onWriting(practiceSource);
              }
            : undefined
        }
        sourceControl={
          <PracticeSourceControl
            value={practiceSource}
            onChange={setPracticeSource}
            disabled={formBusy}
          />
        }
        kind={selectedKind}
        onKindChange={(kind) => {
          const topics = {
            custom: customRequest,
            grammar: grammarRequest,
            flashcards: flashcardTopic,
            reading: readingTopic,
            listening: listeningTopic,
            speaking: speakingTopic,
          };
          const setters = {
            custom: setCustomRequest,
            grammar: setGrammarRequest,
            flashcards: setFlashcardTopic,
            reading: setReadingTopic,
            listening: setListeningTopic,
            speaking: setSpeakingTopic,
          };
          if (!topics[kind]) setters[kind](topics[selectedKind]);
          setSelectedKind(kind);
        }}
        disabled={formBusy}
        topic={
          {
            custom: customRequest,
            grammar: grammarRequest,
            flashcards: flashcardTopic,
            reading: readingTopic,
            listening: listeningTopic,
            speaking: speakingTopic,
          }[selectedKind]
        }
        onTopicChange={
          {
            custom: setCustomRequest,
            grammar: setGrammarRequest,
            flashcards: setFlashcardTopic,
            reading: setReadingTopic,
            listening: setListeningTopic,
            speaking: setSpeakingTopic,
          }[selectedKind]
        }
      />
      {(selectedKind === "listening" || selectedKind === "speaking") && practiceSettings}

      {generationError && <OperationError error={generationError} />}
      <Section>
        <div hidden={selectedKind !== "flashcards"}>
          <Section as="article">
            {practiceSettings}
            <ProviderActionSummary operation="flashcard-generation" busy={generating} />
            <OperationProgress progress={generation.progress} />
            <ActionGroup>
              <Button
                variant="primary"
                isDisabled={formBusy || !validPracticeCount(cardCount)}
                onPress={() => void generateFlashcards()}
              >
                {t("flashcards.generate")}
              </Button>
              {generating && (
                <Button variant="secondary" onPress={generation.cancel}>
                  {t("actions.cancel")}
                </Button>
              )}
            </ActionGroup>
          </Section>
        </div>
        <div hidden={selectedKind !== "custom"}>
          <Section as="article">
            {practiceSettings}
            <ProviderActionSummary operation="exercise-generation" busy={generating} />
            <OperationProgress progress={generation.progress} />
            <ActionGroup>
              <Button
                variant="primary"
                isDisabled={generating || !quizCountValid}
                onPress={() => void generateCustomLesson(customRequest, "natural-request")}
              >
                {generating ? t("exercises.custom.generating") : t("exercises.custom.generate")}
              </Button>
              {generating && (
                <Button variant="secondary" onPress={generation.cancel}>
                  {t("actions.cancel")}
                </Button>
              )}
            </ActionGroup>
          </Section>
        </div>
        <div hidden={selectedKind !== "grammar"}>
          <Section as="article">
            {practiceSettings}
            <Button
              variant="secondary"
              isDisabled={generating || !targetLanguage}
              onPress={() => {
                if (targetLanguage)
                  setGrammarRequest(practiceStarterExamples[targetLanguage].grammar);
              }}
            >
              {t("practice.useExample")}
            </Button>
            <ProviderActionSummary operation="exercise-generation" busy={generating} />
            <OperationProgress progress={generation.progress} />
            <ActionGroup>
              <Button
                variant="primary"
                isDisabled={generating || !quizCountValid}
                onPress={() => void generateCustomLesson(grammarRequest, "grammar")}
              >
                <BookOpen aria-hidden="true" />
                {generating ? t("exercises.custom.generating") : t("practice.grammarLesson.start")}
              </Button>
              {generating && (
                <Button variant="secondary" onPress={generation.cancel}>
                  {t("actions.cancel")}
                </Button>
              )}
            </ActionGroup>
          </Section>
        </div>
        <div hidden={selectedKind !== "reading"}>
          <ReadingPractice
            hideTopic
            settings={practiceSettings}
            topic={readingTopic}
            setTopic={setReadingTopic}
            practiceSource={practiceSource}
            exerciseCount={exerciseCount}
            countValid={quizCountValid}
            targetLevel={targetLevel}
            onBusyChange={setReadingBusy}
            requestAiAccess={requestAiAccess}
            onOpenActivity={onOpenActivity}
          />
        </div>
        <div hidden={selectedKind !== "listening"}>
          <CodexActivityPreparation
            practiceSource={practiceSource}
            kind="listening"
            targetLevel={targetLevel}
            onBusyChange={setVoiceBusy}
            requestAiAccess={requestAiAccess}
            request={listeningTopic}
            onRequestChange={setListeningTopic}
            onOpenActivity={onOpenActivity}
          />
        </div>
        <div hidden={selectedKind !== "speaking"}>
          <CodexActivityPreparation
            practiceSource={practiceSource}
            kind="speaking"
            targetLevel={targetLevel}
            onBusyChange={setVoiceBusy}
            requestAiAccess={requestAiAccess}
            request={speakingTopic}
            onRequestChange={setSpeakingTopic}
            onOpenActivity={onOpenActivity}
          />
        </div>
      </Section>
    </div>
  );
}
