import type { DesktopIpcRequest, DesktopIpcResponse } from "@call-nina/contracts";

export type Snapshot = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "history/read" }
>["result"];
export type Entry = Snapshot["entries"][number];
export type HistoryPayload = Extract<DesktopIpcRequest, { channel: "history/read" }>["payload"];
export type Skill = NonNullable<HistoryPayload["skill"]>;
export type ActivityType = NonNullable<HistoryPayload["activityType"]>;

export type SavedResultsScope = {
  correctionId?: NonNullable<HistoryPayload["correctionId"]>;
  activityId?: NonNullable<HistoryPayload["activityId"]>;
  historyEntryIds?: NonNullable<HistoryPayload["historyEntryIds"]>;
  label?: string;
};

export type HistoryPracticeSeed =
  | Readonly<{
      kind: "writing";
      historyEntryId: string;
      draft: string;
      context: string;
    }>
  | Readonly<{ kind: "exercise"; activityId: string }>;

export type PracticeState = Readonly<{
  patternKey: string;
  status: "queued" | "running" | "created" | "cancelled" | "failed";
}>;
