/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Tables scroll horizontally and must be keyboard-scrollable. */
import {
  aiActionSchema,
  aiProviderOrder,
  type aiConnectionsViewSchema,
  type DesktopIpcRequest,
  type z,
} from "@call-nina/contracts";
import { useId, useState } from "react";
import { Section, ActionGroup } from "./components/layout/index.js";
import { ProviderMatrix, ProviderChoice } from "./ProviderMatrix.js";
import { useNinaAccountState } from "./NinaAccount.js";
import { ProviderStatus } from "./ProviderStatus.js";
import { providerSupports } from "@call-nina/domain";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, ModalDialog } from "./components/ui/index.js";
import styles from "./ConnectionSettings.module.css";

type View = z.infer<typeof aiConnectionsViewSchema>;
type Action = Extract<DesktopIpcRequest, { channel: "ai-connections/update" }>["payload"]["action"];
const providers = aiProviderOrder.filter((provider) => provider !== "claude-code");
export function ProviderRouting({
  view,
  busy,
  mutate,
  select,
  chatgptConnected,
}: {
  view: View;
  chatgptConnected?: boolean | undefined;
  busy: boolean;
  mutate: (action: Action) => Promise<boolean>;
  select: (route: (typeof aiProviderOrder)[number]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const nina = useNinaAccountState();
  const routing = view.settings.routing;
  const [advanced, setAdvanced] = useState(false);
  const supports = (
    route: (typeof providers)[number],
    capability: "text" | "image",
    action?: (typeof aiActionSchema.options)[number],
  ) => {
    const connection = view.settings.connections.find((entry) => entry.routeId === route);
    const status = view.availability.find((entry) => entry.connectionId === connection?.id)?.status;
    return Boolean(
      connection &&
      (route !== "chatgpt" || chatgptConnected !== false) &&
      (route !== "managed" || (nina.status === "signed-in" && !nina.identity.pending)) &&
      (status === "available" || status === "configured") &&
      providerSupports(view, connection, capability, action),
    );
  };
  return (
    <Section
      title={t("setupUx.aiPractice")}
      actions={
        <Button
          variant="quiet"
          aria-haspopup="dialog"
          onPress={() => {
            setAdvanced(true);
          }}
        >
          {t("providers.advancedAssignments")}
        </Button>
      }
    >
      <ProviderMatrix label={t("setupUx.aiPractice")}>
        {providers.map((route) => {
          const connection = view.settings.connections.find((entry) => entry.routeId === route);
          const available = supports(route, "text");
          const configured =
            route === "managed"
              ? nina.identity.signedIn && !nina.identity.pending
              : route === "chatgpt"
                ? chatgptConnected
                : route === "local"
                  ? ["installed", "generating"].includes(view.offlineModel.snapshot.state)
                  : Boolean(connection?.secretRef);
          const selected = routing.text === route;
          const name = t(`connectionSettings.routes.${route}`);
          const actionLabel = configured
            ? "providers.configure"
            : route === "managed" || route === "chatgpt"
              ? "ninaAccount.signIn"
              : "setupUx.setUp";
          return (
            <tr key={route} data-selected={selected}>
              <th scope="row">{name}</th>
              <td id={`${id}-${route}-status`}>
                <ProviderStatus route={route} view={view} chatgptConnected={chatgptConnected} />
              </td>
              <td>
                <ProviderChoice
                  name={`${id}-text`}
                  checked={selected}
                  disabled={busy || !available}
                  aria-label={`${t("setupUx.aiPractice")}: ${name}`}
                  aria-describedby={`${id}-${route}-status`}
                  title={t(available ? "providers.default" : "providers.setupRequired")}
                  onChange={() =>
                    void mutate({ kind: "routing", routing: { ...routing, text: route } })
                  }
                />
              </td>
              <td>
                <Button
                  variant={selected ? "secondary" : "quiet"}
                  isDisabled={busy}
                  aria-label={`${t(actionLabel)}: ${name}`}
                  aria-haspopup="dialog"
                  onPress={() => {
                    select(route);
                  }}
                >
                  {t(actionLabel)}
                </Button>
              </td>
            </tr>
          );
        })}
        <tr data-selected={!routing.text}>
          <th scope="row">{t("providers.none")}</th>
          <td />
          <td>
            <ProviderChoice
              name={`${id}-text`}
              checked={!routing.text}
              disabled={busy}
              aria-label={`${t("setupUx.aiPractice")}: ${t("providers.none")}`}
              onChange={() => void mutate({ kind: "routing", routing: { ...routing, text: null } })}
            />
          </td>
          <td />
        </tr>
      </ProviderMatrix>
      <ModalDialog
        size="large"
        closeLabel={t("actions.close")}
        isOpen={advanced}
        title={t("providers.advancedAssignments")}
        onOpenChange={setAdvanced}
      >
        <ActionGroup>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => void mutate({ kind: "recommend" })}
          >
            {t("providers.recommend")}
          </Button>
        </ActionGroup>
        <div
          className={styles.matrix}
          tabIndex={0}
          role="region"
          aria-label={t("providers.capabilities")}
        >
          <table className={styles.routingMatrix}>
            <thead>
              <tr>
                <th scope="col">{t("providers.provider")}</th>
                <th scope="col">{t("providers.status")}</th>
                <th scope="col">{t("providers.image")}</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((route) => (
                <tr key={route}>
                  <th scope="row">
                    <Button
                      variant="quiet"
                      className={styles.providerButton}
                      aria-haspopup="dialog"
                      trailingIcon={<ChevronRight aria-hidden="true" />}
                      isDisabled={busy}
                      onPress={() => {
                        setAdvanced(false);
                        select(route);
                      }}
                    >
                      {t(`connectionSettings.routes.${route}`)}
                    </Button>
                  </th>
                  <td>
                    <ProviderStatus route={route} view={view} chatgptConnected={chatgptConnected} />
                  </td>
                  {(["image"] as const).map((capability) => (
                    <td key={capability}>
                      <label
                        className={styles.routingChoice}
                        title={t(
                          supports(route, capability)
                            ? "providers.selectedDefault"
                            : "providers.setupRequired",
                        )}
                      >
                        <input
                          type="radio"
                          name={`${id}-${capability}`}
                          checked={routing[capability] === route}
                          disabled={busy || !supports(route, capability, "vocabulary-analysis")}
                          aria-label={`${t(`providers.${capability}`)}: ${t(`connectionSettings.routes.${route}`)}`}
                          onChange={() =>
                            void mutate({
                              kind: "routing",
                              routing: { ...routing, [capability]: route },
                            })
                          }
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">{t("providers.unassigned")}</th>
                <td />
                {(["image"] as const).map((capability) => (
                  <td key={capability}>
                    <label className={styles.routingChoice}>
                      <input
                        type="radio"
                        name={`${id}-${capability}`}
                        checked={!routing[capability]}
                        disabled={busy}
                        aria-label={`${t(`providers.${capability}`)}: ${t("providers.unassigned")}`}
                        onChange={() =>
                          void mutate({
                            kind: "routing",
                            routing: { ...routing, [capability]: null },
                          })
                        }
                      />
                    </label>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div
          className={styles.matrix}
          tabIndex={0}
          role="region"
          aria-label={t("providers.actionDefaults")}
        >
          <table className={styles.routingMatrix}>
            <thead>
              <tr>
                <th scope="col">{t("setupUx.activity")}</th>
                <th scope="col">{t("providers.useDefault")}</th>
                {providers.map((route) => (
                  <th key={route} scope="col">
                    {t(`connectionSettings.routes.${route}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {aiActionSchema.options.map((action) => (
                <tr key={action}>
                  <th scope="row">{t(`connectionSettings.operation.${action}`)}</th>
                  {[null, ...providers].map((route) => (
                    <td key={route ?? "default"}>
                      <label className={styles.routingChoice}>
                        <input
                          type="radio"
                          name={`${id}-${action}`}
                          checked={(routing.actions[action] ?? null) === route}
                          disabled={busy || Boolean(route && !supports(route, "text", action))}
                          aria-label={`${t(`connectionSettings.operation.${action}`)}: ${route ? t(`connectionSettings.routes.${route}`) : t("providers.useDefault")}`}
                          onChange={() => {
                            const actions = Object.fromEntries(
                              Object.entries(routing.actions).filter(([key]) => key !== action),
                            );
                            if (route) actions[action] = route;
                            void mutate({ kind: "routing", routing: { ...routing, actions } });
                          }}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ModalDialog>
    </Section>
  );
}
