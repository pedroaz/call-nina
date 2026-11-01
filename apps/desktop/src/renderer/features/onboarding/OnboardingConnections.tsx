import { InterviewChoices } from "@call-nina/browser-ui";
import type { AiConnection } from "@call-nina/contracts";
import { providerSupports } from "@call-nina/domain";
import { HardDrive, KeyRound, MessageCircle, UserRound } from "lucide-react";
import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Button, Disclosure } from "../../components/ui/index.js";
import { useNinaAccountState } from "../../learning/account/NinaAccount.js";
import { type ConnectionOverviewProps } from "../../learning/providers/ConnectionSettings.js";
import { ProviderStatus } from "../../learning/providers/ProviderStatus.js";
import styles from "./ProfileOnboarding.module.css";

type Route = AiConnection["routeId"];
const mainRoutes: Route[] = ["managed", "chatgpt"];
const otherRoutes: Route[] = ["openai", "anthropic", "google", "local"];

export function OnboardingConnections({
  view,
  busy,
  select,
  mutate,
  chatgptConnected,
  onReadyChange,
  continuationRef,
}: ConnectionOverviewProps & {
  chatgptConnected: boolean;
  onReadyChange: (ready: boolean) => void;
  continuationRef: Ref<() => Promise<boolean>>;
}) {
  const { t } = useTranslation();
  const nina = useNinaAccountState();
  const [chosen, setChosen] = useState<Route | undefined>(view.settings.routing.text ?? undefined);
  const connection = view.settings.connections.find((entry) => entry.routeId === chosen);
  const status = view.availability.find((entry) => entry.connectionId === connection?.id)?.status;
  const usable = Boolean(
    connection &&
    (status === "available" || status === "configured") &&
    (chosen !== "chatgpt" || chatgptConnected) &&
    (chosen !== "managed" || (nina.status === "signed-in" && !nina.identity.pending)) &&
    providerSupports(view, connection, "text"),
  );
  useEffect(() => {
    onReadyChange(usable);
    return () => {
      onReadyChange(false);
    };
  }, [usable, onReadyChange]);
  useImperativeHandle(continuationRef, () => async () => {
    if (!usable || busy || !chosen) return false;
    return mutate({
      kind: "routing",
      routing: { ...view.settings.routing, text: chosen },
    });
  });
  const choose = (value: string) => {
    const route = value as Route;
    setChosen(route);
    select(route);
  };
  const options = (routes: Route[]) =>
    routes.map((route) => ({
      value: route,
      label: t(
        route === "managed"
          ? "interview.ninaAccount"
          : route === "chatgpt"
            ? "interview.chatgpt"
            : `connectionSettings.routes.${route}`,
      ),
      icon:
        route === "managed" ? (
          <UserRound />
        ) : route === "chatgpt" ? (
          <MessageCircle />
        ) : route === "local" ? (
          <HardDrive />
        ) : (
          <KeyRound />
        ),
      description: <ProviderStatus route={route} view={view} chatgptConnected={chatgptConnected} />,
    }));
  return (
    <div className={styles.options}>
      <InterviewChoices
        label={t("interview.connectionTitle")}
        value={chosen}
        options={options(mainRoutes)}
        onChange={choose}
        disabled={busy}
      />
      <Disclosure
        label={t("interview.otherConnections")}
        defaultOpen={Boolean(chosen && otherRoutes.includes(chosen))}
      >
        <InterviewChoices
          label={t("interview.otherConnections")}
          value={chosen}
          options={options(otherRoutes)}
          onChange={choose}
          disabled={busy}
        />
      </Disclosure>
      {chosen && (
        <div className={styles.connectionActions}>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => {
              select(chosen);
            }}
          >
            {t("providers.configure")}
          </Button>
        </div>
      )}
    </div>
  );
}
