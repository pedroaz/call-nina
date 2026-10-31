import { type Language } from "@call-nina/contracts";
import { SpeechConnections } from "./SpeechConnections.js";
import { SpeechStorage } from "./SpeechStorage.js";

export { CourseAudio } from "./CourseAudio.js";
export function SpeechSettings({
  mode = "full",
  language = "de",
}: {
  mode?: "full" | "routing" | "storage";
  language?: Language;
}) {
  return mode === "storage" ? <SpeechStorage /> : <SpeechConnections language={language} />;
}
