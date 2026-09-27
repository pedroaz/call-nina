import {
  desktopIpcEventSchema,
  desktopIpcRequestSchema,
  desktopIpcResponseSchema,
  type DesktopIpcEvent,
  type DesktopIpcRequest,
  type CallNinaDesktopBridge,
} from "@call-nina/contracts";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const invoke = (async (request: DesktopIpcRequest) => {
  const parsedRequest = desktopIpcRequestSchema.safeParse(request);
  if (!parsedRequest.success) throw new Error("OD_IPC_REQUEST_INVALID");
  const parsedResponse = desktopIpcResponseSchema.safeParse(
    await ipcRenderer.invoke("call-nina:invoke", parsedRequest.data),
  );
  if (!parsedResponse.success) throw new Error("OD_IPC_RESPONSE_INVALID");
  return parsedResponse.data;
}) as CallNinaDesktopBridge["invoke"];

const bridge: CallNinaDesktopBridge = Object.freeze({
  invoke,
  subscribe: (listener: (event: DesktopIpcEvent) => void) => {
    const receive = (_event: IpcRendererEvent, value: unknown) => {
      const parsed = desktopIpcEventSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on("call-nina:event", receive);
    return () => ipcRenderer.removeListener("call-nina:event", receive);
  },
  workspaceReady: (ready: boolean) => {
    ipcRenderer.send("call-nina:workspace-ready", ready);
  },
  ready: () => {
    ipcRenderer.send("call-nina:renderer-ready");
  },
});

contextBridge.exposeInMainWorld("callNina", bridge);
