import {
  activityIdSchema,
  dataRootGenerationSchema,
  openActivityActionSchema,
  learningScopeSchema,
  type LearningScope,
} from "@call-nina/contracts";
import { callNinaMarketplaceName, callNinaPluginName } from "@call-nina/codex-client";

export function createCodexVoiceActivityUrl(
  activityIdValue: string,
  generationValue: number,
  scopeValue: LearningScope,
) {
  const scope = learningScopeSchema.parse(scopeValue);
  const activityId = activityIdSchema.parse(activityIdValue);
  const generation = dataRootGenerationSchema.parse(generationValue);
  const pluginId = `${callNinaPluginName}@${callNinaMarketplaceName}`;
  const prompt = [
    `[@Call Nina](plugin://${pluginId}) Prepare my saved activity for Voice.`,
    `Activity: ${activityId}; dataRootGeneration: ${String(generation)}.`,
    `Target language: ${scope.targetLanguage}. Load this exact activity and its teaching defaults, briefly acknowledge the scenario,`,
    "Use its stored learningContext target language for the conversation and its explanation language for feedback, even if my active language has changed. Never infer either from the interface or this message.",
    "and wait for me to begin without revealing listening scripts or answers.",
    "If this reference is missing or stale, ask me to reopen it in Call Nina instead of selecting another activity.",
  ].join(" ");
  return `codex://new?prompt=${encodeURIComponent(prompt)}`;
}

export function parseCallNinaActivityUrl(value: string) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("OD_HANDOFF_URL_INVALID");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OD_HANDOFF_URL_INVALID");
  }
  if (
    url.protocol !== "call-nina:" ||
    url.hostname !== "activity" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("OD_HANDOFF_URL_INVALID");
  }
  let activityId: string;
  try {
    activityId = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  } catch {
    throw new Error("OD_HANDOFF_URL_INVALID");
  }
  try {
    return openActivityActionSchema.parse({ action: "open-activity", activityId });
  } catch {
    throw new Error("OD_HANDOFF_URL_INVALID");
  }
}
