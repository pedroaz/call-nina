import { type NinaAccountState, type NinaLoginDiagnostic } from "@call-nina/contracts";
import { createContext, useContext } from "react";
import { invokeDesktop } from "../../runtime/ipc.js";

export const isAborted = (signal: AbortSignal) => signal.aborted;
export function reportLogin(diagnostic: NinaLoginDiagnostic) {
  void invokeDesktop("nina-account/diagnostic", diagnostic).catch(() => undefined);
}
export const AccountContext = createContext<NinaAccountState>({
  status: "signed-out",
  access: null,
});
export const AccountIdentityContext = createContext<{
  loaded: boolean;
  signedIn: boolean;
  pending: boolean;
  username: string | null;
  ready: boolean;
  changing: boolean;
}>({
  loaded: true,
  signedIn: false,
  pending: false,
  username: null,
  ready: true,
  changing: false,
});
export const AccountDialogContext = createContext<{ open: () => void; isOpen: boolean } | null>(
  null,
);
export function useNinaAccountDialog() {
  const dialog = useContext(AccountDialogContext);
  if (!dialog) throw new Error("OD_NINA_ACCOUNT_DIALOG_MISSING");
  return dialog;
}
export function useNinaAccountState() {
  const account = useContext(AccountContext);
  const identity = useContext(AccountIdentityContext);
  return { ...account, identity };
}
