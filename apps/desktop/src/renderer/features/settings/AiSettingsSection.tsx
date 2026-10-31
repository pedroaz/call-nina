import { AudioLines, CircleCheck, CircleHelp, Gauge, LogOut, UserRound } from "lucide-react";
import { ActionGroup, Section } from "../../components/layout/index.js";
import { Button, Feedback, InfoHint, ModalDialog, SelectField } from "../../components/ui/index.js";
import { ConnectionSettings } from "../../learning/providers/ConnectionSettings.js";
import { LiveConversationProvider } from "../../learning/providers/LiveConversationProvider.js";
import { ProviderRouting } from "../../learning/providers/ProviderRouting.js";
import { SpeechSettings } from "../../learning/speech/SpeechSettings.js";
import { invokeDesktop, normalizeDesktopError } from "../../runtime/ipc.js";
import styles from "./SettingsPage.module.css";
import { type useSettingsPageController } from "./useSettingsPageController.js";

export function AiSettingsSection({
  model,
}: {
  model: Pick<
    ReturnType<typeof useSettingsPageController>,
    | "checkingStatus"
    | "t"
    | "actionBusy"
    | "connectionBusy"
    | "loginId"
    | "checkStatus"
    | "runtimeFailure"
    | "statusCheckTimedOut"
    | "connectionSettings"
    | "account"
    | "draft"
    | "selectedTab"
    | "busy"
    | "setConnectionPending"
    | "setConnectionBusy"
    | "login"
    | "cancelLogin"
    | "accounts"
    | "setError"
    | "setAccountOptionsOpen"
    | "accountOptionsOpen"
    | "selectedRegistration"
    | "setSelectedRegistration"
    | "logout"
    | "integrationOpen"
    | "integrationReadFailure"
    | "integration"
    | "manageIntegration"
    | "setIntegrationOpen"
    | "integrationFailure"
    | "integrationNotice"
  >;
}) {
  const {
    checkingStatus,
    t,
    actionBusy,
    connectionBusy,
    loginId,
    checkStatus,
    runtimeFailure,
    statusCheckTimedOut,
    connectionSettings,
    account,
    draft,
    selectedTab,
    busy,
    setConnectionPending,
    setConnectionBusy,
    login,
    cancelLogin,
    accounts,
    setError,
    setAccountOptionsOpen,
    accountOptionsOpen,
    selectedRegistration,
    setSelectedRegistration,
    logout,
    integrationOpen,
    integrationReadFailure,
    integration,
    manageIntegration,
    setIntegrationOpen,
    integrationFailure,
    integrationNotice,
  } = model;
  return (
    <div className={styles.aiSetup}>
      <ActionGroup align="end">
        <Button
          variant="secondary"
          isPending={checkingStatus}
          pendingLabel={t("settings.checkingStatus")}
          isDisabled={actionBusy || connectionBusy || Boolean(loginId)}
          onPress={() => void checkStatus()}
        >
          {t("settings.checkStatus")}
        </Button>
      </ActionGroup>
      {runtimeFailure}
      {statusCheckTimedOut && (
        <Feedback tone="warning" live="polite">
          {t("settings.statusCheckTimedOut")}
        </Feedback>
      )}
      <Section className={styles.aiConnections} aria-label={t("settings.aiTitle")}>
        <ConnectionSettings
          ref={connectionSettings}
          overview={({ view, busy, select, mutate }) => (
            <>
              <ProviderRouting
                view={view}
                busy={busy}
                select={select}
                mutate={mutate}
                chatgptConnected={account ? account.status === "signed-in" : undefined}
              />
              <SpeechSettings language={draft?.learningScope.targetLanguage ?? "de"} />
              <ProviderRouting
                capability="image"
                view={view}
                busy={busy}
                select={select}
                mutate={mutate}
                chatgptConnected={account ? account.status === "signed-in" : undefined}
              />
            </>
          )}
          surface={false}
          active={selectedTab === "ai" || selectedTab === "speech"}
          disabled={busy || Boolean(loginId)}
          onPendingChange={setConnectionPending}
          onBusyChange={setConnectionBusy}
          chatgptConnected={account ? account.status === "signed-in" : undefined}
          chatgptAccess={({ dirty: connectionDirty }) => {
            const blocked = busy || Boolean(loginId) || connectionDirty;
            return (
              <div className={styles.accountAccess}>
                {runtimeFailure}
                <div className={styles.accountSummary}>
                  <p role="status" className={styles.connectionStatus}>
                    {account?.status === "signed-in" ? (
                      <CircleCheck aria-hidden="true" />
                    ) : (
                      <CircleHelp aria-hidden="true" />
                    )}
                    {account ? t(`settings.account.${account.status}`) : t("settings.notReported")}
                  </p>
                  <InfoHint label={t("settings.privacyTitle")}>
                    <p>{t("connectionSettings.cost.chatgpt")}</p>
                    <p>{t("settings.sessionPrivacy")}</p>
                  </InfoHint>
                </div>
                {account?.status !== "signed-in" && (
                  <ActionGroup>
                    <Button
                      variant="primary"
                      isDisabled={blocked || !account || account.status === "unavailable"}
                      onPress={() => void login()}
                    >
                      <UserRound aria-hidden="true" />
                      {t("settings.login")}
                    </Button>
                  </ActionGroup>
                )}
                {loginId && (
                  <ActionGroup>
                    <span role="status">{t("onboarding.login.waiting")}</span>
                    <Button variant="primary" isDisabled={busy} onPress={() => void cancelLogin()}>
                      {t("onboarding.cancelLogin")}
                    </Button>
                  </ActionGroup>
                )}
                {account?.status === "unavailable" && (
                  <p>{t("connectionSettings.chatgptLoginUnavailable")}</p>
                )}
                {accounts?.remoteRevocationPending && (
                  <Feedback tone="warning" live="polite">
                    {t("settings.chatgptRevocationPending")}
                  </Feedback>
                )}
                <div className={styles.accountTools}>
                  <Button
                    variant="secondary"
                    onPress={() =>
                      void invokeDesktop("chatgpt/usage/open", {}).catch((cause: unknown) => {
                        setError(normalizeDesktopError(cause).detail);
                      })
                    }
                  >
                    <Gauge aria-hidden="true" />
                    {t("settings.chatgptUsageLink")}
                  </Button>
                  <Button
                    variant="secondary"
                    onPress={() => {
                      setAccountOptionsOpen(true);
                    }}
                  >
                    <UserRound aria-hidden="true" />
                    {t("settings.accountOptions")}
                  </Button>
                </div>
                <ModalDialog
                  isOpen={accountOptionsOpen}
                  onOpenChange={setAccountOptionsOpen}
                  title={t("settings.accountOptions")}
                >
                  <div className={styles.accountOptions}>
                    {account?.status === "signed-in" && account.planType && (
                      <p>{t("settings.plan", { plan: account.planType })}</p>
                    )}
                    <SelectField
                      label={t("settings.chatgptAccount")}
                      disabled={blocked}
                      value={selectedRegistration ?? accounts?.selectedId ?? ""}
                      onChange={(event) => {
                        setSelectedRegistration(event.currentTarget.value);
                      }}
                    >
                      <option value="">{t("settings.chatgptNewAccount")}</option>
                      {accounts?.registrations.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </SelectField>
                    <ActionGroup>
                      <Button
                        variant="primary"
                        isDisabled={blocked || !account || account.status === "unavailable"}
                        onPress={() => void login()}
                      >
                        {t("settings.login")}
                      </Button>
                      {account?.status === "signed-in" && (
                        <Button variant="quiet" isDisabled={blocked} onPress={() => void logout()}>
                          <LogOut aria-hidden="true" />
                          {t("settings.logout")}
                        </Button>
                      )}
                    </ActionGroup>
                    <p>{t("settings.sessionPrivacy")}</p>
                    <Button
                      variant="secondary"
                      onPress={() => {
                        setAccountOptionsOpen(false);
                      }}
                    >
                      {t("actions.close")}
                    </Button>
                  </div>
                </ModalDialog>
                {connectionDirty && <p>{t("settings.saveBeforeAccount")}</p>}
              </div>
            );
          }}
        />
      </Section>
      <Section title={t("setupUx.speakingPractice")}>
        {!integrationOpen && integrationReadFailure}
        <LiveConversationProvider
          status={
            integration?.status === "available"
              ? t(`providers.pluginStatus.${integration.plugin}`)
              : t(integration ? "providers.codexUnavailable" : "providers.checkingConnection")
          }
          action={
            <Button
              variant="secondary"
              isDisabled={busy}
              aria-haspopup={
                integration?.status === "available" && integration.plugin !== "installed"
                  ? false
                  : "dialog"
              }
              onPress={() => {
                if (integration?.status === "available" && integration.plugin !== "installed")
                  void manageIntegration(
                    integration.plugin === "not-installed" ? "install" : "refresh",
                  );
                else setIntegrationOpen(true);
              }}
            >
              {t(
                integration?.status === "available" && integration.plugin !== "installed"
                  ? integration.plugin === "not-installed"
                    ? "providers.installPlugin"
                    : "providers.updatePlugin"
                  : "providers.configure",
              )}
            </Button>
          }
        />
        {integrationFailure && !integrationOpen && (
          <Feedback tone="error" live="assertive">
            {integrationFailure}
          </Feedback>
        )}
        {integrationNotice && !integrationOpen && (
          <Feedback tone="success" live="polite">
            {integrationNotice}
          </Feedback>
        )}
      </Section>
      <ModalDialog
        closeLabel={t("actions.close")}
        isOpen={integrationOpen}
        title={t("setupUx.speakingPractice")}
        onOpenChange={setIntegrationOpen}
      >
        <section className={styles.optionalIntegration} aria-labelledby="codex-integration-title">
          {integrationReadFailure}
          <div className={styles.integrationCopy}>
            <div className={styles.integrationHeading}>
              <AudioLines aria-hidden="true" />
              <h3 id="codex-integration-title">{t("settings.externalIntegrationTitle")}</h3>
              <InfoHint label={t("settings.externalIntegrationTitle")}>
                <p>{t("settings.externalIntegrationHelp")}</p>
              </InfoHint>
            </div>
            <p className={styles.integrationStatus} role="status">
              {integration === undefined
                ? t("settings.notReported")
                : integration.status === "available"
                  ? t(`settings.plugin.${integration.plugin}`)
                  : t("settings.codexUnavailable")}
            </p>
            {integration?.status === "available" && (
              <p className={styles.integrationDetail}>
                {t("settings.codexVersion", { version: integration.codexVersion })}
              </p>
            )}
          </div>
          {integration?.status === "available" && (
            <>
              <ActionGroup>
                {integration.plugin === "not-installed" && (
                  <Button
                    variant="primary"
                    isDisabled={busy}
                    onPress={() => void manageIntegration("install")}
                  >
                    {t("settings.plugin.actions.install")}
                  </Button>
                )}
                {integration.plugin !== "not-installed" && (
                  <Button
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void manageIntegration("refresh")}
                  >
                    {t("settings.plugin.actions.refresh")}
                  </Button>
                )}
                {integration.plugin === "installed" && (
                  <Button
                    variant="quiet"
                    isDisabled={busy}
                    onPress={() => void manageIntegration("uninstall")}
                  >
                    {t("settings.plugin.actions.uninstall")}
                  </Button>
                )}
              </ActionGroup>
            </>
          )}
          {(integrationFailure || integrationNotice) && (
            <div className={styles.integrationFeedback}>
              {integrationFailure ? (
                <Feedback live="assertive" tone="error">
                  {integrationFailure}
                </Feedback>
              ) : (
                <Feedback live="polite" tone="success">
                  {integrationNotice}
                </Feedback>
              )}
            </div>
          )}
        </section>
      </ModalDialog>
    </div>
  );
}
