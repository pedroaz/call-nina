import { useTranslation } from "react-i18next";
import { Section } from "../../components/layout/index.js";
import {
  Button,
  Disclosure,
  Feedback,
  ModalDialog,
  SelectField,
  TextField,
} from "../../components/ui/index.js";
import { OperationError } from "../../components/ui/OperationError.js";
import { NinaAccountSettings } from "../account/NinaAccount.js";
import { ConnectionModelPreferences } from "./ConnectionModelPreferences.js";
import styles from "./ConnectionSettings.module.css";
import { defaultPreference } from "./ConnectionSettings.types.js";
import { ProviderStatus } from "./ProviderStatus.js";
import { type useConnectionSettingsController } from "./useConnectionSettingsController.js";

export function ConnectionSetupDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useConnectionSettingsController>,
    | "t"
    | "draft"
    | "saved"
    | "credentialAction"
    | "discard"
    | "setSelectedId"
    | "busy"
    | "view"
    | "dirty"
    | "resolution"
    | "effectiveModel"
    | "availability"
    | "chatgptConnected"
    | "chatgptAccess"
    | "authHelp"
    | "isDirect"
    | "updateCredential"
    | "error"
    | "credential"
    | "needsChatgptModels"
    | "chatgptModels"
    | "chatgptModelsError"
    | "setChatgptModelsRetry"
    | "modelCatalog"
    | "updateDraft"
    | "selectedModelId"
    | "draftModel"
    | "offline"
    | "offlineRef"
    | "offlineEligibility"
    | "offlineState"
    | "gib"
    | "offlinePreflight"
    | "offlineBusy"
    | "manageOffline"
    | "setConfirmOfflineRemove"
    | "confirmOfflineRemove"
    | "directCatalog"
    | "listedOperations"
    | "setConfirmRemove"
    | "confirmRemove"
    | "remove"
    | "readFailure"
    | "offlineReadFailure"
    | "operationError"
    | "saving"
    | "save"
  >;
}) {
  const {
    t,
    draft,
    saved,
    credentialAction,
    discard,
    setSelectedId,
    busy,
    view,
    dirty,
    resolution,
    effectiveModel,
    availability,
    chatgptConnected,
    chatgptAccess,
    authHelp,
    isDirect,
    updateCredential,
    error,
    credential,
    needsChatgptModels,
    chatgptModels,
    chatgptModelsError,
    setChatgptModelsRetry,
    modelCatalog,
    updateDraft,
    selectedModelId,
    draftModel,
    offline,
    offlineRef,
    offlineEligibility,
    offlineState,
    gib,
    offlinePreflight,
    offlineBusy,
    manageOffline,
    setConfirmOfflineRemove,
    confirmOfflineRemove,
    readFailure,
    offlineReadFailure,
    operationError,
    saving,
    save,
  } = model;
  const { i18n } = useTranslation();
  if (!draft) return null;
  return (
    <ModalDialog
      isOpen
      title={t(`connectionSettings.routes.${draft.routeId}`)}
      closeLabel={t("actions.close")}
      isDismissable
      onOpenChange={(open) => {
        if (!open) {
          const untouched =
            !saved &&
            draft.label === t(`connectionSettings.routes.${draft.routeId}`) &&
            JSON.stringify(draft.preference) === JSON.stringify(defaultPreference) &&
            credentialAction === "keep";
          if (untouched) discard();
          else setSelectedId(undefined);
        }
      }}
    >
      <Section
        surface={false}
        className={styles.editor}
        aria-busy={busy}
        data-ai-connection={saved?.id ?? ""}
        data-route={saved?.routeId ?? ""}
        data-root-generation={view?.expectedGeneration}
        data-connection-revision={view?.settings.revision}
        data-dirty={dirty}
        data-effective-model={resolution?.status === "available" ? resolution.effectiveModelId : ""}
        data-effective-effort={
          resolution?.status === "available" ? resolution.effectiveEffortId : ""
        }
        data-default-effort={effectiveModel?.defaultReasoningEffort ?? ""}
      >
        {draft.routeId === "claude-code" ? (
          <p>{t("connectionSettings.claudeUnavailable")}</p>
        ) : availability?.status === "adapter-unavailable" ? (
          <p>{t("connectionSettings.routeUnavailable")}</p>
        ) : null}
        {view && draft.routeId !== "chatgpt" && (
          <ProviderStatus route={draft.routeId} view={view} chatgptConnected={chatgptConnected} />
        )}
        {draft.routeId === "chatgpt" &&
          (chatgptAccess ? (
            chatgptAccess({
              active: true,
              saved: Boolean(saved),
              dirty: Boolean(saved) && dirty,
            })
          ) : (
            <p>{authHelp ?? t("connectionSettings.chatgptAuth")}</p>
          ))}
        {draft.routeId === "managed" && <NinaAccountSettings />}
        {isDirect && (
          <section className={styles.secret}>
            {view?.secureStorage.status === "unavailable" && (
              <p>{t("connectionSettings.secureStorageUnavailable")}</p>
            )}
            {saved?.secretRef && credentialAction === "keep" ? (
              <div className={styles.keySummary}>
                <p>{t("connectionSettings.keySaved")}</p>
                <div className={styles.actions}>
                  <Button
                    variant="secondary"
                    isDisabled={busy || view?.secureStorage.status !== "available"}
                    onPress={() => {
                      updateCredential({ action: "replace", secret: "" });
                    }}
                  >
                    {t("connectionSettings.replaceKey")}
                  </Button>
                  <Button
                    variant="quiet"
                    isDisabled={busy}
                    onPress={() => {
                      updateCredential({ action: "remove", secret: "" });
                    }}
                  >
                    {t("connectionSettings.removeKey")}
                  </Button>
                </div>
              </div>
            ) : credentialAction === "remove" ? (
              <div className={styles.keySummary}>
                <p>{t("providers.keyRemovalPending")}</p>
                <Button
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => {
                    updateCredential({ action: "keep", secret: "" });
                  }}
                >
                  {t("actions.cancel")}
                </Button>
              </div>
            ) : (
              <>
                <TextField
                  label={t(
                    saved?.secretRef
                      ? "connectionSettings.keyEntry"
                      : "connectionSettings.keyAction",
                  )}
                  error={error === "connectionSettings.keyRequired" ? t(error) : undefined}
                  type="password"
                  maxLength={8192}
                  disabled={busy || view?.secureStorage.status !== "available"}
                  autoComplete="off"
                  value={credential}
                  onChange={(event) => {
                    updateCredential({ action: "replace", secret: event.target.value });
                  }}
                />
                {saved?.secretRef && (
                  <Button
                    variant="quiet"
                    isDisabled={busy}
                    onPress={() => {
                      updateCredential({ action: "keep", secret: "" });
                    }}
                  >
                    {t("actions.cancel")}
                  </Button>
                )}
              </>
            )}
          </section>
        )}
        {draft.routeId !== "claude-code" && (
          <Disclosure label={t("connectionSettings.advanced")}>
            <div className={styles.modelControls}>
              {needsChatgptModels && !chatgptModels && !chatgptModelsError && (
                <p role="status">{t("providers.checkingConnection")}</p>
              )}
              {needsChatgptModels && chatgptModelsError && (
                <OperationError error={chatgptModelsError}>
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => {
                      setChatgptModelsRetry((value) => value + 1);
                    }}
                  >
                    {t("actions.retry")}
                  </Button>
                </OperationError>
              )}
              <SelectField
                label={t("modelControl.model")}
                disabled={busy || !modelCatalog}
                value={
                  draft.preference.model.mode === "automatic"
                    ? "automatic"
                    : draft.preference.model.modelId
                }
                onChange={(event) => {
                  updateDraft({
                    preference: {
                      ...draft.preference,
                      effort: { mode: "semantic", effort: "balanced" },
                      model:
                        event.target.value === "automatic"
                          ? { mode: "automatic" }
                          : { mode: "exact", modelId: event.target.value },
                    },
                  });
                }}
              >
                <option value="automatic">{t("connections.runtimeDefault")}</option>
                {selectedModelId &&
                  !modelCatalog?.models.some((entry) => entry.id === selectedModelId) && (
                    <option value={selectedModelId}>{selectedModelId}</option>
                  )}
                {modelCatalog?.models.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </option>
                ))}
              </SelectField>

              {Boolean(draftModel && draftModel.supportedReasoningEfforts.length > 1) && (
                <SelectField
                  label={t("settings.effort")}
                  disabled={busy}
                  value={
                    draft.preference.effort.mode === "semantic"
                      ? `semantic:${draft.preference.effort.effort}`
                      : draft.preference.effort.effortId
                  }
                  onChange={(event) => {
                    updateDraft({
                      preference: {
                        ...draft.preference,
                        effort: event.target.value.startsWith("semantic:")
                          ? {
                              mode: "semantic",
                              effort: event.target.value.slice(9) as "fast" | "balanced" | "deep",
                            }
                          : { mode: "exact", effortId: event.target.value },
                      },
                    });
                  }}
                >
                  {(["fast", "balanced", "deep"] as const).map((effort) => (
                    <option key={effort} value={`semantic:${effort}`}>
                      {t(`settings.semanticEfforts.${effort}`)}
                    </option>
                  ))}
                  {draft.preference.effort.mode === "exact" &&
                    !draftModel?.supportedReasoningEfforts.includes(
                      draft.preference.effort.effortId,
                    ) && (
                      <option value={draft.preference.effort.effortId}>
                        {draft.preference.effort.effortId}
                      </option>
                    )}
                  {draftModel?.supportedReasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </SelectField>
              )}
            </div>
          </Disclosure>
        )}
        {draft.routeId === "local" && offline && (
          <div ref={offlineRef} className={styles.offline} tabIndex={-1} data-focus-anchor>
            <h4>{t("connectionSettings.offlineTitle")}</h4>
            <p>{t("connectionSettings.offlineScope")}</p>
            <p>{t("connectionSettings.offlineLimits")}</p>
            <p role="status">{t(`connectionSettings.offlineState.${offline.snapshot.state}`)}</p>
            {offline.snapshot.errorCode && (
              <Feedback tone="error" live="assertive" density="compact">
                {t("connectionSettings.offlineFailure")}
              </Feedback>
            )}
            {offlineEligibility !== "ready" && offlineState !== "generating" && (
              <p role="status">
                {t(
                  `connectionSettings.offlineEligibility.${offlineEligibility ?? "resources-unknown"}`,
                )}
              </p>
            )}
            <p>
              {t("connectionSettings.offlineMemoryReadout", {
                total: gib(offlinePreflight?.totalMemoryBytes),
                requiredTotal: gib(offline.catalog.admissionMemoryBytes),
                available: gib(offlinePreflight?.freeMemoryBytes),
                requiredAvailable: gib(offline.catalog.admissionFreeMemoryBytes),
              })}
            </p>
            <p>
              {t("connectionSettings.offlineDiskReadout", {
                available: gib(offlinePreflight?.availableDiskBytes),
                required: gib(offlinePreflight?.requiredDiskBytes),
              })}
            </p>
            {(offline.snapshot.state === "downloading" ||
              offline.snapshot.state === "verifying") && (
              <p>
                {t("connectionSettings.offlineProgress", {
                  downloaded: (offline.snapshot.downloadedBytes / 1_000_000_000).toLocaleString(
                    i18n.language,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                  ),
                  total: (offline.snapshot.downloadBytes / 1_000_000_000).toLocaleString(
                    i18n.language,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                  ),
                })}
              </p>
            )}
            <div className={styles.actions}>
              {(offline.snapshot.state === "absent" ||
                offline.snapshot.state === "partial" ||
                offline.snapshot.state === "unavailable") && (
                <Button
                  variant="primary"
                  isDisabled={
                    busy ||
                    offlineBusy ||
                    offline.snapshot.preflight?.installationEligibility !== "ready"
                  }
                  onPress={() => void manageOffline("install")}
                >
                  {t(
                    offline.snapshot.state === "partial"
                      ? "connectionSettings.offlineResume"
                      : "connectionSettings.offlineInstall",
                  )}
                </Button>
              )}
              {(offline.snapshot.state === "downloading" ||
                offline.snapshot.state === "verifying") && (
                <Button
                  variant="primary"
                  isDisabled={busy || offlineBusy}
                  onPress={() => void manageOffline("cancel")}
                >
                  {t("connectionSettings.offlineCancelDownload")}
                </Button>
              )}
              {(offline.snapshot.state === "installed" ||
                offline.snapshot.state === "partial" ||
                offline.snapshot.state === "unavailable") && (
                <Button
                  variant="primary"
                  isDisabled={busy || offlineBusy || !offlinePreflight?.platformSupported}
                  onPress={() => {
                    setConfirmOfflineRemove(true);
                  }}
                >
                  {t("connectionSettings.offlineRemove")}
                </Button>
              )}
            </div>
            {confirmOfflineRemove && (
              <div className={styles.confirm}>
                <p>{t("connectionSettings.offlineRemoveWarning")}</p>
                <div className={styles.actions}>
                  <Button
                    variant="primary"
                    isDisabled={busy || offlineBusy || !offlinePreflight?.platformSupported}
                    onPress={() => void manageOffline("remove")}
                  >
                    {t("connectionSettings.offlineConfirmRemove")}
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={busy || offlineBusy}
                    onPress={() => {
                      setConfirmOfflineRemove(false);
                    }}
                  >
                    {t("actions.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <ConnectionModelPreferences model={model} />
        {readFailure}
        {offlineReadFailure}
        {operationError && <OperationError error={operationError} />}
        {error && error !== "connectionSettings.keyRequired" && (
          <Feedback tone="error" live="assertive">
            {t(error)}
          </Feedback>
        )}
        {(dirty || saving) && draft.routeId !== "claude-code" && (
          <div className={styles.editorActions}>
            <Button variant="secondary" isDisabled={busy || !dirty} onPress={discard}>
              {t("settings.discard")}
            </Button>
            <Button variant="primary" isDisabled={busy || !dirty} onPress={() => void save()}>
              {t("settings.save")}
            </Button>
          </div>
        )}
      </Section>
    </ModalDialog>
  );
}
