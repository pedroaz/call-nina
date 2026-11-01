import { type PracticeSource, type CallNinaError } from "@call-nina/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldGroup, SelectControl } from "../../components/ui/index.js";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import { useLearningOperation } from "../../learning/operations/useLearningOperation.js";
import { PracticeCount, validPracticeCount } from "../../learning/practice/PracticeCount.js";
import type { PracticeKind } from "../../learning/practice/PracticeTypeChooser.js";
import {
  practiceDefaults,
  startTopicPractice,
} from "../../learning/practice/startTopicPractice.js";
import type { PracticeLevel, PracticePageProps } from "./PracticePage.types.js";
import styles from "./PracticePage.module.css";

export function usePracticePreparation({
  initialPreparation,
  initialPracticeSource,
  targetLanguage,
  requestAiAccess,
  onOpenActivity,
  onWriting,
}: PracticePageProps) {
  const { t } = useTranslation();
  const [customRequest, setCustomRequest] = useState(
    initialPreparation?.kind === "custom" ? initialPreparation.prompt : "",
  );
  const [grammarRequest, setGrammarRequest] = useState(
    initialPreparation?.kind === "grammar" ? initialPreparation.prompt : "",
  );
  const [quizCount, setQuizCount] = useState(String(practiceDefaults.exerciseCount));
  const [cardCount, setCardCount] = useState(String(practiceDefaults.cardCount));
  const [flashcardTopic, setFlashcardTopic] = useState(
    initialPreparation?.kind === "flashcards" ? initialPreparation.prompt : "",
  );
  const [listeningTopic, setListeningTopic] = useState(
    initialPreparation?.kind === "listening" ? initialPreparation.prompt : "",
  );
  const [speakingTopic, setSpeakingTopic] = useState(
    initialPreparation?.kind === "speaking" ? initialPreparation.prompt : "",
  );
  const [readingTopic, setReadingTopic] = useState(
    initialPreparation?.kind === "reading" ? initialPreparation.prompt : "",
  );
  const [practiceSource, setPracticeSource] = useState<PracticeSource>(
    initialPracticeSource ?? { kind: "adaptive" },
  );
  const [previousPracticeSource, setPreviousPracticeSource] = useState(initialPracticeSource);
  if (previousPracticeSource !== initialPracticeSource) {
    setPreviousPracticeSource(initialPracticeSource);
    setPracticeSource(initialPracticeSource ?? { kind: "adaptive" });
  }
  const exerciseCount = Number(quizCount);
  const quizCountValid = validPracticeCount(quizCount);
  const [targetLevel, setTargetLevel] = useState<PracticeLevel>("a2");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [readingBusy, setReadingBusy] = useState(false);
  const levelEdited = useRef(false);
  useEffect(() => {
    let current = true;
    void invokeDesktop("learner-profile/read", {})
      .then((result) => {
        if (current && !levelEdited.current && result.status === "ready") {
          setTargetLevel(result.profile.approximateLevel);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  const generation = useLearningOperation();
  const generating = generation.busy;
  const formBusy = generating || voiceBusy || readingBusy;
  const [generationError, setGenerationError] = useState<CallNinaError>();
  const [selectedKind, setSelectedKind] = useState<PracticeKind>(
    initialPreparation?.kind ?? "custom",
  );
  const hasDraft = [
    customRequest,
    grammarRequest,
    flashcardTopic,
    listeningTopic,
    speakingTopic,
    readingTopic,
  ].some((text) => text.trim().length > 0);
  const generateCustomLesson = async (
    requestedLesson: string,
    source: "natural-request" | "grammar",
  ) => {
    if (!quizCountValid || !(await requestAiAccess("exercise-generation"))) return;
    setGenerationError(undefined);
    try {
      const createdId = await startTopicPractice(
        {
          kind: source === "grammar" ? "grammar" : "custom",
          topic: requestedLesson,
          practiceSource,
          count: exerciseCount,
          targetLevel,
        },
        generation.run,
      );
      onOpenActivity(createdId);
    } catch (cause) {
      setGenerationError(normalizeDesktopError(cause).detail);
    }
  };
  const quizLengthControl = (
    <PracticeCount
      value={selectedKind === "flashcards" ? cardCount : quizCount}
      onChange={selectedKind === "flashcards" ? setCardCount : setQuizCount}
      disabled={formBusy}
      flashcards={selectedKind === "flashcards"}
    />
  );
  const practiceSettings = (
    <div className={styles.practiceControls}>
      <FieldGroup>
        {t("practice.targetLevel")}
        <SelectControl
          value={targetLevel}
          disabled={formBusy}
          onChange={(event) => {
            levelEdited.current = true;
            setTargetLevel(event.target.value as PracticeLevel);
          }}
        >
          {(["a1", "a2", "b1", "b2"] as const).map((level) => (
            <option key={level} value={level}>
              {level.toUpperCase()}
            </option>
          ))}
        </SelectControl>
      </FieldGroup>
      {selectedKind !== "listening" && selectedKind !== "speaking" && quizLengthControl}
    </div>
  );
  const generateFlashcards = async () => {
    if (!validPracticeCount(cardCount) || !(await requestAiAccess("flashcard-generation"))) return;
    setGenerationError(undefined);
    try {
      const activityId = await startTopicPractice(
        {
          kind: "flashcards",
          topic: flashcardTopic,
          count: Number(cardCount),
          targetLevel,
          practiceSource,
        },
        generation.run,
      );
      onOpenActivity(activityId);
    } catch (cause) {
      setGenerationError(normalizeDesktopError(cause).detail);
    }
  };
  return {
    hasDraft,
    t,
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
    quizCountValid,
    generateCustomLesson,
    targetLanguage,
    exerciseCount,
    targetLevel,
    setReadingBusy,
    requestAiAccess,
    onOpenActivity,
    setVoiceBusy,
  };
}
