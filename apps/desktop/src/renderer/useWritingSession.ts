import {
  type ProviderOperation,
  type Language,
  type GenerationCandidateOutputMap,
  type CallNinaError,
  writingCorrectionCandidateSchema,
  writingPromptCandidateSchema,
} from "@call-nina/contracts";
import { useEffect, useRef, useState } from "react";
import { useOperationProgress } from "./useOperationProgress.js";
import {
  createDesktopSubmissionId,
  invokeDesktop,
  normalizeDesktopError,
  subscribeDesktop,
} from "./ipc.js";

export type TeachingProfileChoice = "profile-default" | "conversation-partner" | "strict-corrector";
export type FeedbackChoice = "all-meaningful" | "priority-only";

type PromptOutput = GenerationCandidateOutputMap["writing-prompt"];
type CorrectionOutput = GenerationCandidateOutputMap["writing-correction"];
export type CorrelationId = ReturnType<typeof createDesktopSubmissionId>;
type OperationStage = "idle" | "queued" | "running" | "validating" | "cancelling";

export function useWritingSession({
  initialContext,
  initialDraft,
  onDirtyChange,
  requestAiAccess,
}: {
  initialContext: string;
  initialDraft: string;
  onDirtyChange: (dirty: boolean) => void;
  requestAiAccess: (
    operation: ProviderOperation,
    previousOperationId?: CorrelationId,
  ) => Promise<boolean>;
}) {
  const promptProgress = useOperationProgress();
  const correctionProgress = useOperationProgress();
  const [context, setContext] = useState(initialContext);
  const contextRevision = useRef(0);
  const promptContextRevision = useRef<number | undefined>(undefined);
  const activeRequest = useRef<"prompt" | "correction" | undefined>(undefined);
  const [draft, setDraft] = useState(initialDraft);
  const [teachingProfile, setTeachingProfile] = useState<TeachingProfileChoice>("strict-corrector");
  const [feedback, setFeedback] = useState<FeedbackChoice>("all-meaningful");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [prompt, setPrompt] = useState<PromptOutput>();
  const submissionId = useRef<CorrelationId | undefined>(undefined);
  const settledPromptSubmissions = useRef(new Set<CorrelationId>());
  const [operationId, setOperationId] = useState<CorrelationId>();
  const [promptStage, setPromptStage] = useState<"idle" | "queued" | "running" | "validating">(
    "idle",
  );
  const [promptError, setPromptError] = useState<CallNinaError>();
  const correctionSubmissionId = useRef<CorrelationId | undefined>(undefined);
  const settledCorrectionSubmissions = useRef(new Set<CorrelationId>());
  const correctionOriginals = useRef(new Map<CorrelationId, { draft: string; context: string }>());
  const [correctionOperationId, setCorrectionOperationId] = useState<CorrelationId>();
  const [previousCorrectionOperationId, setPreviousCorrectionOperationId] =
    useState<CorrelationId>();
  const [correctionStage, setCorrectionStage] = useState<OperationStage>("idle");
  const [correctionError, setCorrectionError] = useState<CallNinaError>();
  const [correctionOutcome, setCorrectionOutcome] = useState<"cancelled" | "rate-limited">();
  const [correction, setCorrection] = useState<CorrectionOutput>();
  const [correctionOriginal, setCorrectionOriginal] = useState("");
  const [correctionLanguage, setCorrectionLanguage] = useState<Language>();
  const [savedWriting, setSavedWriting] = useState<{ draft: string; context: string }>();
  const dirty =
    (context.length > 0 || draft.length > 0) &&
    (draft !== savedWriting?.draft || context !== savedWriting.context);

  useEffect(() => {
    onDirtyChange(dirty || promptStage !== "idle" || correctionStage !== "idle");
  }, [dirty, promptStage, correctionStage, onDirtyChange]);

  useEffect(
    () =>
      subscribeDesktop((event) => {
        if (
          event.event !== "learning-operation-progress" &&
          event.event !== "learning-operation-finished"
        )
          return;
        if (
          submissionId.current &&
          event.submissionId === submissionId.current &&
          event.event === "learning-operation-progress" &&
          event.kind === "writing-prompt" &&
          !settledPromptSubmissions.current.has(event.submissionId)
        ) {
          setOperationId(event.operationId);
          setPromptStage(
            event.stage === "starting"
              ? "queued"
              : event.stage === "persisting" || event.stage === "cancelling"
                ? "running"
                : event.stage,
          );
        }
        if (
          submissionId.current &&
          event.submissionId === submissionId.current &&
          event.event === "learning-operation-finished" &&
          event.kind === "writing-prompt"
        ) {
          settledPromptSubmissions.current.add(event.submissionId);
          activeRequest.current = undefined;
          setOperationId(undefined);
          setPromptStage("idle");
          if (
            event.outcome.status === "validated" &&
            promptContextRevision.current === contextRevision.current
          ) {
            const output = writingPromptCandidateSchema.parse(event.outcome.output);
            setPrompt(output);
            setContext(`${output.situation}\n\n${output.task}`);
            setPromptError(undefined);
          } else if (event.outcome.status === "failed") {
            setPromptError(event.outcome.error);
          }
          return;
        }
        if (
          !correctionSubmissionId.current ||
          event.submissionId !== correctionSubmissionId.current ||
          event.kind !== "writing-correction" ||
          settledCorrectionSubmissions.current.has(event.submissionId)
        )
          return;
        if (event.event === "learning-operation-progress") {
          setCorrectionOperationId(event.operationId);
          setCorrectionStage(
            event.stage === "persisting"
              ? "validating"
              : event.stage === "starting"
                ? "queued"
                : event.stage,
          );
          return;
        }
        settledCorrectionSubmissions.current.add(event.submissionId);
        activeRequest.current = undefined;
        setCorrectionOperationId(undefined);
        setCorrectionStage("idle");
        if (event.outcome.status === "validated") {
          setPreviousCorrectionOperationId(undefined);
          setCorrection(writingCorrectionCandidateSchema.parse(event.outcome.output));
          setCorrectionLanguage(event.outcome.learningScope?.targetLanguage);
          const saved = correctionOriginals.current.get(event.submissionId);
          setCorrectionOriginal(saved?.draft ?? "");
          if (saved) setSavedWriting(saved);
          setCorrectionError(undefined);
          setCorrectionOutcome(undefined);
        } else if (event.outcome.status === "failed") {
          setPreviousCorrectionOperationId(event.operationId);
          setCorrectionError(event.outcome.error);
          setCorrectionOutcome(undefined);
        } else if (event.outcome.status === "cancelled") {
          setPreviousCorrectionOperationId(undefined);
          setCorrectionOutcome("cancelled");
        } else {
          setPreviousCorrectionOperationId(event.operationId);
          setCorrectionOutcome("rate-limited");
        }
      }),
    [],
  );

  const generatePrompt = async () => {
    if (activeRequest.current) return;
    activeRequest.current = "prompt";
    const revision = contextRevision.current;
    setPromptStage("queued");
    setPromptError(undefined);
    try {
      if (!(await requestAiAccess("writing-prompt")) || revision !== contextRevision.current) {
        activeRequest.current = undefined;
        setPromptStage("idle");
        return;
      }
      const nextSubmissionId = createDesktopSubmissionId();
      submissionId.current = nextSubmissionId;
      promptContextRevision.current = revision;
      promptProgress.begin(nextSubmissionId, "writing-prompt");
      const result = await invokeDesktop("learning-operation/start", {
        submissionId: nextSubmissionId,
        input: {
          kind: "writing-prompt",
          ...(context.trim() ? { naturalRequest: context.trim() } : {}),
        },
      });
      if (!settledPromptSubmissions.current.has(nextSubmissionId)) {
        setOperationId(result.operationId);
      }
    } catch (cause) {
      activeRequest.current = undefined;
      setPromptStage("idle");
      setPromptError(normalizeDesktopError(cause).detail);
    }
  };

  const cancelPrompt = async () => {
    if (!operationId) return;
    try {
      await invokeDesktop("learning-operation/cancel", { operationId });
    } catch (cause) {
      setPromptError(normalizeDesktopError(cause).detail);
    }
  };

  const updateContext = (value: string) => {
    contextRevision.current += 1;
    setPrompt(undefined);
    setContext(value);
  };

  const useFreeWriting = () => {
    updateContext("");
    setPromptError(undefined);
  };

  const startCorrection = async () => {
    if (!draft.trim() || activeRequest.current) return;
    activeRequest.current = "correction";
    setCorrectionStage("queued");
    setCorrectionError(undefined);
    setCorrectionOutcome(undefined);
    try {
      if (!(await requestAiAccess("writing-correction"))) {
        activeRequest.current = undefined;
        setCorrectionStage("idle");
        return;
      }
      const nextSubmissionId = createDesktopSubmissionId();
      correctionSubmissionId.current = nextSubmissionId;
      correctionProgress.begin(nextSubmissionId, "writing-correction");
      correctionOriginals.current.clear();
      correctionOriginals.current.set(nextSubmissionId, { draft, context });
      setCorrection(undefined);
      const result = await invokeDesktop("learning-operation/start", {
        submissionId: nextSubmissionId,
        input: {
          kind: "writing-correction",
          learnerText: draft,
          ...(context.trim() ? { activityGoal: context.trim() } : {}),
          teachingProfile,
          feedbackCoverage: feedback,
        },
      });
      if (!settledCorrectionSubmissions.current.has(nextSubmissionId)) {
        setCorrectionOperationId(result.operationId);
      }
    } catch (cause) {
      activeRequest.current = undefined;
      setCorrectionStage("idle");
      setCorrectionError(normalizeDesktopError(cause).detail);
    }
  };

  const cancelCorrection = async () => {
    if (!correctionOperationId) return;
    setCorrectionStage("cancelling");
    try {
      await invokeDesktop("learning-operation/cancel", { operationId: correctionOperationId });
    } catch (cause) {
      setCorrectionStage("running");
      setCorrectionError(normalizeDesktopError(cause).detail);
    }
  };

  const retryCorrection = async () => {
    if (!previousCorrectionOperationId || activeRequest.current) return;
    const original = correctionSubmissionId.current
      ? correctionOriginals.current.get(correctionSubmissionId.current)
      : undefined;
    if (original === undefined) return;
    activeRequest.current = "correction";
    setCorrectionStage("queued");
    setCorrectionError(undefined);
    setCorrectionOutcome(undefined);
    try {
      if (!(await requestAiAccess("writing-correction", previousCorrectionOperationId))) {
        activeRequest.current = undefined;
        setCorrectionStage("idle");
        return;
      }
      const nextSubmissionId = createDesktopSubmissionId();
      correctionSubmissionId.current = nextSubmissionId;
      correctionProgress.begin(nextSubmissionId, "writing-correction");
      correctionOriginals.current.clear();
      correctionOriginals.current.set(nextSubmissionId, original);
      const result = await invokeDesktop("learning-operation/retry", {
        previousOperationId: previousCorrectionOperationId,
        submissionId: nextSubmissionId,
      });
      if (!settledCorrectionSubmissions.current.has(nextSubmissionId)) {
        setCorrectionOperationId(result.operationId);
      }
    } catch (cause) {
      activeRequest.current = undefined;
      setCorrectionStage("idle");
      setCorrectionError(normalizeDesktopError(cause).detail);
    }
  };

  const updateSelection = (target: HTMLTextAreaElement) => {
    setSelection({ start: target.selectionStart, end: target.selectionEnd });
  };

  return {
    dirty,
    promptProgress,
    correctionProgress,
    context,
    setContext: updateContext,
    draft,
    setDraft,
    teachingProfile,
    setTeachingProfile,
    feedback,
    setFeedback,
    selection,
    prompt,
    operationId,
    promptStage,
    promptError,
    correctionOperationId,
    previousCorrectionOperationId,
    correctionStage,
    correctionError,
    correctionOutcome,
    correction,
    correctionOriginal,
    correctionLanguage,
    generatePrompt,
    cancelPrompt,
    useFreeWriting,
    startCorrection,
    cancelCorrection,
    retryCorrection,
    updateSelection,
  };
}
