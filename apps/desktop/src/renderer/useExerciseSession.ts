import { normalizeDesktopError } from "./ipc.js";
import type {
  Language,
  DesktopIpcResponse,
  GenerationCandidateOutputMap,
} from "@call-nina/contracts";
import {
  evaluateExerciseAnswer,
  type ExerciseAnswer,
  type ExerciseDefinition,
  type ExerciseEvaluation,
} from "@call-nina/domain";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
export type ExerciseAiFeedback = GenerationCandidateOutputMap["exercise-feedback"];
function answerFor(definition: ExerciseDefinition, values: readonly string[]): ExerciseAnswer {
  if (definition.kind === "free-writing") return { kind: definition.kind, text: values[0] ?? "" };
  if (definition.kind === "short-answer") return { kind: definition.kind, text: values[0] ?? "" };
  if (definition.kind === "fill-in-the-blank") {
    return { kind: definition.kind, valuesByBlankPosition: [...values] };
  }
  if (definition.kind === "sentence-correction") {
    return { kind: definition.kind, text: values[0] ?? "" };
  }
  if (definition.kind === "multiple-choice") {
    return { kind: definition.kind, selectedOptionPosition: Number(values[0] ?? "-1") };
  }
  return { kind: definition.kind, text: values[0] ?? "" };
}

function incompleteSentenceFrame(answer: string, targetLanguage: Language): string {
  const answerWords = answer.match(/[\p{L}\p{N}]+/gu) ?? [];
  const fallbackMaskPosition = Math.max(0, answerWords.length - 1);
  let wordPosition = 0;
  return answer.replaceAll(/[\p{L}\p{N}]+/gu, (word) => {
    const currentPosition = wordPosition;
    wordPosition += 1;
    const mask = word.length > 3 || currentPosition === fallbackMaskPosition;
    if (!mask) return word;
    const characters = Array.from(
      new Intl.Segmenter(targetLanguage, { granularity: "grapheme" }).segment(word),
      (part) => part.segment,
    );
    const [first = ""] = characters;
    return `${first}${"_".repeat(Math.min(8, Math.max(1, characters.length - 1)))}`;
  });
}

type ExerciseProgress = NonNullable<
  Extract<
    DesktopIpcResponse,
    { status: "ok"; channel: "prepared-activity/read" }
  >["result"]["activeSet"]
>["progress"];

function resumeExerciseProgress(
  exercises: readonly ExerciseDefinition[],
  progress: ExerciseProgress | undefined,
  targetLanguage: Language,
) {
  const values: Record<number, readonly string[]> = {};
  const feedback: Record<number, ExerciseAiFeedback> = {};
  const hints: Record<number, number> = {};
  const submitted: Record<number, boolean> = {};
  const evaluations: ExerciseEvaluation[] = [];
  for (const [position, item] of (progress ?? []).entries()) {
    hints[position] = item.hintsUsed;
    const answer = item.answer;
    const exercise = exercises[position];
    if (!answer || !exercise) continue;
    submitted[position] = true;
    values[position] =
      answer.kind === "fill-in-the-blank"
        ? answer.valuesByBlankPosition
        : answer.kind === "multiple-choice"
          ? [String(answer.selectedOptionPosition)]
          : [answer.text];
    const evaluation = evaluateExerciseAnswer(exercise, answer, targetLanguage);
    if (item.feedback) feedback[position] = item.feedback;
    if (position === evaluations.length && (evaluation.status !== "requires-ai" || item.feedback))
      evaluations.push(evaluation);
  }
  return {
    values,
    feedback,
    hints,
    submitted,
    evaluations,
    position: Math.min(evaluations.length, Math.max(0, exercises.length - 1)),
  };
}

export type ExerciseSessionOptions = {
  autoStart?: boolean;
  targetLanguage: Language;
  exercises: readonly ExerciseDefinition[];
  progress?: ExerciseProgress;
  onNewAttempt?: () => Promise<void>;
  onAnswerSubmitted?: (
    answer: ExerciseAnswer,
    position: number,
  ) => Promise<ExerciseAiFeedback | null>;
  onStarted?: () => void | Promise<void>;
  onCompleted?: (evaluations: readonly ExerciseEvaluation[]) => void | Promise<void>;
  onAbandoned?: () => void | Promise<void>;
  onCancelAiEvaluation?: () => void;
  onSupportUsed?: (position: number) => Promise<void>;
  onAiEvaluationRequested?: (
    evaluation: ExerciseEvaluation,
    exercisePosition: number,
  ) => Promise<ExerciseAiFeedback>;
};

