import type { CallNinaDesktopBridge } from "@call-nina/contracts";

declare global {
  interface Window {
    callNina: CallNinaDesktopBridge;
  }
}

export type RendererDocumentEnvironment = Document;

// @ts-expect-error Renderer code must not inherit Node.js ambient globals.
export type RendererNodeProcessLeak = typeof process;
