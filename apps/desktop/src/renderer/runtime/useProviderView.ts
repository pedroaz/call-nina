import type { aiConnectionsViewSchema, z } from "@call-nina/contracts";
import { invokeDesktop } from "./ipc.js";
import { useDesktopRead } from "./useDesktopRead.js";

export type ProviderView = z.infer<typeof aiConnectionsViewSchema>;
export function useProviderView() {
  const read = useDesktopRead({
    key: "providers",
    read: () => invokeDesktop("ai-connections/read", {}),
    scopes: ["ai-connections", "account"],
    refreshOnFocus: false,
  });
  return read.error ? undefined : read.value;
}
