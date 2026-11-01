import type { AnalyticsScreen } from "@call-nina/contracts";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { invokeDesktop } from "./ipc.js";
import { useDesktopRead } from "./useDesktopRead.js";

function useAnalyticsState() {
  return useDesktopRead({
    key: "usage-analytics",
    read: () => invokeDesktop("analytics/read", {}),
    scopes: [],
  });
}
const UsageAnalyticsContext = createContext<ReturnType<typeof useAnalyticsState> | null>(null);
export function UsageAnalyticsProvider({ children }: { children: ReactNode }) {
  const state = useAnalyticsState();
  return <UsageAnalyticsContext.Provider value={state}>{children}</UsageAnalyticsContext.Provider>;
}
export function useUsageAnalytics() {
  const state = useContext(UsageAnalyticsContext);
  if (!state) throw new Error("UsageAnalyticsProvider is missing");
  return state;
}
export function useAnalyticsScreen(screen: AnalyticsScreen) {
  useEffect(() => {
    void invokeDesktop("analytics/screen", { screen }).catch(() => undefined);
  }, [screen]);
  useEffect(
    () => () => {
      void invokeDesktop("analytics/screen", { screen: null }).catch(() => undefined);
    },
    [],
  );
}
