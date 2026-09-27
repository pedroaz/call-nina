import type { DesktopIpcResponse } from "@call-nina/contracts";
import { modelPreferencesSchema, type ModelPreferences } from "@call-nina/domain";

import { invokeDesktop } from "./ipc.js";

export type DesktopSettingsResult = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "learner-settings/read" }
>["result"];
export type DesktopSettingsValue = DesktopSettingsResult["settings"];

export interface DesktopSettingsAdapter {
  available(): boolean;
  read(): Promise<DesktopSettingsResult>;
  update(expectedUpdatedAt: string, settings: DesktopSettingsValue): Promise<DesktopSettingsResult>;
}

export const desktopSettingsAdapter: DesktopSettingsAdapter = {
  available: () => true,
  read: () => invokeDesktop("learner-settings/read", {}),
  update: (expectedUpdatedAt, settings) =>
    invokeDesktop("learner-settings/update", { expectedUpdatedAt, settings }),
};

export function replaceWorkloadPreference(
  preferences: ModelPreferences,
  workload: keyof Omit<ModelPreferences, "schemaVersion">,
  next: ModelPreferences[typeof workload],
): ModelPreferences {
  return modelPreferencesSchema.parse({ ...preferences, [workload]: next });
}