export function useExerciseSession({
  autoStart = false,
  targetLanguage,
  exercises,
  progress,
  onNewAttempt,
  onAnswerSubmitted,
  onStarted,
  onCompleted,
  onAbandoned,
  onAiEvaluationRequested,
  onSupportUsed,
}: ExerciseSessionOptions) {
  const { t } = useTranslation();
  const [initial] = useState(() => resumeExerciseProgress(exercises, progress, targetLanguage));
  const [resuming, setResuming] = useState(Boolean(progress));
  const [started, setStarted] = useState(false);
  const [position, setPosition] = useState(initial.position);
  const [furthestPosition, setFurthestPosition] = useState(initial.position);
  const [values, setValues] = useState<readonly string[]>(initial.values[initial.position] ?? []);
  const [valuesByPosition, setValuesByPosition] = useState<
    Readonly<Record<number, readonly string[]>>
  >(initial.values);
  const [savingSupport, setSavingSupport] = useState(false);
  const [supportFailed, setSupportFailed] = useState(false);
  const [hintCount, setHintCount] = useState(initial.hints[initial.position] ?? 0);
  const [hintOpen, setHintOpen] = useState(false);
  const [hintCountByPosition, setHintCountByPosition] = useState<Readonly<Record<number, number>>>(
    initial.hints,
  );
  const [evaluations, setEvaluations] = useState<readonly ExerciseEvaluation[]>(
    initial.evaluations,
  );
  const [currentEvaluation, setCurrentEvaluation] = useState<ExerciseEvaluation | undefined>(
    initial.evaluations[initial.position],
  );
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionFailed, setCompletionFailed] = useState(false);
  const [answerInvalid, setAnswerInvalid] = useState(false);
  const [evaluatingWithAi, setEvaluatingWithAi] = useState(false);
  const [aiEvaluationFailed, setAiEvaluationFailed] = useState<
    false | "failed" | "context-missing"
  >(false);
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [submittedByPosition, setSubmittedByPosition] = useState<Readonly<Record<number, boolean>>>(
    initial.submitted,
  );
  const [answerSaveFailed, setAnswerSaveFailed] = useState(false);
  const [currentAiFeedback, setCurrentAiFeedback] = useState<ExerciseAiFeedback | undefined>(
    initial.feedback[initial.position],
  );
  const [aiFeedbackByPosition, setAiFeedbackByPosition] = useState<
    Readonly<Record<number, ExerciseAiFeedback>>
  >(initial.feedback);
  const [abandoning, setAbandoning] = useState(false);
  const [abandonFailed, setAbandonFailed] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const autoStartAttempted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartAttempted.current || !exercises.length) return;
    autoStartAttempted.current = true;
    setStarting(true);
    void Promise.resolve()
      .then(() => onStarted?.())
      .then(() => setStarted(true))
      .catch(() => setStartFailed(true))
      .finally(() => setStarting(false));
  }, [autoStart, exercises.length, onStarted]);
  const definition = exercises[position];

  const displayedHints =
    definition?.kind === "short-answer"
      ? [
          ...definition.hints,
          {
            text: t("exercises.answerFrameHint", {
              frame: incompleteSentenceFrame(
                definition.answerContract.acceptedAnswers[0] ?? "",
                targetLanguage,
              ),
            }),
          },
        ]
      : (definition?.hints ?? []);
  const revealHint = async () => {
    if (
      savingSupport ||
      evaluatingWithAi ||
      currentEvaluation ||
      hintCount >= displayedHints.length
    )
      return;
    setSavingSupport(true);
    setSupportFailed(false);
    try {
      await onSupportUsed?.(position);
      const next = hintCount + 1;
      setHintCount(next);
      setHintCountByPosition((byPosition) => ({ ...byPosition, [position]: next }));
    } catch {
      setSupportFailed(true);
    } finally {
      setSavingSupport(false);
    }
  };
  const setValue = (answerPosition: number, value: string) => {
    const next = [...values];
    next[answerPosition] = value;
    setValues(next);
    setValuesByPosition((byPosition) => ({ ...byPosition, [position]: next }));
  };
  const navigateTo = (nextPosition: number) => {
    if (nextPosition < 0 || nextPosition > furthestPosition) return;
    setHintOpen(false);
    setSupportFailed(false);
    setPosition(nextPosition);
    setValues(valuesByPosition[nextPosition] ?? []);
    setHintCount(hintCountByPosition[nextPosition] ?? 0);
    setCurrentEvaluation(evaluations[nextPosition]);
    setCurrentAiFeedback(aiFeedbackByPosition[nextPosition]);
    setAnswerInvalid(false);
    setAnswerSaveFailed(false);
    setAiEvaluationFailed(false);
  };
  const advance = async (nextEvaluations: readonly ExerciseEvaluation[]) => {
    const nextPosition = position + 1;
    if (nextPosition === exercises.length) {
      setCompleting(true);
      setCompletionFailed(false);
      try {
        await onCompleted?.(nextEvaluations);
      } catch {
        setCompletionFailed(true);
        return;
      } finally {
        setCompleting(false);
      }
    }
    setHintOpen(false);
    setSupportFailed(false);
    setPosition(nextPosition);
    setFurthestPosition((current) => Math.max(current, nextPosition));
    setValues(valuesByPosition[nextPosition] ?? []);
    setHintCount(hintCountByPosition[nextPosition] ?? 0);
    setCurrentEvaluation(nextEvaluations[nextPosition]);
    setCurrentAiFeedback(aiFeedbackByPosition[nextPosition]);
  };
  const submit = async () => {
    if (!definition) return;
    let evaluation: ExerciseEvaluation;
    try {
      evaluation = evaluateExerciseAnswer(
        definition,
        answerFor(definition, values),
        targetLanguage,
      );
      setAnswerInvalid(false);
    } catch {
      setAnswerInvalid(true);
      return;
    }
    setSavingAnswer(true);
    setAnswerSaveFailed(false);
    let retainedFeedback: ExerciseAiFeedback | null | undefined;
    try {
      retainedFeedback = await onAnswerSubmitted?.(evaluation.answer, position);
      setSubmittedByPosition((current) => ({ ...current, [position]: true }));
    } catch {
      setAnswerSaveFailed(true);
      return;
    } finally {
      setSavingAnswer(false);
    }
    if (evaluation.status === "requires-ai") {
      if (!retainedFeedback && !onAiEvaluationRequested) {
        setAiEvaluationFailed("failed");
        return;
      }
      setEvaluatingWithAi(true);
      setAiEvaluationFailed(false);
      try {
        const feedback =
          retainedFeedback ?? (await onAiEvaluationRequested?.(evaluation, position));
        if (!feedback) throw new Error("OD_EXERCISE_AI_FEEDBACK_REQUIRED");
        const nextEvaluations = [...evaluations, evaluation];
        setEvaluations(nextEvaluations);
        setAiFeedbackByPosition((current) => ({ ...current, [position]: feedback }));
        setCurrentAiFeedback(feedback);
        setCurrentEvaluation(evaluation);
      } catch (cause) {
        setAiEvaluationFailed(
          normalizeDesktopError(cause).detail.kind === "exercise-context-missing"
            ? "context-missing"
            : "failed",
        );
      } finally {
        setEvaluatingWithAi(false);
      }
      return;
    }
    const nextEvaluations = [...evaluations, evaluation];
    setEvaluations(nextEvaluations);
    setCurrentEvaluation(evaluation);
  };

  const start = async (newAttempt = false) => {
    setStarting(true);
    setStartFailed(false);
    try {
      if (newAttempt && onNewAttempt) {
        await onNewAttempt();
        setPosition(0);
        setFurthestPosition(0);
        setValues([]);
        setValuesByPosition({});
        setSubmittedByPosition({});
        setHintCount(0);
        setHintCountByPosition({});
        setEvaluations([]);
        setCurrentEvaluation(undefined);
        setAiFeedbackByPosition({});
        setCurrentAiFeedback(undefined);
        setResuming(false);
      } else await onStarted?.();
      setStarted(true);
    } catch {
      setStartFailed(true);
    } finally {
      setStarting(false);
    }
  };
  const abandon = async () => {
    setAbandoning(true);
    setAbandonFailed(false);
    try {
      await onAbandoned?.();
      setAbandoned(true);
    } catch {
      setAbandonFailed(true);
    } finally {
      setAbandoning(false);
    }
  };
  return {
    resuming,
    started,
    position,
    furthestPosition,
    values,
    savingSupport,
    supportFailed,
    hintCount,
    hintOpen,
    setHintOpen,
    evaluations,
    currentEvaluation,
    starting,
    startFailed,
    completing,
    completionFailed,
    answerInvalid,
    evaluatingWithAi,
    aiEvaluationFailed,
    savingAnswer,
    submittedByPosition,
    answerSaveFailed,
    currentAiFeedback,
    aiFeedbackByPosition,
    abandoning,
    abandonFailed,
    abandoned,
    definition,
    displayedHints,
    revealHint,
    setValue,
    navigateTo,
    advance,
    submit,
    start,
    abandon,
  };
}
