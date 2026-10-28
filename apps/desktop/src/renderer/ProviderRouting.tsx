import {
  aiActionSchema,
  aiProviderOrder,
  type aiConnectionsViewSchema,
  type DesktopIpcRequest,
  type z,
} from "@call-nina/contracts";
import { ProviderStatus } from "./ProviderStatus.js";
import { providerSupports } from "@call-nina/domain";
import { ChevronRight, Check, CircleCheck, CircleMinus, CircleAlert, Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Disclosure, SelectField } from "./components/ui/index.js";
import styles from "./ConnectionSettings.module.css";

type View = z.infer<typeof aiConnectionsViewSchema>;
type Action = Extract<DesktopIpcRequest, { channel: "ai-connections/update" }>["payload"]["action"];
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
  const routing = view.settings.routing;
  const choices = (
    capability: "text" | "image",
    action?: (typeof aiActionSchema.options)[number],
  ) =>
    view.settings.connections.map((connection) => (
      <option
        key={connection.routeId}
        value={connection.routeId}
        disabled={!providerSupports(view, connection, capability, action)}
      >
        {t(`connectionSettings.routes.${connection.routeId}`)}
      </option>
    ));
  return (
    <section className={styles.panel} aria-label={t("providers.routing")}>
      <div className={styles.connectionHeading}>
        <h3>{t("providers.routing")}</h3>
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={() => void mutate({ kind: "recommend" })}
        >
          {t("providers.recommend")}
        </Button>
      </div>
      <div className={styles.modelControls}>
        {(["text", "image"] as const).map((capability) => (
          <SelectField
            key={capability}
            label={t(`providers.${capability}`)}
            value={routing[capability] ?? ""}
            disabled={busy}
            onChange={(event) =>
              void mutate({
                kind: "routing",
                routing: { ...routing, [capability]: event.target.value || null },
              })
            }
          >
            <option value="">{t("providers.unassigned")}</option>
            {routing[capability] &&
              !view.settings.connections.some((entry) => entry.routeId === routing[capability]) && (
                <option value={routing[capability]}>
                  {t(`connectionSettings.routes.${routing[capability]}`)}
                </option>
              )}
            {choices(capability, capability === "image" ? "vocabulary-analysis" : undefined)}
          </SelectField>
        ))}
      </div>
      <div className={styles.matrix}>
        <table>
          <caption>{t("providers.capabilities")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("providers.provider")}</th>
              <th scope="col">{t("providers.status")}</th>
              <th scope="col">{t("providers.text")}</th>
              <th scope="col">{t("providers.image")}</th>
              <th scope="col">{t("providers.audio")}</th>
            </tr>
          </thead>
          <tbody>
            {aiProviderOrder.map((route) => {
              const connection = view.settings.connections.find((entry) => entry.routeId === route);
              return (
                <tr key={route}>
                  <th scope="row">
                    <Button
                      variant="quiet"
                      className={styles.providerButton}
                      aria-haspopup="dialog"
                      trailingIcon={<ChevronRight aria-hidden="true" />}
                      isDisabled={busy}
                      onPress={() => {
                        select(route);
                      }}
                    >
                      {t(`connectionSettings.routes.${route}`)}
                    </Button>
                  </th>
                  <td>
                    <ProviderStatus route={route} view={view} chatgptConnected={chatgptConnected} />
                  </td>
                  {(["text", "image"] as const).map((capability) => {
                    const supported = Boolean(
                      connection && providerSupports(view, connection, capability),
                    );
                    const unsupported =
                      route === "claude-code" || (capability === "image" && route !== "chatgpt");
                    const selected = routing[capability] === route;
                    const Icon = supported ? CircleCheck : unsupported ? CircleMinus : CircleAlert;
                    return (
                      <td key={capability}>
                        {selected && supported ? (
                          <span className={styles.selectedCapability} data-ready="true">
                            <Check aria-hidden="true" />
                            {t("providers.selectedDefault")}
                          </span>
                        ) : (
                          <span
                            className={styles.capabilityLabel}
                            data-supported={supported || undefined}
                          >
                            <Icon aria-hidden="true" />
                            {selected ? `${t("providers.selectedDefault")} · ` : ""}
                            {t(
                              supported
                                ? "providers.supported"
                                : unsupported
                                  ? "providers.unsupported"
                                  : "providers.setupRequired",
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <span className={styles.capabilityLabel}>
                      <Clock3 aria-hidden="true" />
                      {t("providers.notImplemented")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Disclosure label={t("providers.actionDefaults")}>
        <div className={styles.modelControls}>
          {aiActionSchema.options.map((action) => (
            <SelectField
              key={action}
              label={t(`connectionSettings.operation.${action}`)}
              value={routing.actions[action] ?? ""}
              disabled={busy}
              onChange={(event) => {
                const actions = { ...routing.actions };
                if (event.target.value)
                  actions[action] = event.target.value as (typeof aiProviderOrder)[number];
                else {
                  const { [action]: removed, ...remaining } = actions;
                  void removed;
                  void mutate({ kind: "routing", routing: { ...routing, actions: remaining } });
                  return;
                }
                void mutate({ kind: "routing", routing: { ...routing, actions } });
              }}
            >
              <option value="">{t("providers.useDefault")}</option>
              {routing.actions[action] &&
                !view.settings.connections.some(
                  (entry) => entry.routeId === routing.actions[action],
                ) && (
                  <option value={routing.actions[action]}>
                    {t(`connectionSettings.routes.${routing.actions[action]}`)}
                  </option>
                )}
              {choices("text", action)}
            </SelectField>
          ))}
        </div>
      </Disclosure>
      <section className={styles.detailsSection}>
        <h3>{t("providers.supportedActions")}</h3>
        {view.settings.connections.map((connection) => (
          <div key={connection.id}>
            <strong>{t(`connectionSettings.routes.${connection.routeId}`)}</strong>
            <p>
              {aiActionSchema.options
                .filter((action) => providerSupports(view, connection, "text", action))
                .map((action) => t(`connectionSettings.operation.${action}`))
                .join(" · ") || t("providers.unsupported")}
            </p>
          </div>
        ))}
      </section>
    </section>
  );
}
