import { createContext, useContext } from "react";

export const ProviderSettingsNavigation = createContext<(() => void) | null>(null);
export function useOpenProviderSettings() {
  const open = useContext(ProviderSettingsNavigation);
  if (!open) throw new Error("OD_DESKTOP_NAVIGATION_MISSING");
  return open;
}
