import type {
  DataRootGeneration,
  DesktopIpcResponse,
  Language,
  ProviderOperation,
} from "@call-nina/contracts";
import type { ReactNode } from "react";

export type PreparedActivityId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number]["activityId"];

export type PreparedActivity = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number];

export interface ActivityHostProps {
  onLanguageSwitchBlockedChange?: (blocked: boolean) => void;
  autoStart?: boolean;
  parentLabel?: string;
  activityBreadcrumbs?: ReadonlyArray<{ label: string; onPress: () => void }> | undefined;
  activityTitle?: string | undefined;
  courseCompletionActions?: ReactNode;
  activityId?: PreparedActivityId;
  requestAiAccess: (operation: ProviderOperation) => Promise<boolean>;
  onOpenActivity: (activityId: PreparedActivityId) => void;
  onCloseActivity: () => void;
  onVocabulary?: () => void;
  onResults: (language: Language, rootGeneration: DataRootGeneration) => void;
  onNina: (language: Language, rootGeneration: DataRootGeneration) => void;
  onReviewVocabulary?:
    ((language: Language, rootGeneration: DataRootGeneration) => void) | undefined;
}
