import {
  activityIdSchema,
  dataRootGenerationSchema,
  openActivityActionSchema,
  learningScopeSchema,
  type LearningScope,
} from "@call-nina/contracts";
import { callNinaMarketplaceName, callNinaPluginName } from "@call-nina/codex-client";
import path from "node:path";

export function createCodexVoiceActivityUrl(
  activityIdValue: string,
  generationValue: number,
  scopeValue: LearningScope,
  workspacePath: string,
) {
  if (!path.isAbsolute(workspacePath) || workspacePath.includes("\0"))
    throw new Error("OD_HANDOFF_URL_INVALID");
  const scope = learningScopeSchema.parse(scopeValue);
  const activityId = activityIdSchema.parse(activityIdValue);
  const generation = dataRootGenerationSchema.parse(generationValue);
  const pluginId = `${callNinaPluginName}@${callNinaMarketplaceName}`;
  const prompt = [
    `[@Call Nina](plugin://${pluginId}) Prepare my saved activity for Voice.`,
    `Activity: ${activityId}; dataRootGeneration: ${String(generation)}.`,
    `Target language: ${scope.targetLanguage}. Use the Call Nina plugin to load this exact activity and its teaching defaults, then briefly acknowledge the scenario.`,
    "Use its stored learningContext target language for role-play and corrected examples, and its explanation language for all coaching, vocabulary meanings and feedback from the start, even if my active language has changed. Never infer either from the interface or this message.",
    "Wait for me to begin without revealing listening scripts or answers.",
    "During Voice, follow my initiatives beyond the initial objectives and respond to all parts of my requests. Establish the scenario's register from the first turn; default to Sie in German service encounters unless informal address is established. Let unfinished phrases and hesitations finish before responding or praising; clarify uncertain transcription instead of correcting a guess.",
    "Honor the saved correction timing: focus on one useful phrase and prefer a natural follow-up that lets me reuse it over whole-sentence repetition drills. Use simple coaching language, briefly explain necessary new words, and acknowledge specific successes without blanket praise.",
    "Do not guess real-world conversions or claim an unperformed lookup. If a shoe-size conversion is unverified, practise asking for a measurement or fitting instead. Keep fictional shop details separate from verified facts or medical advice.",
    "Keep one conversational continuation per turn. Use the loaded context for ordinary dialogue; do not request background work for routine corrections. If background work is needed, answer only its bounded question without a second role-play turn. Do not repeat feedback already delivered or include task-status reports; host completion markers do not end Voice.",
    "At a natural endpoint, offer continuation or feedback and wait. For an in-role goodbye, reply naturally and offer quick feedback once; respect an explicit stop or refusal immediately. If I choose feedback, give up to two concrete observations and offer a varied retry. Ask separately before saving a summary.",
    "If the Call Nina tools are unavailable, explain that this chat cannot access the local plugin; do not claim the saved activity is missing or stale.",
    "If this reference is missing or stale, ask me to reopen it in Call Nina instead of selecting another activity.",
  ].join(" ");
  // The installed desktop link handler supports explicit mode selection.
  // A workspace alone does not switch out of the previously selected Chat mode.
  return `codex://new?mode=codex&path=${encodeURIComponent(workspacePath)}&prompt=${encodeURIComponent(prompt)}`;
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
