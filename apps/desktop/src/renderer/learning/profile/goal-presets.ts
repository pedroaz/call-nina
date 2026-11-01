import { languageIds } from "@call-nina/contracts";
import i18n from "../../runtime/i18n.js";

export const learningGoalPresets = ["everyday", "travel", "work"] as const;

// Existing profiles retain the goal text selected in their original locale.
export function learningGoalPreset(value: string) {
  return learningGoalPresets.find((goal) =>
    languageIds.some((locale) => value === i18n.getFixedT(locale)(`setupUx.goals.${goal}`)),
  );
}
