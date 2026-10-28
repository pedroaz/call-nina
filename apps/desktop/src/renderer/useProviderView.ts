import { useEffect, useState } from "react";
import type { aiConnectionsViewSchema, z } from "@call-nina/contracts";
import { invokeDesktop, subscribeDesktop } from "./ipc.js";

export type ProviderView = z.infer<typeof aiConnectionsViewSchema>;
export function useProviderView() {
  const [view, setView] = useState<ProviderView>();
  useEffect(() => {
    let alive = true;
    let serial = 0;
    const load = async () => {
      const current = ++serial;
      try {
        const next = await invokeDesktop("ai-connections/read", {});
        if (alive && current === serial) setView(next);
      } catch {
        if (alive && current === serial) setView(undefined);
      }
    };
    void load();
    const unsubscribe = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        ++serial;
        setView(undefined);
        void load();
      } else if (
        event.event === "state-invalidated" &&
        ["ai-connections", "account"].includes(event.scope)
      )
        void load();
    });
    return () => {
      alive = false;
      ++serial;
      unsubscribe();
    };
  }, []);
  return view;
}
