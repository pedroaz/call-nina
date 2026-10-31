import { type CallNinaError, type DesktopIpcResponse } from "@call-nina/contracts";
import { BookOpen, Gauge, House, LibraryBig, Route, Smartphone, UsersRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionGroup } from "../components/layout/index.js";
import { Button, ModalDialog } from "../components/ui/index.js";
import { OperationError } from "../components/ui/OperationError.js";
import { type PathDestination } from "../learning/curriculum/learningPathNavigation.js";
import { type PracticeLaunch } from "../learning/practice/usePracticeSuggestion.js";
import { invokeDesktop, normalizeDesktopError } from "../runtime/ipc.js";

export type Readiness = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "app/readiness" }
>["result"];

export type PreparedActivityId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "dashboard/read" }
>["result"]["preparedActivities"][number]["activityId"];

export type WorkspacePage =
  | "nina"
  | "practice"
  | "writing"
  | "vocabulary"
  | "stories"
  | "community"
  | "mobile"
  | "learningPath"
  | "personalData"
  | "settings";

export type NavigationTarget =
  | {
      destination: "practice";
      tab?: "new" | "saved";
      seed?: Extract<PracticeLaunch, { destination: "preparation" }>;
    }
  | { destination: "settings"; tab?: "profile" | "ai" | "data" | "diagnostics" }
  | { destination: Exclude<WorkspacePage, "practice" | "settings"> };

export const navigation: ReadonlyArray<{
  page: WorkspacePage;
  icon: typeof House;
}> = [
  { page: "nina", icon: House },
  { page: "practice", icon: Gauge },
  { page: "learningPath", icon: Route },
  { page: "vocabulary", icon: LibraryBig },
  { page: "stories", icon: BookOpen },
  { page: "mobile", icon: Smartphone },
  { page: "community", icon: UsersRound },
];

export function FirstAiReminder({ close }: { close: (acknowledged: boolean) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();
  const acknowledge = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await invokeDesktop("privacy/ai-disclosure/acknowledge", {});
      close(true);
    } catch (cause) {
      setError(normalizeDesktopError(cause).detail);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalDialog
      isOpen
      title={t("aiReminder.title")}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <p>{t("aiReminder.body")}</p>
      {error && <OperationError error={error} />}
      <ActionGroup align="end">
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={() => {
            close(false);
          }}
        >
          {t("actions.cancel")}
        </Button>
        <Button
          isPending={busy}
          pendingLabel={t("actions.acknowledge")}
          variant="primary"
          onPress={() => void acknowledge()}
        >
          {t("actions.acknowledge")}
        </Button>
      </ActionGroup>
    </ModalDialog>
  );
}

export type DesktopWorkspaceProps = {
  readiness: Readiness;
  reload: () => Promise<void>;
  onRunSetup: () => void;
  initialPage: WorkspacePage;
  initialPath?: PathDestination | undefined;
};
