import { type DesktopIpcResponse } from "@call-nina/contracts";
import { type PathDestination } from "../../learning/curriculum/learningPathNavigation.js";

export type Readiness = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "app/readiness" }
>["result"];

export type Account = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/read" }
>["result"];

export type LoginId = Extract<
  DesktopIpcResponse,
  { status: "ok"; channel: "chatgpt/account/login/start" }
>["result"]["loginId"];

export type ProfileOnboardingProps = {
  readiness: Readiness;
  onComplete: (destination?: PathDestination) => void;
  onExit?: () => void;
};
