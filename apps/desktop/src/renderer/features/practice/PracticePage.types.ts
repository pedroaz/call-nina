import type { PracticeSource, Language } from "@call-nina/contracts";
import type { ActivityHostProps } from "../../learning/practice/activity-types.js";
import type { HistoryPracticeSeed } from "../../learning/results/SavedResults.js";
import type { SavedResultsScope } from "../../learning/results/savedResultsTypes.js";
import type { PracticeLaunch } from "../../learning/practice/usePracticeSuggestion.js";

export type PracticeLibraryFilter =
  | "flashcards"
  | "all"
  | "custom-lesson"
  | "grammar"
  | "reading"
  | "codex-listening"
  | "voice-speaking"
  | "writing"
  | "vocabulary-review"
  | "placement";

export type PracticeLevel = "a1" | "a2" | "b1" | "b2";

export interface PracticePageProps extends ActivityHostProps {
  resultsReturnLabel?: string | undefined;
  resultsRequest?: { scope?: SavedResultsScope; requestId: number } | undefined;
  onPracticeAgain?: ((seed: HistoryPracticeSeed) => void) | undefined;
  onReturnToSource?: (() => void) | undefined;
  selectedTab?: "new" | "saved";
  onTabChange?: (tab: "new" | "saved") => void;
  targetLanguage?: Language | undefined;
  initialPreparation?: Extract<PracticeLaunch, { destination: "preparation" }>;
  onWriting?: (source?: PracticeSource) => void;
  initialPracticeSource?: PracticeSource | undefined;
}
