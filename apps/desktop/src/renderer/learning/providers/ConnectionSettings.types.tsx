import type {
  AiConnection,
  AiModelPreference,
  DesktopIpcRequest,
  DesktopIpcResponse,
  OfflineSnapshot,
} from "@call-nina/contracts";
import { type ReactNode, type Ref } from "react";

export type View = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "ai-connections/read" }
>["result"];

export type Action = Extract<
  DesktopIpcRequest,
  { channel: "ai-connections/update" }
>["payload"]["action"];

export type Draft = Pick<AiConnection, "id" | "label" | "routeId" | "preference">;

export type CredentialDraft = { action: "keep" | "replace" | "remove"; secret: string };

export type Route = Draft["routeId"];

export type OfflineView = View["offlineModel"];

export const activeOfflineStates: OfflineSnapshot["state"][] = [
  "downloading",
  "verifying",
  "removing",
];

export const directRoutes: Route[] = ["openai", "anthropic", "google"];

export const defaultPreference: AiModelPreference = {
  model: { mode: "automatic" },
  effort: { mode: "semantic", effort: "balanced" },
};

export const withoutDraft = (drafts: Record<string, Draft>, id: string) =>
  Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== id));

export const withoutCredential = (credentials: Record<string, CredentialDraft>, id: string) =>
  Object.fromEntries(Object.entries(credentials).filter(([key]) => key !== id));

export type ConnectionSettingsHandle = { refreshStatus: () => Promise<void> };

export type ConnectionOverviewProps = {
  view: View;
  busy: boolean;
  select: (route: Route) => void;
  mutate: (action: Action) => Promise<boolean>;
};

export type ConnectionSettingsProps = {
  overview?: (props: ConnectionOverviewProps) => ReactNode;
  ref?: Ref<ConnectionSettingsHandle>;
  onBusyChange?: (busy: boolean) => void;
  feedbackTarget?: HTMLElement | null;
  active: boolean;
  chatgptConnected?: boolean | undefined;
  disabled?: boolean;
  surface?: boolean;
  onPendingChange?: (pending: boolean) => void;
  authHelp?: string;
  chatgptAccess?: (context: { active: boolean; saved: boolean; dirty: boolean }) => ReactNode;
};
