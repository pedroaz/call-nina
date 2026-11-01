import { Button, Disclosure } from "../../components/ui/index.js";
import styles from "./ConnectionSettings.module.css";
import { type useConnectionSettingsController } from "./useConnectionSettingsController.js";

export function ConnectionModelPreferences({
  model,
}: {
  model: Pick<
    ReturnType<typeof useConnectionSettingsController>,
    | "t"
    | "draft"
    | "directCatalog"
    | "availability"
    | "isDirect"
    | "listedOperations"
    | "saved"
    | "busy"
    | "dirty"
    | "setConfirmRemove"
    | "confirmRemove"
    | "remove"
  >;
}) {
  const {
    t,
    draft,
    directCatalog,
    availability,
    isDirect,
    listedOperations,
    saved,
    busy,
    dirty,
    setConfirmRemove,
    confirmRemove,
    remove,
  } = model;
  if (!draft) return null;
  return (
    <Disclosure label={t("connectionSettings.details")}>
      <div className={styles.detailsBody}>
        <p>{t(`connectionSettings.destination.${draft.routeId}`)}</p>
        {directCatalog && <p>{t("connectionSettings.directCatalogNotice")}</p>}
        {availability?.status === "inactive" &&
        !isDirect &&
        draft.routeId !== "local" ? null : listedOperations?.length ? (
          <p>
            {t("connectionSettings.operations", {
              operations: listedOperations
                .map((operation) => t(`connectionSettings.operation.${operation}`))
                .join(", "),
            })}
          </p>
        ) : (
          <p>{t("connectionSettings.noOperations")}</p>
        )}
        {saved && (
          <div className={styles.remove}>
            <Button
              variant="quiet"
              isDisabled={busy || dirty}
              onPress={() => {
                setConfirmRemove(true);
              }}
            >
              {t("connectionSettings.remove")}
            </Button>
            {confirmRemove && (
              <div className={styles.confirm}>
                <p>{t("connectionSettings.removeWarning")}</p>
                <div className={styles.actions}>
                  <Button variant="danger" isDisabled={busy} onPress={() => void remove()}>
                    {t("connectionSettings.confirmRemove")}
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => {
                      setConfirmRemove(false);
                    }}
                  >
                    {t("actions.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Disclosure>
  );
}
