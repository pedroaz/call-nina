import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopIpcResponse, CallNinaError } from "@call-nina/contracts";
import {
  modelWorkloads,
  resolveModelPreference,
  type ModelWorkload,
  type WorkloadModelPreference,
} from "@call-nina/domain";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Disclosure, InfoHint } from "./components/ui/index.js";

import styles from "./SidebarModelControl.module.css";
import { invokeDesktop, normalizeDesktopError, subscribeDesktop } from "./ipc.js";
import {
  desktopSettingsAdapter,
  replaceWorkloadPreference,
  type DesktopSettingsResult,
} from "./settings-adapter.js";

type Catalog = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "codex/models/read" }
>["result"];

function modelValue(preference: WorkloadModelPreference): string {
  return preference.model.mode === "automatic" ? "automatic" : preference.model.modelId;
}

export function SidebarModelControl({ initialWorkload }: { initialWorkload: ModelWorkload }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState({ initial: initialWorkload, selected: initialWorkload });
  const workload = choice.initial === initialWorkload ? choice.selected : initialWorkload;
  const setWorkload = (selected: ModelWorkload) => {
    setChoice({ initial: initialWorkload, selected });
  };
  const [settings, setSettings] = useState<DesktopSettingsResult>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CallNinaError>();

  const load = useCallback(async () => {
    try {
      const nextSettings = await desktopSettingsAdapter.read();
      setSettings(nextSettings);
      setCatalog(await invokeDesktop("codex/models/read", {}));
      setError(undefined);
    } catch (cause) {
      setCatalog(undefined);
      setError(normalizeDesktopError(cause).detail);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const unsubscribe = subscribeDesktop((event) => {
      if (
        event.event === "state-invalidated" &&
        (event.scope === "settings" || event.scope === "models" || event.scope === "account")
      ) {
        void load();
      }
    });
    return () => {
      window.clearTimeout(initial);
      unsubscribe();
    };
  }, [load]);

  const preference = settings?.settings.modelPreferences[workload];
  const savedModelId = preference?.model.mode === "exact" ? preference.model.modelId : undefined;
  const resolution = useMemo(
    () =>
      preference && catalog ? resolveModelPreference(workload, preference, catalog) : undefined,
    [catalog, preference, workload],
  );
  const automaticResolution =
    preference && catalog
      ? resolveModelPreference(workload, { ...preference, model: { mode: "automatic" } }, catalog)
          .resolution
      : undefined;
  const automaticModel =
    automaticResolution && automaticResolution.status !== "unavailable"
      ? catalog?.models.find(({ id }) => id === automaticResolution.effectiveModelId)
      : undefined;
  const effectiveResolution = resolution?.resolution as
    { status: string; effectiveModelId?: string; effectiveEffortId?: string } | undefined;
  const selectedModel = useMemo(() => {
    if (!catalog || !effectiveResolution?.effectiveModelId) {
      return undefined;
    }
    return catalog.models.find(({ id }) => id === effectiveResolution.effectiveModelId);
  }, [catalog, effectiveResolution]);
  const effectiveEffort = effectiveResolution?.effectiveEffortId;

  const savePreference = async (nextPreference: WorkloadModelPreference) => {
    if (!settings) return;
    setBusy(true);
    setError(undefined);
    try {
      const modelPreferences = replaceWorkloadPreference(
        settings.settings.modelPreferences,
        workload,
        nextPreference,
      );
      const next = await desktopSettingsAdapter.update(settings.updatedAt, {
        ...settings.settings,
        modelPreferences,
      });
      setSettings(next);
    } catch (cause) {
      const detail = normalizeDesktopError(cause).detail;
      await load();
      setError(detail);
    } finally {
      setBusy(false);
    }
  };

  const selectModel = (modelId: string) => {
    if (!preference) return;
    const model =
      modelId === "automatic"
        ? ({ mode: "automatic" } as const)
        : ({ mode: "exact", modelId } as const);
    const nextModel =
      modelId === "automatic" ? automaticModel : catalog?.models.find(({ id }) => id === modelId);
    const fallbackEffort =
      nextModel?.defaultReasoningEffort ?? nextModel?.supportedReasoningEfforts[0];
    const effort =
      preference.effort.mode === "exact" &&
      !nextModel?.supportedReasoningEfforts.includes(preference.effort.effortId) &&
      fallbackEffort
        ? ({ mode: "exact", effortId: fallbackEffort } as const)
        : preference.effort;
    void savePreference({ model, effort });
  };

  const selectEffort = (effortId: string) => {
    if (!preference) return;
    const effort = { mode: "exact", effortId } as const;
    void savePreference({ ...preference, effort });
  };

  return (
    <section className={styles.navModelPanel} aria-busy={busy} aria-label={t("modelControl.title")}>
      <Disclosure
        label={
          <span className={styles.navModelHeading}>
            <Bot aria-hidden="true" />
            <span>
              {t(`modelControl.workloads.${workload}`)}
              <small>{selectedModel?.displayName ?? t("modelControl.title")}</small>
            </span>
          </span>
        }
      >
        <div
          aria-label={t("modelControl.activity")}
          className={styles.navModelWorkloads}
          role="group"
        >
          {modelWorkloads.map((availableWorkload) => (
            <Button
              className={styles.navModelWorkloadButton}
              aria-pressed={availableWorkload === workload}
              data-selected={availableWorkload === workload || undefined}
              isDisabled={busy}
              key={availableWorkload}
              onPress={() => {
                setWorkload(availableWorkload);
              }}
            >
              {t(`modelControl.workloads.${availableWorkload}`)}
            </Button>
          ))}
        </div>
        <p className={styles.navModelStatus}>{t("providerAccess.selectedRoute")}</p>
        {!preference ? (
          <p className={styles.navModelStatus}>{t("modelControl.loading")}</p>
        ) : (
          <>
            <label className={styles.navModelField}>
              <span>{t("modelControl.model")}</span>
              <select
                disabled={busy}
                value={modelValue(preference)}
                onChange={(event) => {
                  selectModel(event.currentTarget.value);
                }}
              >
                <option value="automatic">
                  {t("modelControl.automatic", {
                    model: automaticModel?.displayName ?? t("settings.automatic"),
                  })}
                </option>
                {preference.model.mode === "exact" &&
                !catalog?.models.some(({ id }) => id === savedModelId) ? (
                  <option value={preference.model.modelId}>
                    {t("settings.unavailableSavedModel", { model: preference.model.modelId })}
                  </option>
                ) : null}
                {catalog?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className={styles.navModelReasoning}>
              <legend>
                {t("modelControl.reasoning")}{" "}
                <InfoHint label={t("modelControl.reasoning")}>
                  {t("modelControl.reasoningHint")}
                </InfoHint>
              </legend>
              <div className={styles.navModelEffortGrid}>
                {selectedModel?.supportedReasoningEfforts.map((effort) => (
                  <Button
                    className={styles.navModelEffortButton}
                    aria-pressed={effectiveEffort === effort}
                    data-selected={effectiveEffort === effort ? true : undefined}
                    isDisabled={busy}
                    key={effort}
                    onPress={() => {
                      selectEffort(effort);
                    }}
                  >
                    {t(`settings.exactEfforts.${effort}`, { defaultValue: effort })}
                  </Button>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </Disclosure>
      {resolution?.resolution.status === "unavailable" && (
        <p className={styles.navModelStatus}>{t("providerAccess.reasons.model-unavailable")}</p>
      )}
      {resolution?.resolution.status === "fallback" && (
        <p className={styles.navModelStatus}>{t("settings.savedModelFallback")}</p>
      )}
      {resolution &&
        resolution.resolution.status !== "unavailable" &&
        resolution.resolution.unavailableAutomaticModelId && (
          <p className={styles.navModelStatus}>
            {t("settings.automaticFallback", {
              model: resolution.resolution.unavailableAutomaticModelId,
              effective: selectedModel?.displayName,
            })}
          </p>
        )}
      {error && <p className={styles.navModelError}>{t(error.messageKey)}</p>}
      {busy && <p className={styles.navModelStatus}>{t("modelControl.saving")}</p>}
    </section>
  );
}
