import { type ActivityId, type PracticeSource, type ProviderOperation } from "@call-nina/contracts";
import type { SavedResultsScope } from "../results/savedResultsTypes.js";

export type UploadsLibraryProps = {
  requestAiAccess: (
    operation: ProviderOperation,
    previous?: undefined,
    hasImage?: boolean,
  ) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  onPractise: (source: PracticeSource) => void;
  onAddContent: () => void;
  onWordNavigate: (page: "results" | "practice", scope?: SavedResultsScope) => void;
  openAdd?: number;
  onOpenActivity: (id: ActivityId) => void;
};
