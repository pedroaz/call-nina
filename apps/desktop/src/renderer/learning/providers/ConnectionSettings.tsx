import { Check } from "lucide-react";
import { createPortal } from "react-dom";
import { Button, Feedback } from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import styles from "./ConnectionSettings.module.css";
import { type ConnectionSettingsProps } from "./ConnectionSettings.types.js";
import { ConnectionSetupDialog } from "./ConnectionSetupDialog.js";
import { ProviderRouting } from "./ProviderRouting.js";

import { useConnectionSettingsController } from "./useConnectionSettingsController.js";

export function ConnectionSettings(props: ConnectionSettingsProps) {
  const model = useConnectionSettingsController(props);
  const {
    busy,
    draft,
    readFailure,
    offlineReadFailure,
    listRef,
    view,
    overview,
    offlineBusy,
    add,
    mutate,
    chatgptConnected,
    t,
    error,
    operationError,
    feedbackTarget,
  } = model;
  return (
    <div className={styles.panel} aria-busy={busy} data-provider-detail={Boolean(draft)}>
      {!draft && readFailure}
      {!draft && offlineReadFailure}
      <div className={styles.providerOverview} ref={listRef} tabIndex={-1} data-focus-anchor>
        {view &&
          (overview ? (
            overview({ view, busy: busy || offlineBusy, select: add, mutate })
          ) : (
            <ProviderRouting
              view={view}
              busy={busy}
              mutate={mutate}
              select={add}
              chatgptConnected={chatgptConnected}
            />
          ))}
      </div>
      {draft ? (
        <ConnectionSetupDialog model={model} />
      ) : !view ? (
        <p>{t("settings.loading")}</p>
      ) : null}
      {view?.settings.migrationNotice && (
        <div className={styles.notice}>
          <Check aria-hidden="true" />
          <p>{t("connections.migrated")}</p>
          <Button
            variant="quiet"
            isDisabled={busy}
            onPress={() => void mutate({ kind: "dismiss-migration" })}
          >
            {t("connections.dismiss")}
          </Button>
        </div>
      )}
      {view && view.settings.retiredSecretRefs.length > 0 && (
        <p>{t("connections.cleanupPending")}</p>
      )}
      {!draft &&
        (feedbackTarget ? (
          createPortal(
            <>
              {operationError && <OperationError error={operationError} />}
              {error && (
                <Feedback tone="error" live="assertive">
                  {t(error)}
                </Feedback>
              )}
            </>,
            feedbackTarget,
          )
        ) : (
          <>
            {operationError && <OperationError error={operationError} />}
            {error && (
              <Feedback tone="error" live="assertive">
                {t(error)}
              </Feedback>
            )}
          </>
        ))}
    </div>
  );
}
export type { ConnectionSettingsHandle } from "./ConnectionSettings.types.js";

export type { ConnectionOverviewProps } from "./ConnectionSettings.types.js";
