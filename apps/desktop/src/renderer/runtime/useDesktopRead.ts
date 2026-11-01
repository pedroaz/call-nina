import type { CallNinaError, DesktopIpcEvent } from "@call-nina/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeDesktopError, subscribeDesktop } from "./ipc.js";

type InvalidationScope = Extract<DesktopIpcEvent, { event: "state-invalidated" }>["scope"];
interface ReadOptions<Value> {
  key: string;
  read: () => Promise<Value>;
  scopes: readonly InvalidationScope[];
  refreshOnFocus?: boolean;
  enabled?: boolean;
}
export function useDesktopRead<Value>({
  key,
  read,
  scopes,
  refreshOnFocus = true,
  enabled = true,
}: ReadOptions<Value>) {
  const [value, setValue] = useState<Value>();
  const [error, setError] = useState<CallNinaError>();
  const [reading, setReading] = useState(enabled);
  const version = useRef(0);
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  }, [read]);
  const refresh = useCallback(async () => {
    const ticket = ++version.current;
    setReading(true);
    try {
      const next = await reader.current();
      if (ticket !== version.current) return;
      setValue(next);
      setError(undefined);
      return next;
    } catch (cause) {
      if (ticket === version.current) setError(normalizeDesktopError(cause).detail);
    } finally {
      if (ticket === version.current) setReading(false);
    }
  }, []);
  const invalidationKey = scopes.join(",");
  useEffect(() => {
    if (!enabled) return;
    version.current = version.current + 1;
    const initial = window.setTimeout(() => {
      setValue(undefined);
      setError(undefined);
      void refresh();
    }, 0);
    const onFocus = () => void refresh();
    if (refreshOnFocus) window.addEventListener("focus", onFocus);
    const watched = invalidationKey.split(",");
    const off = subscribeDesktop((event) => {
      if (event.event === "data-root-changed") {
        version.current = version.current + 1;
        setValue(undefined);
        setError(undefined);
        void refresh();
      } else if (event.event === "state-invalidated" && watched.includes(event.scope))
        void refresh();
    });
    return () => {
      version.current = version.current + 1;
      window.clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      off();
    };
  }, [key, invalidationKey, refreshOnFocus, enabled, refresh]);
  return { value, error, reading, refresh };
}
