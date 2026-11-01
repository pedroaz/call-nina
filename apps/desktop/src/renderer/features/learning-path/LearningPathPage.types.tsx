import type { CallNinaError, DesktopIpcRequest, ProviderOperation } from "@call-nina/contracts";
import { type PathDestination } from "../../learning/curriculum/learningPathNavigation.js";
import { type LearningPathSnapshot } from "../../runtime/useLearningPath.js";

export type Props = {
  initialDestination?: PathDestination | undefined;
  onLanguageSwitchBlockedChange?: (blocked: boolean) => void;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onNina: () => void;
  onOpenResults: (
    ids?: NonNullable<
      Extract<DesktopIpcRequest, { channel: "history/read" }>["payload"]["historyEntryIds"]
    >,
  ) => void;
};

export type LearningPathWorkspaceProps = Props & {
  snapshot: LearningPathSnapshot;
  refresh: () => Promise<LearningPathSnapshot | undefined>;
  readError: CallNinaError | undefined;
  reading: boolean;
};
